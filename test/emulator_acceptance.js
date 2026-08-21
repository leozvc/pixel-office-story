// 模拟器验收测试：连接 Android 模拟器 WebView 的 CDP 端口，驱动真实游戏（DSH 任务编排版）
// 前置：模拟器已启动、APK 已安装、adb forward tcp:9231 到 WebView、adb reverse tcp:8867
// 用法: node test/emulator_acceptance.js [port]
// 说明：每个检查在单个 eval 内完成「加载状态 + 渲染 + 断言」，避免跨 eval 状态不一致。
const { CDP } = require("./cdp.js");

const PORT = parseInt(process.argv[2] || "9231", 10);

(async () => {
  const pages = await CDP.getJson("/json", PORT);
  const page = pages.find(p => p.url.includes("index.html")) || pages[0];
  if (!page) { console.error("未找到 WebView 页面（确认 adb forward 已设置）"); process.exit(1); }
  console.log("== 模拟器 WebView 页面 ==");
  console.log("title:", page.title);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await CDP.send(ws, "Runtime.enable");
  const exc = [];
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") exc.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
  });
  const E = async (expr) => CDP.eval(ws, expr);
  const wait = CDP.wait;
  let pass = 0, fail = 0;
  const check = (name, ok) => { console.log((ok ? "  ✅ " : "  ❌ ") + name); ok ? pass++ : fail++; };
  const one = async (expr) => { try { return await E(expr); } catch (e) { return false; } };

  console.log("\n== 1. 页面加载 ==");
  check("canvas 存在", await one("!!document.getElementById('scene')"));
  check("boot screen 存在", await one("!!document.getElementById('boot-screen')"));
  check("游戏全局已加载", await one("['GState','Game','PM','Bridge','UI'].every(k=>typeof window[k]!=='undefined')"));

  console.log("\n== 2. 启动进入办公室 ==");
  await one("(function(){ try { UI.startBoot(); } catch(e){} return true; })()");
  await wait(1500);
  check("boot 已隐藏", await one("document.getElementById('boot-screen').classList.contains('hide')"));
  await one("(function(){ UI.init(); return true; })()");
  check("HUD 可见", await one("!!document.getElementById('hud')"));
  check("PM 欢迎语出现", await one("document.querySelectorAll('#chat-body .msg').length > 0"));

  console.log("\n== 3. 配对状态 ==");
  const cfg = await E("Bridge.getSettings()");
  check("已配置服务器", !!(cfg && cfg.server));
  check("已配对", !!(cfg && cfg.token));
  if (!(cfg && cfg.token)) {
    console.log("  → 未配对，自动配对…");
    const code = await (await fetch("http://127.0.0.1:8867/pair/request", { method: "POST" })).json();
    const tok = await (await fetch("http://127.0.0.1:8867/pair/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.code, deviceName: "emulator-auto" }) })).json();
    const expr = `(() => { const s = { server: "http://127.0.0.1:8867", token: ${JSON.stringify(tok.token)}, deviceName: "emulator-auto", paired: true, model: "" }; localStorage.setItem("pixelOfficeBridgeSettings", JSON.stringify(s)); Bridge.loadSettings(); return Bridge.isConfigured(); })()`;
    check("自动配对成功", await E(expr));
  }

  console.log("\n== 4. 同步与 HUD ==");
  await one("PM.syncFromBridge()");
  await wait(800);
  check("任务数 > 0", await one("GState.load(); GState.get().tasks.length > 0"));
  check("员工数 > 0", await one("GState.load(); GState.get().employees.length > 0"));
  check("资金显示", await one("GState.load(); document.getElementById('hud-funds').textContent.includes('💰')"));
  check("公司等级显示", await one("GState.load(); document.getElementById('hud-title').textContent.includes('Lv.')"));

  console.log("\n== 5. 任务看板 ==");
  check("看板渲染含列", await one("(function(){ GState.load(); UI.openPanel('tasks'); var el=document.getElementById('panel-tasks'); return el && el.querySelectorAll('.kanban-col').length >= 4; })()"));
  check("看板含操作按钮", await one("(function(){ var p=document.getElementById('panel-tasks'); return p && ['总览','归档','统计','周报','建议','项目','新建任务'].every(k=>Array.from(p.querySelectorAll('button')).some(b=>b.textContent.includes(k))); })()"));
  check("任务卡渲染", await one("(function(){ GState.load(); UI.openPanel('tasks'); return document.querySelectorAll('#panel-tasks .task-card').length > 0; })()"));

  console.log("\n== 6. 团队面板 ==");
  check("团队面板打开", await one("(function(){ GState.load(); UI.openPanel('emp'); return document.getElementById('panel-emp').classList.contains('open'); })()"));
  check("员工卡带经验条", await one("(function(){ GState.load(); UI.openPanel('emp'); return document.querySelectorAll('#panel-emp .emp-card').length > 0; })()"));
  check("雇佣按钮带价格", await one("(function(){ GState.load(); UI.openPanel('emp'); return Array.from(document.querySelectorAll('#panel-emp button')).some(b=>b.textContent.includes('💰')); })()"));
  check("公司记忆入口", await one("(function(){ GState.load(); UI.openPanel('emp'); return Array.from(document.querySelectorAll('#panel-emp button')).some(b=>b.textContent.includes('公司记忆')); })()"));

  console.log("\n== 7. 项目总览 ==");
  check("项目总览渲染", await one("(function(){ GState.load(); return UI.renderProjects().then(function(){ return document.getElementById('panel-tasks').innerText.includes('项目总览'); }).catch(function(){ return false; }); })()"));

  console.log("\n== 8. 公司总览 ==");
  check("公司总览渲染", await one("(function(){ GState.load(); return UI.renderDashboard().then(function(){ return document.getElementById('panel-tasks').innerText.includes('公司总览'); }).catch(function(){ return false; }); })()"));

  console.log("\n== 9. 经济面板 ==");
  check("财务面板渲染", await one("(function(){ GState.load(); return UI.renderEconomy().then(function(){ return document.getElementById('panel-tasks').innerText.includes('公司财务'); }).catch(function(){ return false; }); })()"));
  check("资金流水区", await one("(function(){ GState.load(); return UI.renderEconomy().then(function(){ return document.getElementById('panel-tasks').innerText.includes('资金流水'); }).catch(function(){ return false; }); })()"));

  console.log("\n== 10. JS 异常 ==");
  check("无未捕获异常", exc.length === 0);
  if (exc.length) exc.forEach(e => console.log("   ", e));

  console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`);
  ws.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("测试异常:", e.message); process.exit(1); });
