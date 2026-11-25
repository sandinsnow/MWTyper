# 为 store 中所有包的 optionalDependencies 里缺失元数据的平台包生成 os/cpu 桩，
# 使 pnpm --offline 能按平台不匹配跳过它们（不会真正安装，integrity 为占位）。
import json, os, base64

BASE = os.path.expanduser(
    r"~\scoop\apps\pnpm\current\cache\v12\metadata"
    r"\https%3A+registry.dfy.definesys.cn%2Frepository+apaas-npm-group")
REG = "https://registry.dfy.definesys.cn/repository/apaas-npm-group"
NOW = "2026-11-19T00:00:00.000Z"
DUMMY = "sha512-" + base64.b64encode(b"\0" * 64).decode()

def parse(fp):
    raw = open(fp, encoding="utf-8").read()
    body = raw.split("\n", 1)[1]
    dec = json.JSONDecoder(); idx = 0; objs = []
    while idx < len(body):
        while idx < len(body) and body[idx] in " \r\n\t": idx += 1
        if idx >= len(body): break
        o, e = dec.raw_decode(body, idx); objs.append(o); idx = e
    return objs

def platform(n):
    l = n.lower()
    os_ = []
    for k, v in (("darwin", "darwin"), ("linux", "linux"), ("win32", "win32"),
                 ("windows", "win32"), ("android", "android"), ("freebsd", "freebsd")):
        if k in l: os_.append(v)
    cpu = []
    for k, v in (("arm64", "arm64"), ("aarch64", "arm64"), ("riscv64", "riscv64"),
                 ("ppc64", "ppc64"), ("s390x", "s390x"), ("loong64", "loong64"),
                 ("ia32", "ia32"), ("x64", "x64"), ("amd64", "x64")):
        if k in l: cpu.append(v); break
    if not cpu and "arm" in l: cpu = ["arm"]
    return os_, cpu

def main():
    manifests = []
    for root, _, files in os.walk(BASE):
        for f in files:
            if f.endswith(".jsonl"):
                fp = os.path.join(root, f)
                try:
                    for o in parse(fp)[2:]:
                        if isinstance(o, dict) and o.get("name"):
                            manifests.append(o)
                except Exception as e:
                    print("parse fail", fp, e)
    made = 0
    for m in manifests:
        for name, ver in (m.get("optionalDependencies") or {}).items():
            if not isinstance(ver, str) or not ver[0].isdigit():
                continue
            fp = os.path.join(BASE, name.replace("/", os.sep) + ".jsonl")
            if os.path.exists(fp):
                continue
            os_, cpu = platform(name)
            if not os_ and not cpu:
                print("SKIP unknown platform:", name)
                continue
            man = {"name": name, "version": ver,
                   "dist": {"integrity": DUMMY, "shasum": "",
                            "tarball": f"{REG}/{name}/-/{name.split('/')[-1]}-{ver}.tgz",
                            "fileCount": 0}}
            if os_: man["os"] = os_
            if cpu: man["cpu"] = cpu
            if "musl" in name: man["libc"] = ["musl"]
            elif "gnu" in name: man["libc"] = ["glibc"]
            summary = {"name": name, "distTags": {"latest": ver},
                       "time": {ver: NOW}, "versions": [[ver, 0, 0]]}
            mj = json.dumps(man, separators=(",", ":"))
            summary["versions"] = [[ver, 0, len(mj.encode())]]
            sj = json.dumps(summary, separators=(",", ":"))
            body = (json.dumps({"modified": NOW}, separators=(",", ":")) + sj + mj)
            os.makedirs(os.path.dirname(fp), exist_ok=True)
            open(fp, "w", encoding="utf-8", newline="\n").write(
                f"pnpm-meta-v1 39 {len(sj.encode())}\n" + body)
            made += 1
    print("platform stubs written:", made)

if __name__ == "__main__":
    main()