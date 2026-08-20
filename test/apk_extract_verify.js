// 终极验证：直接从最终 APK 提取的 game 文件，在 file://（WebView 环境）下
// 配对 → LLM 对话 → 完整游戏循环
const { CDP } = require("./cdp.js");

(async () => {
  const ctx = await CDP.newPage(9250, "about:blank");
  await CDP.send(ctx.ws, "Runtime.enable");
  await CDP.send(ctx.ws, "Page.enable");
  await CDP.send(ctx.ws, "Network.enable");
  const issues = [];
  ctx.ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") issues.push("EXC: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
    if (m.method === "Network.loadingFailed") issues.push("NET: " + m.params.errorText);
  });
  await CDP.send(ctx.ws, "Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await CDP.send(ctx.ws, "Page.navigate", { url: "file:///tmp/apk_verify_game/game/index.html" });
  await CDP.wait(3000);
  const E = async (expr) => CDP.eval(ctx.ws, expr);
  const wait = CDP.wait;

  console.log("=== 最终 APK 提取文件的完整联调 ===");
  console.log("标题:", await E("document.title"), "| Bridge:", await E("typeof Bridge"));

  await E("document.getElementById('boot-btn').click()");
  await wait(1000);
  await E("GState.reset()");
  await E("(function(){ var t=GD.EMP_TYPES.find(x=>x.id==='pm'); var p=PM.makeEmp(t); p.name='佐藤 美咲'; GState.get().employees=[p]; GState.save(); })()");

  // 配对
  await E("UI.openPanel('connect')");
  await wait(400);
  await E("document.getElementById('conn-server').value = 'http://127.0.0.1:8866'");
  await E("document.getElementById('conn-server').dispatchEvent(new Event('change'))");
  await E("document.getElementById('conn-pair-btn').click()");
  await wait(2000);
  const code = await E("(function(){ var m = document.getElementById('conn-status').textContent.match(/(\\d{6})/); return m ? m[1] : null; })()");
  console.log("[1] 配对码:", code);
  await E("document.getElementById('conn-code').value = '" + code + "'");
  await E("document.getElementById('conn-confirm-btn').click()");
  await wait(2000);
  console.log("[2] 已连接:", await E("Bridge.isConfigured()"), "| 模型:", await E("Bridge.getSettings().model"));
  await E("UI.closeAllPanels()");

  // LLM 招聘
  for (const c of ["招个程序员", "再招个美术"]) {
    await E("__test.send('" + c + "')");
    await wait(8000);
  }
  console.log("[3] LLM 招聘后团队:", await E("GState.get().employees.map(e=>e.typeId).join(',')"));

  // LLM 对话
  await E("__test.send('最近怎么样？')");
  await wait(8000);
  const msgs = await E("Array.from(document.querySelectorAll('#chat-body .msg.pm .bubble')).map(m=>m.textContent)");
  console.log("[4] LLM 闲聊回复:", JSON.stringify(msgs[msgs.length - 1].slice(0, 100)));

  console.log("=== 问题:", issues.length ? issues : "无");
  await CDP.screenshot(ctx.ws, "test/screenshots/32_apk_extracted.png");
  ctx.ws.close();
  process.exit(0);
})().catch(e => { console.error("TEST FAIL:", e.message); process.exit(1); });
