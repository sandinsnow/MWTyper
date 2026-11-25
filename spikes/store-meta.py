# M0 spike ① 辅助：从 pnpm store v11 的 index.db 解码 msgpack 清单，
# 生成 pnpm 12 离线解析所需的 metadata jsonl（格式对照缓存中真实样本逆向）。
# 仅写入 pnpm 元数据缓存目录，不改动 store 本体。
import sqlite3, os, json, struct, sys, time

STORE = os.path.expanduser(r"~\scoop\apps\pnpm\current\store\v11")
MIRROR = os.path.expanduser(
    r"~\scoop\apps\pnpm\current\cache\v12\metadata"
    r"\https%3A+registry.dfy.definesys.cn%2Frepository+apaas-npm-group")
REGISTRY = "https://registry.dfy.definesys.cn/repository/apaas-npm-group"

class MP:
    # msgpackr 共享结构编码：ext 0x72 首现 = 结构定义(id + keys 数组 + 顺序值)，
    # 再现 = 记录实例(id + 顺序值)。pnpm store v11 index.db 即此格式。
    def __init__(self, b): self.b = b; self.i = 0; self.structures = {}
    def u8(self):
        v = self.b[self.i]; self.i += 1; return v
    def take(self, n):
        v = self.b[self.i:self.i+n]; self.i += n; return v
    def ext(self, n):
        t = self.u8(); data = self.take(n)
        if t == 0x72:
            sid = int.from_bytes(data, "big")
            if sid not in self.structures:
                keys = self.val()
                assert isinstance(keys, list), f"structure {sid} keys not array"
                self.structures[sid] = keys
            keys = self.structures[sid]
            return {k: self.val() for k in keys}
        return None
    def record(self, sid):
        keys = self.structures[sid]
        return {k: self.val() for k in keys}
    def val(self):
        c = self.u8()
        if c <= 0x3f: return c
        # msgpackr：64..127 的裸字节是共享结构引用（真整数此区间用 0xcc 转义）
        if 0x40 <= c <= 0x7f: return self.record(c)
        if c >= 0xe0: return c - 256
        if 0x80 <= c <= 0x8f: return self.mp(c & 15)
        if 0x90 <= c <= 0x9f: return self.ar(c & 15)
        if 0xa0 <= c <= 0xbf: return self.take(c & 31).decode("utf-8", "replace")
        if c == 0xc0: return None
        if c == 0xc2: return False
        if c == 0xc3: return True
        if c == 0xc4: return self.take(self.u8())
        if c == 0xc5: return self.take(struct.unpack(">H", self.take(2))[0])
        if c == 0xc6: return self.take(struct.unpack(">I", self.take(4))[0])
        if c == 0xca: return struct.unpack(">f", self.take(4))[0]
        if c == 0xcb: return struct.unpack(">d", self.take(8))[0]
        if c == 0xcc: return self.u8()
        if c == 0xcd: return struct.unpack(">H", self.take(2))[0]
        if c == 0xce: return struct.unpack(">I", self.take(4))[0]
        if c == 0xcf: return struct.unpack(">Q", self.take(8))[0]
        if c == 0xd0: return struct.unpack(">b", self.take(1))[0]
        if c == 0xd1: return struct.unpack(">h", self.take(2))[0]
        if c == 0xd2: return struct.unpack(">i", self.take(4))[0]
        if c == 0xd3: return struct.unpack(">q", self.take(8))[0]
        if c == 0xd4: return self.ext(1)
        if c == 0xd5: return self.ext(2)
        if c == 0xd6: return self.ext(4)
        if c == 0xd7: return self.ext(8)
        if c == 0xd8: return self.ext(16)
        if c == 0xd9: return self.take(self.u8()).decode("utf-8", "replace")
        if c == 0xda: return self.take(struct.unpack(">H", self.take(2))[0]).decode("utf-8", "replace")
        if c == 0xdb: return self.take(struct.unpack(">I", self.take(4))[0]).decode("utf-8", "replace")
        if c == 0xdc: return self.ar(struct.unpack(">H", self.take(2))[0])
        if c == 0xdd: return self.ar(struct.unpack(">I", self.take(4))[0])
        if c == 0xde: return self.mp(struct.unpack(">H", self.take(2))[0])
        if c == 0xdf: return self.mp(struct.unpack(">I", self.take(4))[0])
        if c in (0xc7, 0xc8, 0xc9):
            n = self.u8() if c == 0xc7 else struct.unpack(">H" if c == 0xc8 else ">I", self.take(2 if c == 0xc8 else 4))[0]
            return self.ext_raw(n)
        raise ValueError(f"msgpack byte {c:#x} at {self.i-1}")
    def ext_raw(self, n):
        t = self.u8(); data = self.take(n)
        if t == 0x72:
            sid = int.from_bytes(data, "big")
            if sid not in self.structures:
                keys = self.val()
                self.structures[sid] = keys
            keys = self.structures[sid]
            return {k: self.val() for k in keys}
        return None
    def ar(self, n): return [self.val() for _ in range(n)]
    def mp(self, n):
        d = {}
        for _ in range(n):
            k = self.val(); d[k] = self.val()
        return d

