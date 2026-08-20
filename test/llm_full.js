// 完整 LLM 游戏循环：招聘->接单->开发->完成
const { CDP } = require("./cdp.js");

(async () => {
  const ctx = await CDP.newPage(9250, "about:blank");
  await CDP.send(ctx.ws, "Runtime.enable");
  await CDP.send(ctx.ws, "Page.enable");
  const exc = [];
  ctx.ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") exc.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
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

  // 配对
  await E("UI.openPanel('connect')");
  await wait(400);
  await E("document.getElementById('conn-server').value = 'http://127.0.0.1:8866'");
  await E("document.getElementById('conn-server').dispatchEvent(new Event('change'))");
  await E("document.getElementById('conn-pair-btn').click()");
  await wait(1500);
  const code = await E("(function(){ var m = document.getElementById('conn-status').textContent.match(/(\\d{6})/); return m ? m[1] : null; })()");
  await E("document.getElementById('conn-code').value = '" + code + "'");
  await E("document.getElementById('conn-confirm-btn').click()");
  await wait(1500);
  console.log("configured:", await E("Bridge.isConfigured()"));
  await E("UI.closeAllPanels()");

  // 用 LLM 招聘满团队
  console.log("\n== LLM 招聘程序员 ==");
  await E("__test.send('招个程序员')");
  await wait(9000);
  console.log("emps:", await E("GState.get().employees.map(e=>e.typeId).join(',')"));

  console.log("\n== LLM 招聘美术 ==");
  await E("__test.send('再招个美术')");
  await wait(9000);
  console.log("emps:", await E("GState.get().employees.map(e=>e.typeId).join(',')"));

  console.log("\n== LLM 招聘测试 ==");
  await E("__test.send('再招个测试')");
  await wait(9000);
  console.log("emps:", await E("GState.get().employees.map(e=>e.typeId).join(',')"));

  console.log("\n== LLM 接项目 ==");
  await E("__test.send('接个项目')");
  await wait(9000);
  console.log("_lastOffer:", await E("GState.get()._lastOffer ? GState.get()._lastOffer.name : 'none'"));
  console.log("_lastOffer required:", await E("GState.get()._lastOffer ? GState.get()._lastOffer.required.join(',') : ''"));

  console.log("\n== LLM 接下 ==");
  await E("__test.send('接下')");
  await wait(9000);
  console.log("projects:", await E("GState.get().projects.length"), "tasks:", await E("GState.get().tasks.length"));
  const msgs = await E("Array.from(document.querySelectorAll('#chat-body .msg.pm .bubble')).map(m=>m.textContent)");
  console.log("PM last:", JSON.stringify(msgs[msgs.length - 1].slice(0, 80)));

  console.log("\n== 自然推进 60s（等待项目完成） ==");
  const startProj = await E("GState.get().projects.length");
  await wait(60000);
  console.log("projects now:", await E("GState.get().projects.length"), "archive:", await E("GState.get().archive.length"));
  console.log("money:", await E("GState.get().money"));
  const notif = await E("GState.get().notifications[0] ? GState.get().notifications[0].title : 'none'");
  console.log("latest notif:", notif);

  console.log("\n== exceptions:", exc.length ? exc : "none");
  await CDP.screenshot(ctx.ws, "test/screenshots/21_llm_full.png");
  ctx.ws.close();
  process.exit(0);
})().catch(e => { console.error("TEST FAIL:", e.message); process.exit(1); });
