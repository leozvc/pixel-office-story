// 联机测试：游戏内配对 + 真实 LLM 对话
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

  console.log("== 1. 打开连接面板 ==");
  await E("UI.openPanel('connect')");
  await wait(500);
  console.log("panel open:", await E("document.getElementById('panel-connect').classList.contains('open')"));

  console.log("\n== 2. 填入服务器地址 ==");
  await E("document.getElementById('conn-server').value = 'http://127.0.0.1:8866'");
  await E("document.getElementById('conn-server').dispatchEvent(new Event('change'))");
  await wait(300);

  console.log("\n== 3. 获取配对码 ==");
  await E("document.getElementById('conn-pair-btn').click()");
  await wait(1500);
  console.log("status:", await E("document.getElementById('conn-status').textContent"));

  // 读取配对码（从通知或面板）
  const code = await E("(function(){ var m = document.getElementById('conn-status').textContent.match(/(\\d{6})/); return m ? m[1] : null; })()");
  console.log("配对码:", code);

  console.log("\n== 4. 确认配对 ==");
  await E("document.getElementById('conn-code').value = '" + code + "'");
  await E("document.getElementById('conn-confirm-btn').click()");
  await wait(1500);
  console.log("status:", await E("document.getElementById('conn-status').textContent"));
  console.log("Bridge configured:", await E("Bridge.isConfigured()"));

  console.log("\n== 5. 真实 LLM 对话 ==");
  await E("UI.closeAllPanels()");
  await E("__test.send('你好，最近公司怎么样？')");
  await wait(8000);
  const msgs = await E("Array.from(document.querySelectorAll('#chat-body .msg.pm .bubble')).map(m=>m.textContent)");
  console.log("PM 最后回复:", JSON.stringify(msgs[msgs.length - 1].slice(0, 150)));

  console.log("\n== 6. 再测试一个动作对话 ==");
  await E("__test.send('帮我们招个程序员吧')");
  await wait(8000);
  const msgs2 = await E("Array.from(document.querySelectorAll('#chat-body .msg.pm .bubble')).map(m=>m.textContent)");
  console.log("PM 最后回复:", JSON.stringify(msgs2[msgs2.length - 1].slice(0, 150)));
  console.log("员工数:", await E("GState.get().employees.length"));

  console.log("\n== exceptions:", exc.length ? exc : "none");
  await CDP.screenshot(ctx.ws, "test/screenshots/20_llm_connected.png");
  ctx.ws.close();
  process.exit(0);
})().catch(e => { console.error("TEST FAIL:", e.message); process.exit(1); });
