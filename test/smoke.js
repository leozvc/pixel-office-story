// 冒烟测试：加载、启动、初始状态
const { CDP, bootGame } = require("./cdp.js");

(async () => {
  const ctx = await bootGame(9250);
  const E = async (expr) => CDP.eval(ctx.ws, expr);

  console.log("== 1. 页面加载 ==");
  console.log("title:", await E("document.title"));
  console.log("has canvas:", await E("!!document.getElementById('scene')"));
  console.log("has boot:", await E("!!document.getElementById('boot-screen')"));

  console.log("\n== 2. 点击开始 ==");
  await E("document.getElementById('boot-btn').click()");
  await CDP.wait(1500);
  console.log("boot hidden:", await E("document.getElementById('boot-screen').classList.contains('hide')"));
  console.log("chat msgs:", await E("document.querySelectorAll('#chat-body .msg').length"));
  console.log("pm text:", await E("document.querySelector('#chat-body .msg.pm .bubble') ? document.querySelector('#chat-body .msg.pm .bubble').textContent.slice(0,50) : 'none'"));

  console.log("\n== 3. 初始 HUD ==");
  console.log("money:", await E("GState.get().money"));
  console.log("employees:", await E("GState.get().employees.length"));
  console.log("hud emp:", await E("document.getElementById('hud-emp').textContent"));

  await CDP.screenshot(ctx.ws, "test/screenshots/01_boot.png");
  await CDP.wait(500);
  await CDP.screenshot(ctx.ws, "test/screenshots/02_start.png");

  ctx.ws.close();
  process.exit(0);
})().catch(e => { console.error("TEST FAIL:", e.message); process.exit(1); });
