// UI 控制器 —— DSH 任务编排版（看板/语音/工作区/通知）
window.UI = (function () {
  const S = GState;
  let el = {};
  let bootDone = false;
  let notifCursor = 0;
  let taskDetailId = null;
  const $ = id => document.getElementById(id);

  function init() {
    el = {
      hud: $("hud"), emp: $("hud-team"),
      bell: $("hud-bell"), badge: $("hud-bell").querySelector(".badge"),
      sound: $("hud-sound"), net: $("hud-net"),
      chatBody: $("chat-body"), chatInput: $("chat-input"), chatSend: $("chat-send"), chatHead: $("chat-head"),
      mic: $("mic-btn"), quickRow: $("quick-row"),
      toasts: $("toasts"), scene: $("scene"),
      boot: $("boot-screen"), bootBtn: $("boot-btn"),
      panels: { emp: $("panel-emp"), tasks: $("panel-tasks"), notif: $("panel-notif"), connect: $("panel-connect"), tasknew: $("panel-tasknew"), taskdetail: $("panel-taskdetail") },
    };
    if (el.net) el.net.addEventListener("click", () => openPanel("connect"));
    if (el.bell) el.bell.addEventListener("click", () => openPanel("notif"));
    const empBtn = $("hud-team"); if (empBtn) empBtn.addEventListener("click", () => openPanel("emp"));
    const taskBtn = $("hud-tasks"); if (taskBtn) taskBtn.addEventListener("click", () => openPanel("tasks"));
    const newBtn = $("hud-newtask"); if (newBtn) newBtn.addEventListener("click", openTaskNew);
    el.sound.addEventListener("click", toggleSound);
    el.chatSend.addEventListener("click", sendChat);
    el.chatInput.addEventListener("keydown", e => { if (e.key === "Enter") sendChat(); });
    if (el.mic) el.mic.addEventListener("click", startVoice);
    el.bootBtn.addEventListener("click", startBoot);
    const chips = ["你好", "招个程序员", "帮我安排一个任务：写一个登录页", "汇报进度"];
    el.quickRow.innerHTML = "";
    for (const c of chips) {
      const b = document.createElement("button");
      b.className = "quick-chip"; b.textContent = c;
      b.addEventListener("click", () => { el.chatInput.value = c; sendChat(); });
      el.quickRow.appendChild(b);
    }
    document.querySelectorAll(".panel-overlay").forEach(o => { o.addEventListener("click", e => { if (e.target === o) closeAllPanels(); }); });
    document.querySelectorAll(".panel .close").forEach(b => { b.addEventListener("click", closeAllPanels); });
    S.on(renderHUD);
    S.on(renderBadge);
    if (window.Bridge) Bridge.loadSettings();
    updateNetIndicator();
    renderHUD(); renderBadge();
    if (window.Bridge && Bridge.isConfigured() && window.PM) {
      PM.syncFromBridge().catch(() => {});
      startNotifPolling();
    }
  }

  function greetingText() {
    return "老板好！我是项目经理佐藤美咲。本版本已接入真实 DeepSeek harness，员工都是真实 AI agent，任务走任务看板统一管理。\n\n你可以：\n· 说「招个程序员/美术/测试/运营」雇佣员工\n· 说「帮我安排一个任务：…」创建任务（自动分配独立工作区）\n· 点 🎤 语音直接跟我说话\n· 点 📋 看任务看板进度\n· 说「汇报进度」查看所有任务状态\n\n先点右上角 ⚡ 连接任务编排服务。";
  }
  function startBoot() {
    SFX.init(); SFX.play("open"); SFX.startBGM();
    el.boot.classList.add("hide"); bootDone = true;
    setTimeout(() => el.boot.style.display = "none", 500);
    setTimeout(() => addPM(greetingText()), 400);
  }

  function sendChat() {
    const v = el.chatInput.value.trim();
    if (!v) return;
    addBoss(v); el.chatInput.value = ""; showTyping();
    Promise.resolve(PM.respond(v)).then(reply => { hideTyping(); addPM(reply); afterReply(); })
      .catch(e => { hideTyping(); addPM("（出错了… " + (e && e.message ? e.message : "未知错误") + "）"); afterReply(); });
  }
  function afterReply() { renderHUD(); renderBadge(); SFX.play("msg"); }
  function addBoss(text) {
    const m = document.createElement("div");
    m.className = "msg boss";
    m.innerHTML = '<div class="avatar">老</div><div class="bubble"><span class="name">老板</span>' + esc(text) + "</div>";
    el.chatBody.appendChild(m); scrollChat();
  }
  function addPM(text) {
    const m = document.createElement("div");
    m.className = "msg pm";
    m.innerHTML = '<div class="avatar">P</div><div class="bubble"><span class="name">佐藤美咲 · 项目经理</span>' + esc(text) + "</div>";
    el.chatBody.appendChild(m); scrollChat();
  }
  function addSys(text) {
    const m = document.createElement("div");
    m.className = "msg sys";
    m.innerHTML = '<div class="bubble">' + esc(text) + "</div>";
    el.chatBody.appendChild(m); scrollChat();
  }
  function showTyping() { el.chatHead.querySelector(".typing").style.display = "block"; }
  function hideTyping() { el.chatHead.querySelector(".typing").style.display = "none"; }
  function scrollChat() { el.chatBody.scrollTop = el.chatBody.scrollHeight; }

  // ---------- 语音 ASR ----------
  let mediaRecorder = null, audioChunks = [], recording = false;
  async function startVoice() {
    if (!window.Bridge || !Bridge.isConfigured()) { addPM("请先连接任务编排服务再使用语音。"); return; }
    if (recording) { stopVoice(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => { if (e.data.size) audioChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
        const blob = new Blob(audioChunks, { type: "audio/webm" });
        el.mic.textContent = "⏳"; addSys("（语音识别中…）");
        try {
          const text = await Bridge.transcribeAudio(blob);
          if (text) {
            addBoss("🎤 " + text); el.chatInput.value = text; showTyping();
            const reply = await PM.respond(text);
            hideTyping(); addPM(reply); afterReply();
          } else { el.mic.textContent = "🎤"; addSys("（没有识别到语音，请重试）"); }
        } catch (e) { el.mic.textContent = "🎤"; addSys("（语音识别失败：" + (e.message || "未知错误") + "）"); }
        el.mic.textContent = "🎤";
      };
      mediaRecorder.start(); recording = true; el.mic.textContent = "🔴"; addSys("（录音中…再次点击结束）");
    } catch (e) { addSys("（无法使用麦克风：" + (e.message || "权限被拒") + "）"); }
  }
  function stopVoice() { if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop(); recording = false; }

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

  function showToast(n) {
    const t = document.createElement("div");
    t.className = "toast" + (n.important ? " important" : "");
    t.innerHTML = '<div class="toast-head"></div><div class="toast-body"></div>';
    t.querySelector(".toast-head").textContent = n.title;
    t.querySelector(".toast-body").textContent = n.body;
    t.addEventListener("click", () => { n.read = true; S.emit(); t.remove(); openPanel("tasks"); });
    el.toasts.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 300); }, 7000);
  }
  function startNotifPolling() {
    setInterval(async () => {
      if (!window.Bridge || !Bridge.isConfigured()) return;
      try {
        const d = await Bridge.listNotifications(notifCursor);
        if (d.serverTime) notifCursor = d.serverTime;
        if (d.events && d.events.length) {
          for (const ev of d.events) {
            S.notify("任务完成 ✅", "「" + ev.title + "」已完成！", { icon: "star", type: "complete", important: true });
            showToast({ title: "任务完成 ✅", body: "「" + ev.title + "」已完成，点击查看产出", important: true });
            SFX.play("levelup");
          }
          PM.syncFromBridge().catch(() => {});
        }
      } catch (e) {}
    }, 10000);
  }

  function openPanel(name) {
    const p = el.panels[name]; if (!p) return;
    closeAllPanels(); p.classList.add("open"); renderPanel(name); SFX.play("open");
  }
  function closeAllPanels() { document.querySelectorAll(".panel-overlay").forEach(o => o.classList.remove("open")); }
  function renderPanel(name) {
    if (name === "notif") renderNotif();
    if (name === "emp") renderTeam();
    if (name === "tasks") renderKanban();
    if (name === "connect") renderConnect();
    if (name === "tasknew") renderTaskNew();
    if (name === "taskdetail") renderTaskDetail();
  }
  async function renderConnect() {
    if (!window.Bridge) return;
    Bridge.loadSettings();
    const st = Bridge.getSettings();
    const serverInput = $("conn-server"), codeInput = $("conn-code"), status = $("conn-status"), info = $("conn-info");
    if (serverInput && !serverInput.dataset.init) {
      serverInput.dataset.init = "1"; serverInput.value = st.server || "";
      serverInput.addEventListener("change", () => Bridge.setServer(serverInput.value));
    }
    const pairBtn = $("conn-pair-btn"), confirmBtn = $("conn-confirm-btn"), clearBtn = $("conn-clear-btn");
    if (pairBtn && !pairBtn.dataset.init) {
      pairBtn.dataset.init = "1";
      pairBtn.addEventListener("click", async () => {
        Bridge.setServer(serverInput.value);
        try {
          pairBtn.disabled = true; pairBtn.textContent = "请求中…";
          const d = await Bridge.requestPairCode();
          pairBtn.disabled = false; pairBtn.textContent = "已生成配对码";
          S.notify("配对码已生成", "输入配对码：" + d.code, { icon: "lock", type: "pair", important: true });
          status.textContent = "配对码：" + d.code + "（10分钟有效）"; status.className = "conn-status";
        } catch (e) {
          pairBtn.disabled = false; pairBtn.textContent = "获取配对码";
          status.textContent = "获取失败：" + (e.message || "无法连接服务器"); status.className = "conn-status offline";
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
          status.textContent = "配对成功！已接入 DeepSeek 任务编排 ✨"; status.className = "conn-status online";
          SFX.play("levelup");
          S.notify("配对成功", "项目经理已接入真实 DeepSeek 大脑！", { icon: "check", type: "pair", important: true });
          renderConnect();
          if (window.PM) PM.syncFromBridge().catch(() => {});
          startNotifPolling();
        } catch (e) {
          confirmBtn.disabled = false;
          status.textContent = "配对失败：" + (e.message || "未知错误"); status.className = "conn-status offline";
        }
      });
    }
    if (clearBtn && !clearBtn.dataset.init) {
      clearBtn.dataset.init = "1";
      clearBtn.addEventListener("click", () => { Bridge.clearPair(); S.get().connected = false; S.save(); S.emit(); renderConnect(); });
    }
    const cfg = Bridge.getSettings();
    if (Bridge.isConfigured()) { status.textContent = "已连接（" + cfg.model + "）"; status.className = "conn-status online"; }
    else { status.textContent = "未连接 — 请先配对"; status.className = "conn-status offline"; }
    info.innerHTML = "服务器: " + (cfg.server || "未设置") + "<br>模型: " + (cfg.model || "未配对");
    updateNetIndicator();
  }
  function updateNetIndicator() {
    if (!el.net) return;
    if (window.Bridge && Bridge.isConfigured()) { el.net.textContent = "🔵"; el.net.title = "已连接"; }
    else { el.net.textContent = "⚪"; el.net.title = "未连接"; }
  }

  function renderTeam() {
    const Ss = S.get();
    const body = $("panel-emp").querySelector(".panel-body");
    body.innerHTML = "";
    body.appendChild(sec("团队（员工 agent）(" + Ss.employees.length + ")"));
    if (!Ss.employees.length) { body.innerHTML += '<div class="notif-empty">还没有员工。跟 PM 说「招个程序员」。</div>'; }
    for (const e of Ss.employees) {
      const statusZh = { working: "工作中", busy: "忙碌", idle: "空闲" }[e.status] || e.status;
      const card = document.createElement("div");
      card.className = "emp-card";
      card.innerHTML = `<div class="emp-portrait">${esc(e.emoji || "👤")}</div>
        <div class="emp-info"><div class="ename">${esc(e.name)} ${esc(e.roleName || "")}</div>
        <div class="erole">${esc(e.label || "")} · <span class="${e.status === 'working' ? 'stat-working' : ''}">${esc(statusZh)}</span></div></div>`;
      body.appendChild(card);
    }
    const hireRow = document.createElement("div");
    hireRow.className = "hire-row";
    for (const role of ["dev", "art", "qa", "ops"]) {
      const b = document.createElement("button");
      b.className = "btn blue";
      b.textContent = "招" + { dev: "程序员", art: "美术", qa: "测试", ops: "运营" }[role];
      b.addEventListener("click", async () => {
        const name = { dev: "阿伟", art: "小美", qa: "小测", ops: "小运" }[role] + "-" + Math.floor(Math.random() * 100);
        b.disabled = true; b.textContent = "雇佣中…";
        try { await Bridge.hireEmployee(name, role); S.notify("新员工入职", name + " 已加入", { icon: "users", type: "hire" }); }
        catch (e) { S.notify("失败", e.message, { icon: "excl", type: "error" }); }
        b.disabled = false; b.textContent = "招" + { dev: "程序员", art: "美术", qa: "测试", ops: "运营" }[role];
        await PM.syncFromBridge().catch(() => {}); renderTeam();
      });
      hireRow.appendChild(b);
    }
    body.appendChild(hireRow);
  }
  function sec(text) { const d = document.createElement("div"); d.className = "section-title"; d.textContent = text; return d; }

  // ---------- 任务看板（多列） ----------
  const COLS = [ { id: "todo", name: "待办" }, { id: "doing", name: "执行中" }, { id: "done", name: "已完成" } ];
  function renderKanban() {
    const Ss = S.get();
    const body = $("panel-tasks").querySelector(".panel-body");
    body.innerHTML = "";
    body.appendChild(sec("任务看板"));
    const top = document.createElement("div");
    top.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px";
    const cnt = document.createElement("span");
    cnt.style.cssText = "font-size:12px;color:#8a6f52";
    cnt.textContent = Ss.tasks.length + " 项任务";
    const addBtn = document.createElement("button");
    addBtn.className = "btn green"; addBtn.textContent = "+ 新建任务";
    addBtn.addEventListener("click", openTaskNew);
    top.appendChild(cnt); top.appendChild(addBtn);
    body.appendChild(top);

    const board = document.createElement("div");
    board.className = "kanban";
    board.style.cssText = "display:flex;gap:10px;overflow-x:auto;align-items:flex-start";
    for (const col of COLS) {
      const colDiv = document.createElement("div");
      colDiv.className = "kanban-col";
      colDiv.style.cssText = "flex:1;min-width:140px;background:#3a2a1a;border:1px solid #1a120a;border-radius:6px;padding:8px";
      const hdr = document.createElement("div");
      hdr.style.cssText = "font-weight:bold;font-size:13px;margin-bottom:8px;color:" + (col.id === "done" ? "#5fbf8f" : col.id === "doing" ? "#f2d04a" : "#cfe0ff");
      const colTasks = Ss.tasks.filter(t => t.status === col.id);
      hdr.textContent = col.name + " (" + colTasks.length + ")";
      colDiv.appendChild(hdr);
      for (const t of colTasks) {
        const card = document.createElement("div");
        card.className = "task-card";
        card.style.cssText = "background:#4a3520;border:1px solid #1a120a;border-radius:4px;padding:8px;margin-bottom:8px;cursor:pointer";
        const stTxt = { todo: "待办", doing: "执行中", done: "已完成" }[t.status];
        card.innerHTML = `<div style="font-weight:bold;font-size:13px">${esc(t.title)}</div>
          <div style="font-size:11px;color:#b0a080;margin-top:4px">负责人：${esc((t.assign||[]).join("、") || "待定")}</div>
          <div style="font-size:11px;color:#8a6f52;margin-top:2px;word-break:break-all">工作区：${esc(t.workspace||"")}</div>
          <div style="font-size:11px;margin-top:6px">${t.status === "done" ? '<span style="color:#5fbf8f">✅ 已完成</span>' : t.status === "doing" ? '<span style="color:#f2d04a">⏳ 执行中</span>' : '<span style="color:#cfe0ff">待办</span>'}</div>`;
        card.addEventListener("click", () => openTaskDetail(t.id));
        colDiv.appendChild(card);
      }
      board.appendChild(colDiv);
    }
    body.appendChild(board);
  }

  // ---------- 新建任务 ----------
  function openTaskNew() {
    if (!window.Bridge || !Bridge.isConfigured()) { addPM("请先连接任务编排服务。"); return; }
    openPanel("tasknew");
  }
  function renderTaskNew() {
    const body = $("panel-tasknew").querySelector(".panel-body");
    body.innerHTML = "";
    body.appendChild(sec("新建任务"));
    const es = S.get().employees;
    body.innerHTML += `
      <div class="conn-field"><label>任务标题</label><input id="tnew-title" placeholder="例如：写一个登录页" autocomplete="off"></div>
      <div class="conn-field"><label>任务描述（目标/验收标准）</label><textarea id="tnew-desc" rows="4" placeholder="描述要完成什么、产出要求"></textarea></div>
      <div class="conn-field"><label>负责人（可多选）</label><div id="tnew-assign"></div></div>
      <div class="conn-field"><label>工作区目录（可选，留空自动分配）</label><input id="tnew-ws" placeholder="/Users/.../workspace/tasks/xxx" autocomplete="off"></div>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn green" id="tnew-submit">创建并执行</button><button class="btn gray" id="tnew-cancel">取消</button></div>`;
    const assignBox = $("tnew-assign");
    for (const e of es) {
      const l = document.createElement("label");
      l.style.cssText = "display:inline-flex;align-items:center;gap:4px;margin:4px 8px 4px 0;font-size:12px";
      l.innerHTML = `<input type="checkbox" value="${esc(e.name)}"> ${esc(e.name)} (${esc(e.roleName||"")})`;
      assignBox.appendChild(l);
    }
    if (!es.length) assignBox.innerHTML = '<span style="font-size:11px;color:#8a6f52">还没有员工，先到团队面板雇佣</span>';
    $("tnew-cancel").addEventListener("click", closeAllPanels);
    $("tnew-submit").addEventListener("click", async () => {
      const title = $("tnew-title").value.trim();
      const desc = $("tnew-desc").value.trim();
      const ws = $("tnew-ws").value.trim();
      if (!title) { addPM("请填写任务标题。"); return; }
      const assign = Array.from(document.querySelectorAll("#tnew-assign input:checked")).map(i => i.value);
      const btn = $("tnew-submit");
      btn.disabled = true; btn.textContent = "创建中…";
      try {
        const d = await Bridge.createTask(title, desc, assign, ws);
        S.notify("任务已创建", "「" + title + "」已加入看板并开始执行", { icon: "flag", type: "task", important: true });
        closeAllPanels();
        await PM.syncFromBridge().catch(() => {});
        addPM("好的老板，「" + title + "」任务已创建并交给员工执行，产出会写入独立工作区。可在任务看板查看进度。");
        openPanel("tasks");
      } catch (e) { addPM("创建失败：" + (e.message || "未知错误")); }
      btn.disabled = false; btn.textContent = "创建并执行";
    });
  }

  // ---------- 任务详情 ----------
  function openTaskDetail(id) { taskDetailId = id; openPanel("taskdetail"); }
  function renderTaskDetail() {
    const body = $("panel-taskdetail").querySelector(".panel-body");
    const t = S.get().tasks.find(x => x.id === taskDetailId);
    if (!t) { body.innerHTML = '<div class="notif-empty">任务不存在</div>'; return; }
    const stTxt = { todo: "待办", doing: "执行中", done: "已完成" }[t.status] || t.status;
    body.innerHTML = "";
    body.appendChild(sec("任务详情"));
    body.innerHTML += `
      <div style="font-size:15px;font-weight:bold;margin-bottom:6px">${esc(t.title)}</div>
      <div style="font-size:12px;color:#b0a080;margin-bottom:6px">状态：${esc(stTxt)} · 负责人：${esc((t.assign||[]).join("、")||"待定")}</div>
      <div class="section-title">任务描述</div>
      <div style="font-size:12px;white-space:pre-wrap;color:#6e5f50;margin-bottom:8px">${esc(t.desc||"(无描述)")}</div>
      <div class="section-title">工作区目录</div>
      <div style="font-size:12px;word-break:break-all;color:#3f6fae;margin-bottom:8px">${esc(t.workspace||"")}</div>
      <div class="section-title">员工产出</div>
      <div style="font-size:12px;white-space:pre-wrap;color:#333;background:#f4f1ea;padding:8px;border-radius:4px;max-height:180px;overflow-y:auto;margin-bottom:8px">${esc(t.output||"(尚未产出)")}</div>`;
    const btn = document.createElement("button");
    btn.className = "btn " + (t.status === "done" ? "gray" : "green");
    btn.textContent = t.status === "done" ? "重新执行" : "立即执行";
    btn.addEventListener("click", async () => {
      try {
        if (t.status !== "done") { await Bridge.dispatchTask(t.id); S.notify("已开始执行", t.title, { icon: "flag", type: "task" }); }
        else { await Bridge.dispatchTask(t.id); S.notify("重新执行", t.title, { icon: "flag", type: "task" }); }
        closeAllPanels(); addPM("已安排执行「" + t.title + "」。"); await PM.syncFromBridge().catch(() => {});
      } catch (e) { addPM("执行失败：" + (e.message||"")); }
    });
    body.appendChild(btn);
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

  function toggleSound() {
    const on = !SFX.isEnabled();
    SFX.setEnabled(on);
    if (on) SFX.startBGM(); else SFX.stopBGM();
    el.sound.textContent = on ? "♪" : "✕";
    SFX.play("click");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmt(n) { return Math.round(n).toLocaleString("zh-CN"); }

  return { init, startBoot, openPanel, closeAllPanels, showToast, sendChat, addPM, addSys, addBoss, renderHUD, openTaskNew, openTaskDetail };
})();
