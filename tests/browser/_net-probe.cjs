// 探测从命令行到 GitHub 的可用通道（git push 需要其中之一）
const net = require("net");

function tryTcp(host, port, timeout = 6000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok, why) => {
      try { sock.destroy(); } catch {}
      resolve(`${host}:${port} → ${ok ? "可达" : "不可达"} (${why})`);
    };
    sock.setTimeout(timeout);
    sock.on("connect", () => done(true, "连接成功"));
    sock.on("timeout", () => done(false, "超时"));
    sock.on("error", (e) => done(false, e.code || e.message));
  });
}

(async () => {
  const targets = [
    ["github.com", 443],
    ["github.com", 22],
    ["ssh.github.com", 443],
    ["api.github.com", 443],
  ];
  for (const [h, p] of targets) {
    console.log(await tryTcp(h, p));
  }
  // 再测经代理的 HTTP 通道（用 CONNECT 语义）
  const proxy = process.env.https_proxy;
  console.log("\n代理:", proxy);
  if (proxy) {
    const m = /^http:\/\/([^:/]+):(\d+)/.exec(proxy);
    if (m) {
      console.log(await tryTcp(m[1], Number(m[2])));
    }
  }
})();