def decode(b):
    return MP(b).val()

def main():
    con = sqlite3.connect(os.path.join(STORE, "index.db"))
    rows = con.execute("SELECT key, data FROM package_index").fetchall()
    pkgs = {}
    bad = 0
    for key, data in rows:
        integrity, nv = key.split("\t", 1)
        at = nv.rfind("@")
        name, ver = nv[:at], nv[at+1:]
        try:
            d = decode(data)
        except Exception as e:
            bad += 1
            print("DECODE FAIL", nv, e)
            continue
        man = d.get("manifest") or {}
        pkgs.setdefault(name, {})[ver] = (integrity, man, d)
    print(f"decoded {len(rows)-bad}/{len(rows)} entries, {len(pkgs)} names")

    # 对照真实样本验证 triple 语义（jsdom 31.0.0 = [260120, 2289]）
    if "jsdom" in pkgs and "31.0.0" in pkgs["jsdom"]:
        integ, man, d = pkgs["jsdom"]["31.0.0"]
        files = d.get("files") or {}
        total = sum((f.get("size") or 0) for f in files.values() if isinstance(f, dict))
        print("jsdom31 manifest-json-len:", len(json.dumps(man, separators=(",", ":"))),
              "files:", len(files), "sum-size:", total,
              "integrity-match:", integ.startswith("sha512-xAkhD9z1"))

    os.makedirs(MIRROR, exist_ok=True)
    written = 0
    now = "2026-11-19T00:00:00.000Z"
    for name, vers in pkgs.items():
        path = os.path.join(MIRROR, name.replace("/", os.sep) + ".jsonl")
        if os.path.exists(path):
            continue  # 已有真实元数据的包不覆盖
        os.makedirs(os.path.dirname(path), exist_ok=True)
        vlist = []
        mans = []
        offset = 0
        for ver, (integ, man, d) in sorted(vers.items()):
            files = d.get("files") or {}
            fcount = len(files)
            m = dict(man)
            m["name"] = name; m["version"] = ver
            m["dist"] = {
                "integrity": integ,
                "shasum": "",
                "tarball": f"{REGISTRY}/{name}/-/{name.split('/')[-1]}-{ver}.tgz",
                "fileCount": fcount,
            }
            mj = json.dumps(m, separators=(",", ":"), ensure_ascii=False)
            mb = mj.encode("utf-8")
            # triple = [版本, manifest 累计字节偏移, manifest 字节长度]（Rust 解析器按此切片）
            vlist.append([ver, offset, len(mb)])
            offset += len(mb)
            mans.append(mj)
        summary = {"name": name, "distTags": {"latest": sorted(vers)[-1]},
                   "time": {v: now for v in vers}, "versions": vlist}
        sj = json.dumps(summary, separators=(",", ":"), ensure_ascii=False)
        body = json.dumps({"modified": now}, separators=(",", ":")) + sj + "".join(mans)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(f"pnpm-meta-v1 39 {len(sj.encode('utf-8'))}\n")
            f.write(body)
        written += 1
    print("metadata files written:", written)

if __name__ == "__main__":
    main()