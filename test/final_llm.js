// 最终联调：file://（模拟 APK WebView）下完整 LLM 游戏流程
// 配对 → LLM 招聘 → LLM 接项目 → LLM 接下 → 自然完成
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
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") issues.push("CONSOLE: " + m.params.args.map(a => a.value || a.description).join(" ").slice(0, 200));
  });
  await CDP.send(ctx.ws, "Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await CDP.send(ctx.ws, "Page.navigate", { url: "file:///tmp/pixel-office-game/game/index.html" });
  await CDP.wait(3000);
  const E = async (expr) => CDP.eval(ctx.ws, expr);
  const wait = CDP.wait;

  console.log("=== APK WebView 环境（file://）完整联调 ===");
  console.log("标题:", await E("document.title"));

  await E("document.getElementById('boot-btn').click()");
  await wait(1000);
  await E("GState.reset()");
  await E("(function(){ var t=GD.EMP_TYPES.find(x=>x.id==='pm'); var p=PM.makeEmp(t); p.name='佐藤 美咲'; GState.get().employees=[p]; GState.save(); })()");

  console.log("\n[1] 配对流程");
  await E("UI.openPanel('connect')");
  await wait(400);
  await E("document.getElementById('conn-server').value = 'http://127.0.0.1:8866'");
  await E("document.getElementById('conn-server').dispatchEvent(new Event('change'))");
  await E("document.getElementById('conn-pair-btn').click()");
  await wait(2000);
  const code = await E("(function(){ var m = document.getElementById('conn-status').textContent.match(/(\\d{6})/); return m ? m[1] : null; })()");
  console.log("  配对码:", code);
  await E("document.getElementById('conn-code').value = '" + code + "'");
  await E("document.getElementById('conn-confirm-btn').click()");
  await wait(2000);
  console.log("  已连接:", await E("Bridge.isConfigured()"), "| 模型:", await E("Bridge.getSettings().model"));
  await E("UI.closeAllPanels()");

  console.log("\n[2] LLM 招聘（程序员/美术/测试）");
  for (const c of ["招个程序员", "再招个美术", "再招个测试"]) {
    await E("__test.send('" + c + "')");
    await wait(8000);
  }
  console.log("  团队:", await E("GState.get().employees.map(e=>e.typeId).join(',')"));

  console.log("\n[3] LLM 接项目");
  await E("__test.send('接个项目')");
  await wait(8000);
  console.log("  推荐:", await E("GState.get()._lastOffer ? GState.get()._lastOffer.name + ' (需要 ' + GState.get()._lastOffer.required.join(',') + ')' : 'none'"));

  console.log("\n[4] LLM 接下");
  await E("__test.send('接下')");
  await wait(8000);
  console.log("  项目:", await E("GState.get().projects.length"), "任务:", await E("GState.get().tasks.length"));

  console.log("\n[5] 自然推进 60s（项目自动完成）");
  await wait(60000);
  console.log("  档案:", await E("GState.get().archive.length"), "资金:", await E("GState.get().money"));
  console.log("  最新通知:", await E("GState.get().notifications[0] ? GState.get().notifications[0].title : 'none'"));
  console.log("  toast 出现:", await E("document.querySelectorAll('#toasts .toast').length > 0"));

  console.log("\n[6] 报告检查");
  await E("__test.send('汇报一下')");
  await wait(8000);
  const msgs = await E("Array.from(document.querySelectorAll('#chat-body .msg.pm .bubble')).map(m=>m.textContent)");
  console.log("  PM 最后回复:", JSON.stringify(msgs[msgs.length - 1].slice(0, 100)));

  console.log("\n=== 问题:", issues.length ? issues : "无");
  await CDP.screenshot(ctx.ws, "test/screenshots/30_final_llm_apk.png");
  ctx.ws.close();
  process.exit(0);
})().catch(e => { console.error("TEST FAIL:", e.message); process.exit(1); });
