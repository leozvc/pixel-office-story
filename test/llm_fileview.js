// WebView 模拟测试：file:// 协议下真实 LLM 配对+对话（完全模拟 APK 环境）
const { CDP } = require("./cdp.js");

(async () => {
  const ctx = await CDP.newPage(9250, "about:blank");
  await CDP.send(ctx.ws, "Runtime.enable");
  await CDP.send(ctx.ws, "Page.enable");
  const exc = [];
  const netFails = [];
  ctx.ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") exc.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
    if (m.method === "Network.loadingFailed") netFails.push(m.params.errorText + " " + m.params.blockedReason);
  });
  await CDP.send(ctx.ws, "Network.enable");
  await CDP.send(ctx.ws, "Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  // file:// 协议，模拟 WebView
  await CDP.send(ctx.ws, "Page.navigate", { url: "file:///tmp/pixel-office-game/game/index.html" });
  await CDP.wait(3000);
  const E = async (expr) => CDP.eval(ctx.ws, expr);
  const wait = CDP.wait;

  console.log("title:", await E("document.title"));
  console.log("Bridge loaded:", await E("typeof Bridge"));

  await E("document.getElementById('boot-btn').click()");
  await wait(1000);
  await E("GState.reset()");
  await E("(function(){ var t=GD.EMP_TYPES.find(x=>x.id==='pm'); var p=PM.makeEmp(t); p.name='佐藤 美咲'; GState.get().employees=[p]; GState.save(); })()");

  console.log("\n== file:// 下配对 ==");
  await E("UI.openPanel('connect')");
  await wait(400);
  await E("document.getElementById('conn-server').value = 'http://127.0.0.1:8866'");
  await E("document.getElementById('conn-server').dispatchEvent(new Event('change'))");
  await E("document.getElementById('conn-pair-btn').click()");
  await wait(2000);
  const status1 = await E("document.getElementById('conn-status').textContent");
  console.log("pair status:", status1.slice(0, 60));
  const code = await E("(function(){ var m = document.getElementById('conn-status').textContent.match(/(\\d{6})/); return m ? m[1] : null; })()");
  console.log("code:", code);
  await E("document.getElementById('conn-code').value = '" + code + "'");
  await E("document.getElementById('conn-confirm-btn').click()");
  await wait(2000);
  console.log("configured:", await E("Bridge.isConfigured()"));
  await E("UI.closeAllPanels()");

  console.log("\n== file:// 下真实 LLM 对话 ==");
  await E("__test.send('你好，汇报一下公司情况')");
  await wait(9000);
  const msgs = await E("Array.from(document.querySelectorAll('#chat-body .msg.pm .bubble')).map(m=>m.textContent)");
  console.log("PM:", JSON.stringify(msgs[msgs.length - 1].slice(0, 120)));

  console.log("\n== file:// 下 LLM 招人 ==");
  const before = await E("GState.get().employees.length");
  await E("__test.send('招个运营')");
  await wait(9000);
  const after = await E("GState.get().employees.length");
  console.log("emps before:", before, "after:", after);

  console.log("\n== network fails:", netFails.length ? netFails : "none");
  console.log("== exceptions:", exc.length ? exc : "none");
  await CDP.screenshot(ctx.ws, "test/screenshots/22_webview_file.png");
  ctx.ws.close();
  process.exit(0);
})().catch(e => { console.error("TEST FAIL:", e.message); process.exit(1); });
