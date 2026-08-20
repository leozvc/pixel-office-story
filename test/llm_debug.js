// 调试：LLM 动作触发
const { CDP } = require("./cdp.js");
const fs = require("fs");

(async () => {
  const ctx = await CDP.newPage(9250, "about:blank");
  await CDP.send(ctx.ws, "Runtime.enable");
  await CDP.send(ctx.ws, "Page.enable");
  const exc = [];
  ctx.ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") exc.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
    if (m.method === "Runtime.consoleAPICalled") console.log("[console." + m.params.type + "]", m.params.args.map(a => a.value || a.description).join(" ").slice(0, 300));
  });
  await CDP.send(ctx.ws, "Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await CDP.send(ctx.ws, "Page.navigate", { url: "http://127.0.0.1:8899/game/index.html?x=" + Date.now() });
  await CDP.wait(2500);
  const E = async (expr) => CDP.eval(ctx.ws, expr);
  const wait = CDP.wait;

  await E("document.getElementById('boot-btn').click()");
  await wait(800);
  await E("GState.reset()");
  await E("(function(){ var t=GD.EMP_TYPES.find(x=>x.id==='pm'); var p=PM.makeEmp(t); p.name='佐藤 美咲'; GState.get().employees=[p]; GState.save(); })()");

  // 通过 UI 配对（复用真正的配对流程）
  await E("UI.openPanel('connect')");
  await wait(400);
  await E("document.getElementById('conn-server').value = 'http://127.0.0.1:8866'");
  await E("document.getElementById('conn-server').dispatchEvent(new Event('change'))");
  await E("document.getElementById('conn-pair-btn').click()");
  await wait(1500);
  const code = await E("(function(){ var m = document.getElementById('conn-status').textContent.match(/(\\d{6})/); return m ? m[1] : null; })()");
  console.log("code:", code);
  await E("document.getElementById('conn-code').value = '" + code + "'");
  await E("document.getElementById('conn-confirm-btn').click()");
  await wait(1500);
  console.log("configured:", await E("Bridge.isConfigured()"));
  await E("UI.closeAllPanels()");

  // 测试 offer_project 动作
  console.log("\n== 测试：帮我们接个项目吧 ==");
  await E("__test.send('帮我们接个项目吧')");
  await wait(10000);
  console.log("_lastOffer set:", await E("!!GState.get()._lastOffer"));
  const msgs = await E("Array.from(document.querySelectorAll('#chat-body .msg.pm .bubble')).map(m=>m.textContent)");
  console.log("chat count:", msgs.length);
  msgs.slice(-4).forEach((m, i) => console.log("  [" + i + "]", m.slice(0, 80)));

  console.log("\n== 测试：接下 ==");
  await E("__test.send('接下')");
  await wait(10000);
  console.log("projects:", await E("GState.get().projects.length"), "tasks:", await E("GState.get().tasks.length"));
  const msgs2 = await E("Array.from(document.querySelectorAll('#chat-body .msg.pm .bubble')).map(m=>m.textContent)");
  msgs2.slice(-3).forEach((m, i) => console.log("  [" + i + "]", m.slice(0, 80)));

  console.log("\nexceptions:", exc.length ? exc : "none");
  ctx.ws.close();
  process.exit(0);
})().catch(e => { console.error("TEST FAIL:", e.message); process.exit(1); });
