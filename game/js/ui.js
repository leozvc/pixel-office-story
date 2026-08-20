// UI 控制器 —— 渲染 HUD/聊天/通知/面板
window.UI = (function () {
  const S = GState, PM = window.PM;
  let el = {};
  let bootDone = false;

  const $ = id => document.getElementById(id);

  function init() {
    el = {
      app: $("app"),
      hud: $("hud"), money: $("hud-money"), day: $("hud-day"), clock: $("hud-clock"),
      emp: $("hud-emp"), rep: $("hud-rep"), bell: $("hud-bell"), badge: $("hud-bell").querySelector(".badge"),
      sound: $("hud-sound"),
      chatBody: $("chat-body"), chatInput: $("chat-input"), chatSend: $("chat-send"), chatHead: $("chat-head"),
      quickRow: $("quick-row"),
      toasts: $("toasts"),
      scene: $("scene"),
      boot: $("boot-screen"), bootBtn: $("boot-btn"),
      panels: { notif: $("panel-notif"), emp: $("panel-emp"), proj: $("panel-proj"), archive: $("panel-archive"), shop: $("panel-shop"), connect: $("panel-connect") },
    };

    // 事件
    el.bell.addEventListener("click", () => openPanel("notif"));
    const projBtn = $("hud-proj"); if (projBtn) projBtn.addEventListener("click", () => openPanel("proj"));
    const archBtn = $("hud-arch"); if (archBtn) archBtn.addEventListener("click", () => openPanel("archive"));
    const netBtn = $("hud-net"); if (netBtn) netBtn.addEventListener("click", () => openPanel("connect"));
    el.sound.addEventListener("click", toggleSound);
    el.chatSend.addEventListener("click", sendChat);
    el.chatInput.addEventListener("keydown", e => { if (e.key === "Enter") sendChat(); });
    el.bootBtn.addEventListener("click", startBoot);
    // 快速词
    const chips = ["你好", "接项目", "接下", "汇报进度", "招人", "心情如何"];
    el.quickRow.innerHTML = "";
    for (const c of chips) {
      const b = document.createElement("button");
      b.className = "quick-chip"; b.textContent = c;
      b.addEventListener("click", () => { el.chatInput.value = c; sendChat(); });
      el.quickRow.appendChild(b);
    }
    // 面板关闭
    document.querySelectorAll(".panel-overlay").forEach(o => {
      o.addEventListener("click", e => { if (e.target === o) closeAllPanels(); });
    });
    document.querySelectorAll(".panel .close").forEach(b => {
      b.addEventListener("click", closeAllPanels);
    });

    // 状态订阅
    S.on(renderHUD);
    S.on(() => renderBadge());
    S.on(() => { if (bootDone) renderProjects(); });

    if (window.Bridge) Bridge.loadSettings();
    updateNetIndicator();

    renderHUD(); renderBadge(); renderProjects();
  }

  function greetingText() {
    const Ss = S.get();
    if (!Ss.employees.length) {
      return "老板好！欢迎来到「" + Ss.companyName + "」。我是项目经理佐藤美咲，今后所有工作安排都交给我就好。\n\n办公室刚开业，只有我们两个人。想要开工赚钱，建议先「招人」补充队伍，然后「接项目」！";
    }
    const pm = Ss.employees.find(e => e.typeId === "pm");
    return (pm && GD.EMP_TYPES.find(t => t.id === "pm").greeting) || "老板好！有什么吩咐？";
  }

  function startBoot() {
    SFX.init();
    SFX.play("open");
    SFX.startBGM();
    el.boot.classList.add("hide");
    bootDone = true;
    setTimeout(() => el.boot.style.display = "none", 500);
    // 初始 PM 消息
    setTimeout(() => {
      const txt = greetingText();
      addPM(txt);
    }, 400);
  }

  // ---------- 聊天 ----------
  function sendChat() {
    const v = el.chatInput.value.trim();
    if (!v) return;
    addBoss(v);
    el.chatInput.value = "";
    showTyping();
    const done = (reply) => {
      hideTyping();
      addPM(reply);
      afterReply(reply);
    };
    Promise.resolve(PM.respond(v)).then(done).catch((e) => {
      hideTyping();
      addPM("（网络出了点问题… " + (e && e.message ? e.message : "未知错误") + "）");
      afterReply("");
    });
  }

  function afterReply(reply) {
    renderProjects();
    renderHUD();
    SFX.play("msg");
  }

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
    el.money.textContent = "¥" + fmt(Ss.money);
    el.day.textContent = "DAY " + Ss.day;
    const h = Math.floor(Ss.clock / 60), m = Ss.clock % 60;
    el.clock.textContent = pad(h) + ":" + pad(m);
    el.emp.textContent = "👥 " + Ss.employees.length;
    el.rep.textContent = "★" + Ss.reputation;
  }

  function renderBadge() {
    const unread = S.get().notifications.filter(n => !n.read).length;
    el.badge.textContent = unread;
    el.badge.classList.toggle("show", unread > 0);
  }

  // ---------- 通知 ----------
  function showToast(n) {
    const t = document.createElement("div");
    t.className = "toast" + (n.important ? " important" : "");
    const icon = Sprites.drawIcon(n.icon || "bell", 16);
    const ico = document.createElement("img"); ico.src = icon.toDataURL();
    t.innerHTML = '<div class="toast-head"></div><div class="toast-body"></div>';
    t.querySelector(".toast-head").appendChild(ico);
    t.querySelector(".toast-head").append(document.createTextNode(n.title));
    t.querySelector(".toast-body").textContent = n.body;
    t.addEventListener("click", () => {
      n.read = true; S.emit();
      openPanel("notif");
      t.remove();
    });
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
    if (name === "emp") renderEmpDetail();
    if (name === "proj") renderProjectsPanel();
    if (name === "archive") renderArchive();
    if (name === "shop") renderShop();
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
          S.notify("配对码已生成", "在 DSH 端确认后，输入配对码：" + d.code, { icon: "lock", type: "pair", important: true });
          status.textContent = "配对码：" + d.code + "（10分钟内有效，请在 DSH 端确认）";
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
        renderConnect();
      });
    }
    // 状态显示
    const cfg = Bridge.getSettings();
    if (Bridge.isConfigured()) {
      status.textContent = "已连接（" + cfg.model + "）";
      status.className = "conn-status online";
    } else {
      status.textContent = "未连接 — PM 当前使用本地规则引擎";
      status.className = "conn-status offline";
    }
    info.innerHTML = "服务器: " + (cfg.server || "未设置") + "<br>设备: " + (cfg.deviceName || "未命名") + "<br>配对: " + (cfg.paired ? "是" : "否") + "<br>模型: " + (cfg.model || "本地规则引擎");
    updateNetIndicator();
  }

  function updateNetIndicator() {
    const netBtn = $("hud-net");
    if (!netBtn) return;
    if (window.Bridge && Bridge.isConfigured()) {
      netBtn.textContent = "🔵";
      netBtn.title = "已连接 DeepSeek";
    } else {
      netBtn.textContent = "⚪";
      netBtn.title = "离线模式";
    }
  }

  function renderNotif() {
    const Ss = S.get();
    const body = $("panel-notif").querySelector(".panel-body");
    if (!Ss.notifications.length) {
      body.innerHTML = '<div class="notif-empty">暂无通知</div>';
      return;
    }
    body.innerHTML = "";
    for (const n of Ss.notifications) {
      const item = document.createElement("div");
      item.className = "notif-item" + (n.read ? "" : " unread");
      const icon = Sprites.drawIcon(n.icon || "bell", 18);
      item.innerHTML = '<img><div class="nt"><div class="t"></div><div class="b"></div><div class="tm"></div></div>';
      item.querySelector("img").src = icon.toDataURL();
      item.querySelector(".t").textContent = n.title;
      item.querySelector(".b").textContent = n.body;
      item.querySelector(".tm").textContent = "DAY " + n.at + "  " + new Date(n.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      item.addEventListener("click", () => {
        n.read = true; S.emit();
        // 项目完成 -> 打开项目面板/档案
        if (n.type === "complete" && n.projectId) {
          openPanel("archive");
        } else if (n.type === "hire") {
          openPanel("proj");
        }
        renderNotif();
      });
      body.appendChild(item);
    }
  }

  let currentEmp = null;
  function renderEmpDetail() {
    const body = $("panel-emp").querySelector(".panel-body");
    const emp = currentEmp || (S.get().employees.find(e => e.typeId === "pm") || S.get().employees[0]);
    if (!emp) { body.innerHTML = '<div class="notif-empty">还没有员工</div>'; return; }
    const type = GD.EMP_TYPES.find(t => t.id === emp.typeId);
    const pct = Math.round((emp.exp || 0) / 100 * 100);
    body.innerHTML = `
      <div class="emp-card">
        <div class="emp-portrait">${emp.typeId === "pm" ? "PM" : "👤"}</div>
        <div class="emp-info">
          <div class="ename">${esc(emp.name)} ${emp.typeId === "pm" ? "⭐" : ""}</div>
          <div class="erole">${esc(type.roleZh)} · ${esc(type.desc)}</div>
        </div>
      </div>
      <div class="section-title">状态</div>
      <div class="stat-row"><span>心情</span><span>${emp.mood}/100</span></div>
      <div class="stat-bar mood ${emp.mood < 40 ? "mood-bad" : ""}"><div style="width:${emp.mood}%"></div></div>
      <div class="stat-row"><span>效率</span><span>${Math.round(emp.stats.speed * 100)}%</span></div>
      <div class="stat-row"><span>质量</span><span>${Math.round(emp.stats.quality * 100)}%</span></div>
      <div class="stat-row"><span>等级</span><span>Lv.${emp.level || 1}</span></div>
      <div class="stat-row"><span>经验</span><span>${emp.exp || 0}/100</span></div>
      <div class="stat-bar"><div style="width:${pct}%"></div></div>
      <div class="section-title">薪资</div>
      <div class="stat-row"><span>日薪</span><span>¥${emp.salary}</span></div>
    `;
  }

  function renderProjectsPanel() {
    const Ss = S.get();
    const body = $("panel-proj").querySelector(".panel-body");
    body.innerHTML = "";
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = "进行中的项目";
    body.appendChild(title);
    if (!Ss.projects.length) {
      body.innerHTML += '<div class="notif-empty">暂无进行中的项目。跟 PM 说「接项目」吧！</div>';
    } else {
      for (const p of Ss.projects) body.appendChild(projCard(p));
    }
    const title2 = document.createElement("div");
    title2.className = "section-title";
    title2.textContent = "员工任务";
    body.appendChild(title2);
    if (!Ss.tasks.length) {
      body.innerHTML += '<div class="notif-empty">员工目前都很闲～</div>';
    } else {
      for (const t of Ss.tasks) {
        const emp = Ss.employees.find(e => e.id === t.empId);
        const pct = Math.round(t.done / t.total * 100);
        const row = document.createElement("div");
        row.className = "proj-line";
        row.innerHTML = `<span class="lbl">${esc(emp ? emp.name : "?")}</span>
          <div class="proj-bar"><div style="width:${pct}%"></div></div>
          <span class="proj-pct">${pct}%</span>`;
        body.appendChild(row);
      }
    }
  }

  function projCard(p) {
    const Ss = S.get();
    const div = document.createElement("div");
    div.className = "proj-card";
    let total = 0, done = 0;
    const lines = [];
    for (const t of p.required) {
      const hours = p.hours[t]; const d = p.progress[t] || 0;
      total += hours; done += d;
      const pct = Math.round(d / hours * 100);
      lines.push(`<div class="proj-line"><span class="lbl">${t}</span><div class="proj-bar"><div style="width:${pct}%"></div></div><span class="proj-pct">${pct}%</span></div>`);
    }
    const pct = total ? Math.round(done / total * 100) : 0;
    div.innerHTML = `
      <div class="pc-head"><span class="pc-name">《${esc(p.name)}》</span><span>${pct}%</span></div>
      <div class="pc-body">
        <div class="proj-line" style="font-size:11px;color:#8a6f52">客户：${esc(p.client)} · 报酬 ¥${p.reward} · 难度 ${"★".repeat(p.difficulty)}</div>
        ${lines.join("")}
      </div>`;
    return div;
  }

  function renderProjects() {
    // 底部场景面板简化：更新 HUD 外的项目小标签（在场景顶部右侧）
  }

  function renderArchive() {
    const Ss = S.get();
    const body = $("panel-archive").querySelector(".panel-body");
    body.innerHTML = "";
    const t = document.createElement("div");
    t.className = "section-title";
    t.textContent = "完成档案（" + Ss.archive.length + "）";
    body.appendChild(t);
    if (!Ss.archive.length) {
      body.innerHTML += '<div class="notif-empty">还没有完成的项目。加油老板！</div>';
      return;
    }
    for (const a of Ss.archive) {
      const d = document.createElement("div");
      d.className = "archive-item";
      d.innerHTML = `<div><b>《${esc(a.name)}》</b><div style="color:#8a6f52;font-size:11px">${esc(a.flavor)} · ${esc(a.client)} · DAY ${a.day}</div></div>
        <div style="text-align:right"><div class="stars">${"★".repeat(a.rating)}${"☆".repeat(5 - a.rating)}</div><div>+¥${fmt(a.reward)}</div></div>`;
      body.appendChild(d);
    }
  }

  function renderShop() {
    const Ss = S.get();
    const body = $("panel-shop").querySelector(".panel-body");
    const upgrades = [
      { k: "desk", name: "新办公桌", desc: "全员效率 +10%", cost: 2000 + Ss.upg.desk * 1500, max: 3 },
      { k: "coffee", name: "咖啡机", desc: "当天全员心情 +10", cost: 800 + Ss.upg.coffee * 600, max: 3, daily: true },
      { k: "decor", name: "绿植装饰", desc: "心情回复速度 +", cost: 1200 + Ss.upg.decor * 900, max: 3 },
      { k: "network", name: "网络升级", desc: "全员效率 +5%", cost: 1500 + Ss.upg.network * 1000, max: 3 },
    ];
    body.innerHTML = "";
    const t = document.createElement("div");
    t.className = "section-title";
    t.textContent = "办公室升级";
    body.appendChild(t);
    for (const u of upgrades) {
      const lv = Ss.upg[u.k] || 0;
      const maxed = lv >= u.max;
      const row = document.createElement("div");
      row.className = "archive-item";
      row.style.flexDirection = "column"; row.style.alignItems = "stretch"; row.style.gap = "6px";
      row.innerHTML = `<div style="display:flex;justify-content:space-between"><b>${u.name}</b><span style="color:#8a6f52">Lv.${lv}/${u.max}</span></div>
        <div style="color:#6e5f50;font-size:11px">${u.desc}</div>`;
      const btn = document.createElement("button");
      btn.className = "btn " + (maxed ? "gray" : "green");
      btn.textContent = maxed ? "已满级" : "升级 ¥" + fmt(u.cost);
      btn.disabled = maxed || Ss.money < u.cost;
      btn.addEventListener("click", () => {
        if (Ss.money < u.cost || maxed) return;
        Ss.money -= u.cost;
        Ss.upg[u.k] += 1;
        // 应用效果
        applyUpgrade(u.k);
        S.save(); S.emit();
        SFX.play("levelup");
        renderShop();
      });
      row.appendChild(btn);
      body.appendChild(row);
    }
  }

  function applyUpgrade(k) {
    const Ss = S.get();
    if (k === "coffee") {
      Ss.employees.forEach(e => { e.mood = Math.min(100, e.mood + 10); });
      S.notify("咖啡机升级", "全员喝了咖啡，心情 +10！", { icon: "heart", type: "upgrade" });
    }
  }

  // ---------- 事件回调 ----------
  function onEmpClick(emp) {
    currentEmp = emp;
    openPanel("emp");
  }
  function onProjectDone(p, arch, notif) {
    showToast(notif);
    addSys("🎉 《" + p.name + "》 完成！评价 " + "★".repeat(arch.rating) + "，入账 ¥" + arch.reward);
    SFX.play(arch.rating >= 4 ? "bigWin" : "complete");
    renderProjects();
  }

  function toggleSound() {
    const on = !SFX.isEnabled();
    SFX.setEnabled(on);
    if (on) { SFX.startBGM(); } else { SFX.stopBGM(); }
    el.sound.textContent = on ? "♪" : "✕";
    SFX.play("click");
  }

  // ---------- 工具 ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmt(n) { return Math.round(n).toLocaleString("zh-CN"); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // 暴露
  return {
    init, startBoot, openPanel, closeAllPanels,
    onEmpClick, onProjectDone, showToast,
    sendChat, addPM, addSys, addBoss, renderProjects, renderHUD,
    currentEmp,
  };
})();
