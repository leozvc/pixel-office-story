// UI 控制器 —— DSH 任务编排版
// 面板：连接 / 团队（员工 agent）/ 任务 / 通知
window.UI = (function () {
  const S = GState;
  let el = {};
  let bootDone = false;
  let currentEmp = null;

  const $ = id => document.getElementById(id);

  function init() {
    el = {
      hud: $("hud"), emp: $("hud-team"),
      bell: $("hud-bell"), badge: $("hud-bell").querySelector(".badge"),
      sound: $("hud-sound"), net: $("hud-net"),
      chatBody: $("chat-body"), chatInput: $("chat-input"), chatSend: $("chat-send"), chatHead: $("chat-head"),
      quickRow: $("quick-row"),
      toasts: $("toasts"),
      scene: $("scene"),
      boot: $("boot-screen"), bootBtn: $("boot-btn"),
      panels: { emp: $("panel-emp"), tasks: $("panel-tasks"), notif: $("panel-notif"), connect: $("panel-connect") },
    };

    if (el.net) el.net.addEventListener("click", () => openPanel("connect"));
    if (el.bell) el.bell.addEventListener("click", () => openPanel("notif"));
    const empBtn = $("hud-team"); if (empBtn) empBtn.addEventListener("click", () => openPanel("emp"));
    const taskBtn = $("hud-tasks"); if (taskBtn) taskBtn.addEventListener("click", () => openPanel("tasks"));
    el.sound.addEventListener("click", toggleSound);
    el.chatSend.addEventListener("click", sendChat);
    el.chatInput.addEventListener("keydown", e => { if (e.key === "Enter") sendChat(); });
    el.bootBtn.addEventListener("click", startBoot);

    const chips = ["你好", "招个程序员", "招个美术", "帮我安排一个任务：开发一个登录页面", "汇报进度"];
    el.quickRow.innerHTML = "";
    for (const c of chips) {
      const b = document.createElement("button");
      b.className = "quick-chip"; b.textContent = c;
      b.addEventListener("click", () => { el.chatInput.value = c; sendChat(); });
      el.quickRow.appendChild(b);
    }

    document.querySelectorAll(".panel-overlay").forEach(o => {
      o.addEventListener("click", e => { if (e.target === o) closeAllPanels(); });
    });
    document.querySelectorAll(".panel .close").forEach(b => {
      b.addEventListener("click", closeAllPanels);
    });

    S.on(renderHUD);
    S.on(renderBadge);

    if (window.Bridge) Bridge.loadSettings();
    updateNetIndicator();
    renderHUD(); renderBadge();

    // 若已连接，自动同步真实员工/任务
    if (window.Bridge && Bridge.isConfigured() && window.PM) {
      PM.syncFromBridge().catch(() => {});
    }
  }

  function greetingText() {
    return "老板好！我是项目经理佐藤美咲。本版本已接入真实 DeepSeek harness：我手下都是真实运行的 AI agent。\n\n你可以：\n· 说「招个程序员/美术/测试/运营」雇佣真实 agent 员工\n· 说「帮我安排一个任务：…」我会把任务派给合适的员工去真实执行\n· 说「汇报进度」我汇总各员工 agent 的真实工作成果\n\n记得先点右上角 ⚡ 连接 DSH 桥接。";
  }

  function startBoot() {
    SFX.init();
    SFX.play("open");
    SFX.startBGM();
    el.boot.classList.add("hide");
    bootDone = true;
    setTimeout(() => el.boot.style.display = "none", 500);
    setTimeout(() => addPM(greetingText()), 400);
  }

  // ---------- 聊天 ----------
  function sendChat() {
    const v = el.chatInput.value.trim();
    if (!v) return;
    addBoss(v);
    el.chatInput.value = "";
    showTyping();
    Promise.resolve(PM.respond(v)).then(reply => {
      hideTyping();
      addPM(reply);
      afterReply();
    }).catch(e => {
      hideTyping();
      addPM("（出错了… " + (e && e.message ? e.message : "未知错误") + "）");
      afterReply();
    });
  }
  function afterReply() { renderHUD(); renderBadge(); SFX.play("msg"); }

  function addBoss(text) {
    const m = document.createElement("div");
    m.className = "msg boss";
    m.innerHTML = '<div class="avatar">老</div><div class="bubble"><span class="name">老板</span>' + esc(text) + "</div>";
    el.chatBody.appendChild(m);
    scrollChat();
  }
  function addPM(text) {
    const m = document.createElement("div");
    m.className = "msg pm";
    m.innerHTML = '<div class="avatar">P</div><div class="bubble"><span class="name">佐藤美咲 · 项目经理</span>' + esc(text) + "</div>";
    el.chatBody.appendChild(m);
    scrollChat();
  }
  function addSys(text) {
    const m = document.createElement("div");
    m.className = "msg sys";
    m.innerHTML = '<div class="bubble">' + esc(text) + "</div>";
    el.chatBody.appendChild(m);
    scrollChat();
  }
  function showTyping() { el.chatHead.querySelector(".typing").style.display = "block"; }
  function hideTyping() { el.chatHead.querySelector(".typing").style.display = "none"; }
  function scrollChat() { el.chatBody.scrollTop = el.chatBody.scrollHeight; }

  // ---------- HUD ----------
  function renderHUD() {
    const Ss = S.get();
    if (el.emp) el.emp.textContent = "👥 " + Ss.employees.length;
    const tasksBtn = $("hud-tasks");
    if (tasksBtn) tasksBtn.textContent = "📋 " + Ss.tasks.length;
  }
  function renderBadge() {
    if (!el.badge) return;
    const unread = S.get().notifications.filter(n => !n.read).length;
    el.badge.textContent = unread;
    el.badge.classList.toggle("show", unread > 0);
  }

  // ---------- 通知 ----------
  function showToast(n) {
    const t = document.createElement("div");
    t.className = "toast" + (n.important ? " important" : "");
    t.innerHTML = '<div class="toast-head"></div><div class="toast-body"></div>';
    t.querySelector(".toast-head").textContent = n.title;
    t.querySelector(".toast-body").textContent = n.body;
    t.addEventListener("click", () => { n.read = true; S.emit(); t.remove(); });
    el.toasts.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 300); }, 6000);
  }

  // ---------- 面板 ----------
  function openPanel(name) {
    const p = el.panels[name];
    if (!p) return;
    closeAllPanels();
    p.classList.add("open");
    renderPanel(name);
    SFX.play("open");
  }
  function closeAllPanels() {
    document.querySelectorAll(".panel-overlay").forEach(o => o.classList.remove("open"));
  }
  function renderPanel(name) {
    if (name === "notif") renderNotif();
    if (name === "emp") renderTeam();
    if (name === "tasks") renderTasks();
    if (name === "connect") renderConnect();
  }

  // ---------- 连接面板 ----------
  async function renderConnect() {
    if (!window.Bridge) return;
    Bridge.loadSettings();
    const st = Bridge.getSettings();
    const serverInput = $("conn-server");
    const codeInput = $("conn-code");
    const status = $("conn-status");
    const info = $("conn-info");
    if (serverInput && !serverInput.dataset.init) {
      serverInput.dataset.init = "1";
      serverInput.value = st.server || "";
      serverInput.addEventListener("change", () => Bridge.setServer(serverInput.value));
    }
    const pairBtn = $("conn-pair-btn");
    const confirmBtn = $("conn-confirm-btn");
    const clearBtn = $("conn-clear-btn");
    if (pairBtn && !pairBtn.dataset.init) {
      pairBtn.dataset.init = "1";
      pairBtn.addEventListener("click", async () => {
        Bridge.setServer(serverInput.value);
        try {
          pairBtn.disabled = true; pairBtn.textContent = "请求中…";
          const d = await Bridge.requestPairCode();
          pairBtn.disabled = false; pairBtn.textContent = "已生成配对码";
          S.notify("配对码已生成", "输入配对码：" + d.code, { icon: "lock", type: "pair", important: true });
          status.textContent = "配对码：" + d.code + "（10分钟有效）";
          status.className = "conn-status";
        } catch (e) {
          pairBtn.disabled = false; pairBtn.textContent = "获取配对码";
          status.textContent = "获取失败：" + (e.message || "无法连接服务器");
          status.className = "conn-status offline";
        }
      });
    }
    if (confirmBtn && !confirmBtn.dataset.init) {
      confirmBtn.dataset.init = "1";
      confirmBtn.addEventListener("click", async () => {
        Bridge.setServer(serverInput.value);
        try {
          confirmBtn.disabled = true;
          await Bridge.confirmPair(codeInput.value || "", "PixelOffice-" + Math.random().toString(16).slice(2, 6));
          confirmBtn.disabled = false;
          status.textContent = "配对成功！PM 已接入真实 DeepSeek ✨";
          status.className = "conn-status online";
          SFX.play("levelup");
          S.notify("配对成功", "项目经理已接入真实 DeepSeek 大脑！", { icon: "check", type: "pair", important: true });
          renderConnect();
          if (window.PM) PM.syncFromBridge().catch(() => {});
        } catch (e) {
          confirmBtn.disabled = false;
          status.textContent = "配对失败：" + (e.message || "未知错误");
          status.className = "conn-status offline";
        }
      });
    }
    if (clearBtn && !clearBtn.dataset.init) {
      clearBtn.dataset.init = "1";
      clearBtn.addEventListener("click", () => {
        Bridge.clearPair();
        S.get().connected = false; S.save(); S.emit();
        renderConnect();
      });
    }
    const cfg = Bridge.getSettings();
    if (Bridge.isConfigured()) {
      status.textContent = "已连接（" + cfg.model + "）";
      status.className = "conn-status online";
    } else {
      status.textContent = "未连接 — 请先配对 DSH 桥接";
      status.className = "conn-status offline";
    }
    info.innerHTML = "服务器: " + (cfg.server || "未设置") + "<br>模型: " + (cfg.model || "未配对");
    updateNetIndicator();
  }

  function updateNetIndicator() {
    if (!el.net) return;
    if (window.Bridge && Bridge.isConfigured()) {
      el.net.textContent = "🔵";
      el.net.title = "已连接 DeepSeek";
    } else {
      el.net.textContent = "⚪";
      el.net.title = "未连接";
    }
  }

  // ---------- 团队面板（真实员工 agent） ----------
  function renderTeam() {
    const Ss = S.get();
    const body = $("panel-emp").querySelector(".panel-body");
    body.innerHTML = "";
    const t = document.createElement("div");
    t.className = "section-title";
    t.textContent = "团队（真实 DSH agent）(" + Ss.employees.length + ")";
    body.appendChild(t);
    if (!Ss.employees.length) {
      body.innerHTML += '<div class="notif-empty">还没有员工。跟 PM 说「招个程序员」雇佣真实 agent 员工。</div>';
      return;
    }
    for (const e of Ss.employees) {
      const statusZh = { working: "工作中", running: "工作中", idle: "空闲", inactive: "空闲", provisioning: "就职中" }[e.status] || e.status;
      const card = document.createElement("div");
      card.className = "emp-card";
      card.innerHTML = `
        <div class="emp-portrait">${esc(e.emoji || "👤")}</div>
        <div class="emp-info">
          <div class="ename">${esc(e.name)} ${esc(e.roleName || "")}</div>
          <div class="erole">${esc(e.label || "")} · <span class="${e.status === 'working' ? 'stat-working' : ''}">${esc(statusZh)}</span></div>
        </div>`;
      body.appendChild(card);
    }
  }

  // ---------- 任务面板 ----------
  function renderTasks() {
    const Ss = S.get();
    const body = $("panel-tasks").querySelector(".panel-body");
    body.innerHTML = "";
    const t = document.createElement("div");
    t.className = "section-title";
    t.textContent = "员工工作台（实时）";
    body.appendChild(t);
    if (!Ss.tasks.length) {
      body.innerHTML += '<div class="notif-empty">还没有任务。让 PM 给你安排：例如「帮我安排一个任务：设计一个游戏主页」。</div>';
      return;
    }
    for (const tk of Ss.tasks) {
      const card = document.createElement("div");
      card.className = "proj-card";
      card.innerHTML = `<div class="pc-head"><span class="pc-name">${esc(tk.label || tk.id)}</span><span class="${tk.activity === 'running' ? 'stat-working' : ''}">${tk.activity === 'running' ? '工作中' : '空闲'}</span></div>`;
      const recent = (tk.recent && tk.recent.length) ? tk.recent[tk.recent.length - 1] : "暂无产出";
      card.innerHTML += `<div class="pc-body" style="color:#6e5f50;font-size:11px;white-space:pre-wrap">${esc(recent.slice(0, 300))}</div>`;
      body.appendChild(card);
    }
  }

  function renderNotif() {
    const Ss = S.get();
    const body = $("panel-notif").querySelector(".panel-body");
    if (!Ss.notifications.length) { body.innerHTML = '<div class="notif-empty">暂无通知</div>'; return; }
    body.innerHTML = "";
    for (const n of Ss.notifications) {
      const item = document.createElement("div");
      item.className = "notif-item" + (n.read ? "" : " unread");
      item.innerHTML = '<div class="nt"><div class="t"></div><div class="b"></div><div class="tm"></div></div>';
      item.querySelector(".t").textContent = n.title;
      item.querySelector(".b").textContent = n.body;
      item.querySelector(".tm").textContent = new Date(n.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      item.addEventListener("click", () => { n.read = true; S.emit(); renderNotif(); });
      body.appendChild(item);
    }
  }

  // ---------- 事件回调 ----------
  function onEmpClick(emp) { currentEmp = emp; openPanel("emp"); }

  function toggleSound() {
    const on = !SFX.isEnabled();
    SFX.setEnabled(on);
    if (on) SFX.startBGM(); else SFX.stopBGM();
    el.sound.textContent = on ? "♪" : "✕";
    SFX.play("click");
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmt(n) { return Math.round(n).toLocaleString("zh-CN"); }

  return {
    init, startBoot, openPanel, closeAllPanels,
    onEmpClick, showToast, sendChat, addPM, addSys, addBoss,
    renderHUD, currentEmp,
  };
})();
