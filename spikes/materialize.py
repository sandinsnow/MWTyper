# pnpm 12 frozen restore 会静默跳过平台可选包（本机复现，原因未明）。
# 本脚本按 store index.db 的 files 映射把指定包落盘到 pnpm 布局并 junction 进宿主。
# 用法：python spikes/materialize.py  （清单在 PAIRS；重装 node_modules 后需重跑）
import sqlite3, os, shutil, subprocess, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("sm", os.path.join(HERE, "store-meta.py"))
sm = importlib.util.module_from_spec(spec); spec.loader.exec_module(sm)

STORE = os.path.expanduser(r"~\scoop\apps\pnpm\current\store\v11")
NM = os.path.join(os.path.dirname(HERE), "node_modules", ".pnpm")

# (包名@版本, 宿主 .pnpm 目录名)
PAIRS = [
    ("@esbuild/win32-x64@0.25.12", "esbuild@0.25.12"),
    ("@esbuild/win32-x64@0.28.2", "esbuild@0.28.2"),
    ("@rollup/rollup-win32-x64-msvc@4.52.2", "rollup@4.52.2"),
    ("@tauri-apps/cli-win32-x64-msvc@2.11.4", "@tauri-apps+cli@2.11.4"),
]

def esc(nv):
    return nv.replace("/", "+")

def main():
    con = sqlite3.connect(os.path.join(STORE, "index.db"))
    for nv, host in PAIRS:
        row = con.execute("SELECT data FROM package_index WHERE key LIKE ?", ("%" + nv,)).fetchone()
        if not row:
            print("NOT IN STORE:", nv); continue
        d = sm.decode(row[0])
        files = d.get("files") or {}
        name = nv.rsplit("@", 1)[0]
        dest = os.path.join(NM, esc(nv), "node_modules", name)
        n = 0
        for path, info in files.items():
            if not isinstance(info, dict) or not info.get("digest"):
                continue
            dig = info["digest"]
            src = os.path.join(STORE, "files", dig[:2], dig[2:])
            out = os.path.join(dest, path.replace("/", os.sep))
            os.makedirs(os.path.dirname(out), exist_ok=True)
            if not os.path.exists(out):
                shutil.copy2(src, out)
            n += 1
        link = os.path.join(NM, host, "node_modules", name).replace("/", os.sep)
        dest = dest.replace("/", os.sep)
        if not os.path.exists(link):
            os.makedirs(os.path.dirname(link), exist_ok=True)
            r = subprocess.run(["cmd", "/c", "mklink", "/J", link, dest],
                               capture_output=True, text=True)
            if r.returncode != 0:
                print("JUNCTION FAIL:", link, r.stderr.strip()); continue
        print(f"OK {nv}: {n} files -> {host}")

if __name__ == "__main__":
    main()