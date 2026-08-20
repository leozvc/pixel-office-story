// CDP 测试助手 —— 用 Node 原生 WebSocket 与 Chrome DevTools 协议交互
const CDP = {
  async getJson(path, port) {
    const r = await fetch(`http://127.0.0.1:${port}${path}`);
    return r.json();
  },
  async newPage(port, url) {
    const r = await fetch(`http://127.0.0.1:${port}/json/new?` + encodeURIComponent(url), { method: "PUT" });
    const l = await r.json();
    const ws = new WebSocket(l.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    return { ws, id: l.id };
  },
  send(ws, method, params = {}) {
    return new Promise((res, rej) => {
      const id = (ws._id = (ws._id || 0) + 1);
      const h = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === id) { ws.removeEventListener("message", h); if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result); }
      };
      ws.addEventListener("message", h);
      ws.send(JSON.stringify({ id, method, params }));
    });
  },
  async eval(ws, expression, awaitPromise = true) {
    const r = await this.send(ws, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text;
      throw new Error("JS Error: " + ex);
    }
    return r.result && r.result.value;
  },
  wait(ms) { return new Promise(r => setTimeout(r, ms)); },
  async screenshot(ws, path) {
    const r = await this.send(ws, "Page.captureScreenshot", { format: "png" });
    require("fs").writeFileSync(path, Buffer.from(r.data, "base64"));
    console.log("screenshot ->", path);
  },
};

async function bootGame(port) {
  const ctx = await CDP.newPage(port, "http://127.0.0.1:8899/game/index.html");
  await CDP.send(ctx.ws, "Runtime.enable");
  await CDP.send(ctx.ws, "Page.enable");
  await CDP.send(ctx.ws, "Network.enable");
  await CDP.send(ctx.ws, "Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await CDP.wait(2500);
  return ctx;
}

module.exports = { CDP, bootGame };
