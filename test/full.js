// 综合玩法测试
const { CDP } = require("./cdp.js");

(async () => {
  const ctx = await CDP.newPage(9250, "about:blank");
  await CDP.send(ctx.ws, "Runtime.enable");
  await CDP.send(ctx.ws, "Page.enable");
  const exc = [];
  ctx.ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") exc.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
  });
  await CDP.send(ctx.ws, "Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await CDP.send(ctx.ws, "Page.navigate", { url: "http://127.0.0.1:8899/game/index.html?x=" + Date.now() });
  await CDP.wait(2500);
  const E = async (expr) => CDP.eval(ctx.ws, expr);
  const wait = CDP.wait;

  await E("document.getElementById('boot-btn').click()");
  await wait(1000);
  await E("GState.reset()");
  await E("(function(){ var t=GD.EMP_TYPES.find(x=>x.id==='pm'); var p=PM.makeEmp(t); p.name='佐藤 美咲'; GState.get().employees=[p]; GState.save(); })()");

  const chat = async (t) => { await E("__test.send('" + t + "')"); await wait(1200); };

  console.log("== 意图测试 ==");
  await chat("你好");
  console.log("greet ok:", await E("GState.get().employees.length > 0"));

  await chat("钱不够了怎么办");
  console.log("money ok");

  await chat("接项目");
  const offer = await E("GState.get()._lastOffer ? GState.get()._lastOffer.name : null");
  console.log("offer:", offer);

  // 先不接，测试人数不够
  await chat("接下");
  const r1 = await E("Array.from(document.querySelectorAll('#chat-body .msg.pm .bubble')).pop().textContent");
  console.log("accept w/o team:", r1.slice(0, 40));

  await chat("招程序员"); await chat("招美术"); await chat("招测试");
  console.log("team:", await E("GState.get().employees.map(e=>e.typeId).join(',')"));

  await chat("接下");
  const r2 = await E("Array.from(document.querySelectorAll('#chat-body .msg.pm .bubble')).pop().textContent");
  console.log("accept with team:", r2.slice(0, 40));
  console.log("projects:", await E("GState.get().projects.length"), "tasks:", await E("GState.get().tasks.length"));

  // 进度推进
  await E("(function(){ const t=GState.get().tasks; for(const x of t){ x.done=x.total; } GState.save(); Game._sim(); })()");
  await wait(600);
  console.log("archive after force:", await E("GState.get().archive.length"));
  console.log("notif count:", await E("GState.get().notifications.length"));
  console.log("toast visible:", await E("document.querySelectorAll('#toasts .toast').length"));

  // 升级面板
  await E("UI.openPanel('shop')");
  await wait(400);
  console.log("shop panel:", await E("document.getElementById('panel-shop').classList.contains('open')"));
  console.log("shop items:", await E("document.querySelectorAll('#panel-shop .archive-item').length"));
  await CDP.screenshot(ctx.ws, "test/screenshots/10_shop.png");
  await E("UI.closeAllPanels()");

  // 员工点击
  await E("(function(){ var emp=GState.get().employees[1]; GameEvents.onEmpClick(emp); })()");
  await wait(400);
  console.log("emp panel:", await E("document.getElementById('panel-emp').classList.contains('open')"));
  await CDP.screenshot(ctx.ws, "test/screenshots/11_emp.png");
  await E("UI.closeAllPanels()");

  // 通知面板
  await E("UI.openPanel('notif')");
  await wait(400);
  console.log("notif panel items:", await E("document.querySelectorAll('#panel-notif .notif-item').length"));
  await CDP.screenshot(ctx.ws, "test/screenshots/12_notif.png");

  console.log("\n== exceptions:", exc.length ? exc : "none");
  ctx.ws.close();
  process.exit(0);
})().catch(e => { console.error("TEST FAIL:", e.message); process.exit(1); });
