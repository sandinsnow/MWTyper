#!/usr/bin/env python3
"""YAML 子集解析器 —— 离线环境没有 PyYAML / js-yaml，
用于校验 GitHub Actions workflow 的结构（缩进、键路径、步骤完整性）。

支持：嵌套 map、block sequence（- item）、block scalar（| 与 >）、
单行 scalar（含引号）、行内 flow sequence（[a, b]）、注释。
不支持：锚点/别名、复杂 key、多文档 —— 足以覆盖 Actions workflow。
"""
import sys, json


def parse_error(path, line_no, msg):
    print(f"FAIL {path}:{line_no}: {msg}")
    return False


class Line:
    __slots__ = ("indent", "text", "no")

    def __init__(self, indent, text, no):
        self.indent, self.text, self.no = indent, text, no


def tokenize(path, src):
    lines = []
    for i, raw in enumerate(src.splitlines(), 1):
        if "\t" in raw.split("#")[0]:
            parse_error(path, i, "缩进里出现 TAB（YAML 禁止）")
            return None
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        lines.append(Line(indent, stripped, i))
    return lines


def split_key(text):
    """把 'key: value' 拆成 (key, rest)。不是 map 行时返回 None。"""
    if text.startswith("- "):
        text = text[2:].strip()
        if text.startswith("[") or text.startswith("{"):
            return None
    if ":" not in text:
        return None
    key, _, rest = text.partition(":")
    key = key.strip()
    if key.startswith(("'", '"')) and key.endswith(("'", '"')) and len(key) >= 2:
        key = key[1:-1]
    if not key or " " in key:
        return None
    return key, rest.strip()


def parse_block(lines, idx, indent):
    """解析一个块，返回 (value, next_idx)。"""
    # 判断是 sequence 还是 mapping
    if idx >= len(lines):
        return None, idx
    if lines[idx].indent != indent:
        return None, idx
    if lines[idx].text.startswith("- "):
        return parse_seq(lines, idx, indent)
    return parse_map(lines, idx, indent)


def parse_seq(lines, idx, indent):
    out = []
    while idx < len(lines):
        ln = lines[idx]
        if ln.indent < indent:
            break
        if ln.indent > indent:
            return parse_error("seq", ln.no, "序列项缩进不一致") or (None, idx)
        if not ln.text.startswith("- "):
            break
        body = ln.text[2:].strip()
        kv = split_key(body)
        if kv is None:
            out.append(body)
            idx += 1
            continue
        # '- key: value' —— 序列项本身是一个 map，其第一个键与 '- ' 同列
        key, rest = kv
        item = {}
        idx += 1
        if rest == "":
            sub, idx = parse_block(lines, idx, indent + 2)
            item[key] = sub
        elif rest in ("|", ">", "|-", ">-", "|+", ">+"):
            text, idx = read_scalar_block(lines, idx, indent + 2)
            item[key] = text
        else:
            item[key] = rest
        # 同一 map 的后续键（缩进 = indent + 2）
        while idx < len(lines) and lines[idx].indent == indent + 2 and not lines[idx].text.startswith("- "):
            kv2 = split_key(lines[idx].text)
            if kv2 is None:
                break
            k2, r2 = kv2
            idx += 1
            if r2 == "":
                sub, idx = parse_block(lines, idx, indent + 4)
                item[k2] = sub
            elif r2 in ("|", ">", "|-", ">-", "|+", ">+"):
                text, idx = read_scalar_block(lines, idx, indent + 4)
                item[k2] = text
            else:
                item[k2] = r2
        out.append(item)
    return out, idx


def parse_map(lines, idx, indent):
    out = {}
    while idx < len(lines):
        ln = lines[idx]
        if ln.indent < indent:
            break
        if ln.indent > indent:
            return parse_error("map", ln.no, "映射缩进不一致") or (None, idx)
        if ln.text.startswith("- "):
            break
        kv = split_key(ln.text)
        if kv is None:
            return parse_error("map", ln.no, f"无法解析的行: {ln.text[:60]}") or (None, idx)
        key, rest = kv
        idx += 1
        if rest == "":
            sub, idx = parse_block(lines, idx, indent + 2)
            out[key] = sub
        elif rest in ("|", ">", "|-", ">-", "|+", ">+"):
            text, idx = read_scalar_block(lines, idx, indent + 2)
            out[key] = text
        else:
            out[key] = rest
    return out, idx


def read_scalar_block(lines, idx, min_indent):
    chunks = []
    base = None
    while idx < len(lines):
        ln = lines[idx]
        if ln.indent < min_indent:
            break
        if base is None:
            base = ln.indent
        chunks.append(" " * (ln.indent - base) + ln.text)
        idx += 1
    return "\n".join(chunks), idx


def main(paths):
    ok = True
    for path in paths:
        src = open(path, encoding="utf-8").read()
        lines = tokenize(path, src)
        if lines is None:
            ok = False
            continue
        try:
            doc, idx = parse_block(lines, 0, lines[0].indent if lines else 0)
        except Exception as e:  # noqa: BLE001
            print(f"FAIL {path}: 解析异常 {e}")
            ok = False
            continue
        if idx != len(lines):
            print(f"FAIL {path}:{lines[idx].no}: 有内容未被解析（缩进异常）")
            ok = False
            continue
        # 结构检查
        for req in ("name", "on", "jobs"):
            if req not in doc:
                print(f"FAIL {path}: 缺少顶层键 '{req}'")
                ok = False
        jobs = doc.get("jobs")
        if isinstance(jobs, dict):
            for jn, jv in jobs.items():
                if not isinstance(jv, dict):
                    continue
                steps = jv.get("steps")
                if not isinstance(steps, list):
                    print(f"FAIL {path}: job '{jn}' 没有 steps 列表")
                    ok = False
                    continue
                for si, st in enumerate(steps):
                    if not isinstance(st, dict):
                        print(f"FAIL {path}: job '{jn}' step[{si}] 不是 map")
                        ok = False
                        continue
                    if "name" not in st:
                        print(f"FAIL {path}: job '{jn}' step[{si}] 缺 name")
                        ok = False
                    if "uses" not in st and "run" not in st:
                        print(f"FAIL {path}: job '{jn}' step[{si}] 既无 uses 也无 run")
                        ok = False
                    if "uses" in st and "run" in st:
                        print(f"FAIL {path}: job '{jn}' step[{si}] 同时有 uses 与 run")
                        ok = False
        if ok:
            print(f"OK   {path}  (jobs={list(jobs.keys()) if isinstance(jobs, dict) else '?'})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
