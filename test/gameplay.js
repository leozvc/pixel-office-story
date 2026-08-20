// 玩法循环测试：招人 -> 接项目 -> 开工 -> 模拟完成
const { CDP, bootGame } = require("./cdp.js");

(async () => {
  const ctx = await bootGame(9250);
  const E = async (expr) => CDP.eval(ctx.ws, expr);
  const wait = CDP.wait;

  // 启动
  await E("document.getElementById('boot-btn').click()");
  await wait(1200);

  // 重置到干净状态
  await E("GState.reset()");
  await E("(function(){ var t=GD.EMP_TYPES.find(x=>x.id==='pm'); var p=PM.makeEmp(t); p.name='佐藤 美咲'; GState.get().employees=[p]; GState.save(); })()");
  await wait(300);

  console.log("== 1. 初始状态 ==");
  console.log("money:", await E("GState.get().money"), "emps:", await E("GState.get().employees.length"));

  console.log("\n== 2. 招程序员 ==");
  await E("__test.send('招个程序员')");
  await wait(1500);
  console.log("money after hire:", await E("GState.get().money"));
  console.log("emps:", await E("GState.get().employees.length"));
  console.log("emp types:", await E("GState.get().employees.map(e=>e.typeId).join(',')"));

  console.log("\n== 3. 招美术 + 测试 ==");
  await E("__test.send('招人')");
  await wait(1200);
  await E("__test.send('再招人')");
  await wait(1200);
  console.log("emps:", await E("GState.get().employees.map(e=>e.typeId).join(',')"));
  console.log("money:", await E("GState.get().money"));

  console.log("\n== 4. 接项目 ==");
  await E("__test.send('接项目')");
  await wait(1200);
  console.log("projects:", await E("GState.get().projects.length"));
  console.log("last offer:", await E("!!GState.get()._lastOffer"));
  const projName = await E("GState.get()._lastOffer ? GState.get()._lastOffer.name : 'none'");
  console.log("offer:", projName);

  console.log("\n== 5. 接下 ==");
  await E("__test.send('接下')");
  await wait(1200);
  console.log("projects after accept:", await E("GState.get().projects.length"));
  console.log("tasks:", await E("GState.get().tasks.length"));
  console.log("tasks detail:", await E("JSON.stringify(GState.get().tasks.map(t=>({type:t.typeId,done:t.done,total:t.total})))"));

  console.log("\n== 6. 快进模拟 ==");
  await E("(function(){ const t=GState.get().tasks; for(const x of t){ x.done=x.total; } GState.save(); Game._sim(); return 'forced'; })()");
  await wait(400);
  console.log("tasks after force:", await E("GState.get().tasks.length"));
  console.log("projects after force:", await E("GState.get().projects.length"));
  console.log("archive:", await E("GState.get().archive.length"));
  console.log("money after reward:", await E("GState.get().money"));
  console.log("reputation:", await E("GState.get().reputation"));
  console.log("stats.projectsDone:", await E("GState.get().stats.projectsDone"));

  console.log("\n== 7. 通知 ==");
  console.log("notifications:", await E("GState.get().notifications.length"));
  console.log("last notif:", await E("GState.get().notifications[0] ? GState.get().notifications[0].title : 'none'"));

  await wait(800);
  console.log("\n== 8. 项目面板 ==");
  await E("UI.openPanel('proj')");
  await wait(600);
  console.log("panel open:", await E("document.getElementById('panel-proj').classList.contains('open')"));
  console.log("panel content len:", await E("document.getElementById('panel-proj').querySelector('.panel-body').textContent.length"));

  await CDP.screenshot(ctx.ws, "test/screenshots/03_projects.png");
  await E("UI.closeAllPanels()");

  console.log("\n== 9. 档案 ==");
  await E("UI.openPanel('archive')");
  await wait(500);
  console.log("archive items:", await E("document.querySelectorAll('#panel-archive .archive-item').length"));
  await CDP.screenshot(ctx.ws, "test/screenshots/04_archive.png");
  await E("UI.closeAllPanels()");

  console.log("\n== 10. 汇报 ==");
  await E("__test.send('汇报进度')");
  await wait(1200);
  const lastMsg = await E("Array.from(document.querySelectorAll('#chat-body .msg.pm .bubble')).pop().textContent");
  console.log("PM reply:", lastMsg.slice(0, 120));

  ctx.ws.close();
  process.exit(0);
})().catch(e => { console.error("TEST FAIL:", e.message); process.exit(1); });
