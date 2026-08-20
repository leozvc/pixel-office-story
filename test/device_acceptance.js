// 真机验收测试：通过 adb forward 连接手机 WebView 的 CDP 端口，驱动真实游戏
// 用法: node test/device_acceptance.js
const { CDP } = require("./cdp.js");

(async () => {
  // 连接手机 WebView CDP (adb forward tcp:9222)
  const pages = await CDP.getJson("/json", 9222);
  const page = pages.find(p => p.url.includes("index.html")) || pages[0];
  console.log("== 真机 WebView 页面 ==");
  console.log("title:", page.title);
  console.log("url:", page.url);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await CDP.send(ws, "Runtime.enable");
  await CDP.send(ws, "Page.enable");
  const exc = [];
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") exc.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") exc.push("CONSOLE: " + m.params.args.map(a => a.value || a.description).join(" ").slice(0, 200));
  });
  const E = async (expr) => CDP.eval(ws, expr);
  const wait = CDP.wait;

  console.log("\n== 1. 页面加载 ==");
  console.log("canvas:", await E("!!document.getElementById('scene')"));
  console.log("boot screen:", await E("!!document.getElementById('boot-screen')"));
  console.log("game globals:", await E("typeof GState + ',' + typeof Game + ',' + typeof PM"));

  // 点开始按钮
  console.log("\n== 2. 点击开始 ==");
  const bootVisible = await E("!document.getElementById('boot-screen').classList.contains('hide')");
  console.log("boot visible:", bootVisible);
  if (bootVisible) {
    await E("document.getElementById('boot-btn').click()");
    await wait(1500);
  }
  console.log("boot hidden:", await E("document.getElementById('boot-screen').classList.contains('hide')"));
  console.log("chat msgs:", await E("document.querySelectorAll('#chat-body .msg').length"));

  // 重置到干净状态（用游戏内 API）
  console.log("\n== 3. 重置状态 ==");
  await E("GState.reset()");
  await E("(function(){ var t=GD.EMP_TYPES.find(x=>x.id==='pm'); var p=PM.makeEmp(t); p.name='佐藤 美咲'; GState.get().employees=[p]; GState.save(); })()");
  await wait(300);
  console.log("money:", await E("GState.get().money"), "emps:", await E("GState.get().employees.length"));

  // 离线玩法
  console.log("\n== 4. 离线招人 ==");
  await E("__test.send('招个程序员')");
  await wait(1500);
  console.log("emps:", await E("GState.get().employees.map(e=>e.typeId).join(',')"));

  console.log("\n== 5. 离线接项目 ==");
  await E("__test.send('接项目')");
  await wait(1500);
  console.log("offer:", await E("GState.get()._lastOffer ? GState.get()._lastOffer.name : 'none'"));
  await E("__test.send('接下')");
  await wait(1500);
  console.log("projects:", await E("GState.get().projects.length"), "tasks:", await E("GState.get().tasks.length"));

  console.log("\n== 6. 完成任务 ==");
  await E("(function(){ const t=GState.get().tasks; for(const x of t){ x.done=x.total; } GState.save(); Game._sim(); })()");
  await wait(600);
  console.log("archive:", await E("GState.get().archive.length"), "money:", await E("GState.get().money"));

  console.log("\n== 7. 真机桥接配对测试 ==");
  // 手机通过局域网访问桥接服务（先试 adb reverse 到宿主机 8866）
  // 在 WebView 中通过 127.0.0.1:8866 走 adb reverse
  await E("UI.openPanel('connect')");
  await wait(400);
  await E("document.getElementById('conn-server').value = 'http://127.0.0.1:8866'");
  await E("document.getElementById('conn-server').dispatchEvent(new Event('change'))");
  await E("document.getElementById('conn-pair-btn').click()");
  await wait(2500);
  const status = await E("document.getElementById('conn-status').textContent");
  console.log("pair status:", status.slice(0, 60));
  const code = await E("(function(){ var m = document.getElementById('conn-status').textContent.match(/(\\d{6})/); return m ? m[1] : null; })()");
  if (code) {
    await E("document.getElementById('conn-code').value = '" + code + "'");
    await E("document.getElementById('conn-confirm-btn').click()");
    await wait(2500);
    console.log("configured:", await E("Bridge.isConfigured()"), "model:", await E("Bridge.getSettings().model"));
    await E("UI.closeAllPanels()");

    console.log("\n== 8. 真机 LLM 对话 ==");
    const before = await E("GState.get().employees.length");
    await E("__test.send('你好，公司最近怎么样')");
    await wait(9000);
    const msgs = await E("Array.from(document.querySelectorAll('#chat-body .msg.pm .bubble')).map(m=>m.textContent)");
    console.log("PM reply:", JSON.stringify(msgs[msgs.length-1].slice(0, 120)));

    await E("__test.send('帮我们招个美术吧')");
    await wait(9000);
    const after = await E("GState.get().employees.length");
    console.log("emps before:", before, "after:", after, "(LLM hire work:", before < after ? "YES" : "NO)");
  } else {
    console.log("pair status no code:", status);
  }

  console.log("\n== exceptions:", exc.length ? exc : "none");
  ws.close();
  process.exit(0);
})().catch(e => { console.error("TEST FAIL:", e.message); process.exit(1); });
