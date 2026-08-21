// UI 控制器 —— DSH 任务编排版（看板/语音/工作区/通知）
window.UI = (function () {
  const S = GState;
  let el = {};
  let bootDone = false;
  let notifCursor = 0;
  let taskDetailId = null;
  let flowHideTimer = null;
  const $ = id => document.getElementById(id);

  function init() {
    try {
      const bellEl = $("hud-bell");
      el = {
        hud: $("hud"), emp: $("hud-team"),
        bell: bellEl, badge: bellEl ? bellEl.querySelector(".badge") : null,
        sound: $("hud-sound"), net: $("hud-net"),
        chatBody: $("chat-body"), chatInput: $("chat-input"), chatSend: $("chat-send"), chatHead: $("chat-head"),
        mic: $("mic-btn"), quickRow: $("quick-row"),
        toasts: $("toasts"), scene: $("scene"),
        boot: $("boot-screen"), bootBtn: $("boot-btn"),
        panels: { emp: $("panel-emp"), tasks: $("panel-tasks"), notif: $("panel-notif"), connect: $("panel-connect"), tasknew: $("panel-tasknew"), taskdetail: $("panel-taskdetail") },
      };
    if (el.net) el.net.addEventListener("click", () => openPanel("connect"));
    if (el.bell) el.bell.addEventListener("click", () => openPanel("notif"));
    const fundsBtn = $("hud-funds"); if (fundsBtn) fundsBtn.addEventListener("click", () => { openPanel("tasks"); renderEconomy(); });
    const empBtn = $("hud-team"); if (empBtn) empBtn.addEventListener("click", () => openPanel("emp"));
    const taskBtn = $("hud-tasks"); if (taskBtn) taskBtn.addEventListener("click", () => openPanel("tasks"));
    const newBtn = $("hud-newtask"); if (newBtn) newBtn.addEventListener("click", openTaskNew);
    if (el.sound) el.sound.addEventListener("click", toggleSound);
    if (el.chatSend) el.chatSend.addEventListener("click", sendChat);
    if (el.chatInput) el.chatInput.addEventListener("keydown", e => { if (e.key === "Enter") sendChat(); });
    if (el.mic) el.mic.addEventListener("click", startVoice);
    if (el.bootBtn) el.bootBtn.addEventListener("click", startBoot);
    const chips = ["你好", "招个程序员", "帮我安排一个任务：写一个登录页", "汇报进度"];
    if (el.quickRow) {
      el.quickRow.innerHTML = "";
      for (const c of chips) {
        const b = document.createElement("button");
        b.className = "quick-chip"; b.textContent = c;
        b.addEventListener("click", () => { if (el.chatInput) { el.chatInput.value = c; sendChat(); } });
        el.quickRow.appendChild(b);
      }
      // 快捷入口：项目周报（直接打开周报面板）
      const repChip = document.createElement("button");
      repChip.className = "quick-chip"; repChip.textContent = "📋 项目周报";
      repChip.addEventListener("click", () => { openPanel("tasks"); renderWeeklyReport(); });
      el.quickRow.appendChild(repChip);
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
      refreshFunds().catch(() => {});
      refreshCompany().catch(() => {});
      startNotifPolling();
    }
    // 启动画面公司状态
    const bco = $("boot-company");
    if (bco) {
      const Ss = S.get();
      const comp = Ss.company ? (Ss.company.emoji + " " + Ss.company.name + " Lv." + Ss.company.level) : "🏠 像素软件株式会社";
      bco.innerHTML = `${esc(comp)}<br><span class="bco-emp">👥 ${Ss.employees.length} 员工</span> · <span class="bco-task">📋 ${Ss.tasks.length} 任务</span>${Ss.funds != null ? ' · 💰 ' + fmt(Ss.funds) : ""}`;
    }
    } catch (e) {
      // init 容错：重新完整构建 el（null 安全），确保 UI 全功能可用
      try {
        const bellEl = $("hud-bell");
        el = {
          hud: $("hud"), emp: $("hud-team"),
          bell: bellEl, badge: bellEl ? bellEl.querySelector(".badge") : null,
          sound: $("hud-sound"), net: $("hud-net"),
          chatBody: $("chat-body"), chatInput: $("chat-input"), chatSend: $("chat-send"), chatHead: $("chat-head"),
          mic: $("mic-btn"), quickRow: $("quick-row"),
          toasts: $("toasts"), scene: $("scene"),
          boot: $("boot-screen"), bootBtn: $("boot-btn"),
          panels: { emp: $("panel-emp"), tasks: $("panel-tasks"), notif: $("panel-notif"), connect: $("panel-connect"), tasknew: $("panel-tasknew"), taskdetail: $("panel-taskdetail") },
        };
        if (el.bootBtn) el.bootBtn.addEventListener("click", startBoot);
      } catch (_) {}
    }
  }

  function greetingText() {
    const h = new Date().getHours();
    const day = h < 6 ? "夜深了" : h < 12 ? "早上好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
    const Ss = S.get();
    const company = Ss.company ? Ss.company.name : "像素软件株式会社";
    const funds = Ss.funds != null ? fmt(Ss.funds) + " 元" : "—";
    const tasks = Ss.tasks.length;
    const emps = Ss.employees.length;
    const brief = window.Bridge && Bridge.isConfigured()
      ? `${company}目前有 ${emps} 名员工、${tasks} 项任务，公司资金 ${funds}。`
      : "本版本已接入真实 DeepSeek harness，先点右上角 ⚡ 连接任务编排服务。";
    // 针对性下一步建议（新手引导）
    let hint = "";
    if (window.Bridge && Bridge.isConfigured()) {
      if (emps === 0) hint = "\n💡 建议：先「招个程序员」雇一名员工开始。";
      else if (tasks === 0) hint = "\n💡 建议：跟我说「帮我安排一个任务：…」迈出第一步，或点 📌 模板一键创建。";
      else {
        const undone = Ss.tasks.filter(t => t.status !== "done").length;
        if (undone === 0) hint = "\n💡 建议：任务都完成了！可以点 💡 建议看看 PM 的下一步建议，或点 📌 模板开新任务。";
        else hint = "\n💡 建议：有 " + undone + " 个任务在执行中，跟我说「汇报进度」查看。";
      }
    }
    return `${day}，老板！我是项目经理佐藤美咲。${brief}${hint}\n\n你可以：\n· 说「招个程序员/美术/测试/运营」雇佣员工（需花费资金）\n· 说「帮我安排一个任务：…」创建任务（自动拆解子任务并执行）\n· 任务交付后可给员工提反馈，员工会自动修订再交付\n· 点 🎤 语音直接跟我说话\n· 点 📋 看任务看板 / 生成周报 / 查看统计 / 项目总览\n· 说「汇报进度」查看所有任务状态`;
  }
  function startBoot() {
    try {
      SFX.init(); SFX.play("open"); SFX.startBGM();
    } catch (e) {}
    const bootEl = (el && el.boot) || $("boot-screen");
    if (!bootEl) return;
    bootEl.classList.add("hide"); bootDone = true;
    setTimeout(() => { try { bootEl.style.display = "none"; } catch (e) {} }, 500);
    setTimeout(() => addPM(greetingText()), 400);
    // 每日登录奖励
    setTimeout(() => claimDaily(), 1200);
  }
  // 每日签到领奖
  async function claimDaily() {
    if (!window.Bridge || !Bridge.isConfigured()) return;
    try {
      const d = await Bridge.getDaily();
      if (d && d.ok && d.claimed) {
        showToast({ title: "🎁 每日签到", body: "获得资金 +" + d.amount + (d.streak > 1 ? "（连续 " + d.streak + " 天）" : ""), important: true });
        SFX.play("coin");
        addPM("🎁 老板，每日签到奖励 " + d.amount + " 元已到账！" + (d.streak > 1 ? " 已连续签到 " + d.streak + " 天，再接再厉！" : " 明天继续签到有额外奖励哦！"));
        await refreshFunds().catch(() => {});
      }
    } catch (e) {}
  }
  // 成就解锁检测：对比上次已解锁集合，新解锁则提示
  let _seenAch = null;
  async function checkAchievements() {
    if (!window.Bridge || !Bridge.isConfigured()) return;
    try {
      const d = await Bridge.getAchievements();
      const a = d.achievements || {};
      const ids = (a.unlocked || []).map(x => x.id);
      if (_seenAch === null) { _seenAch = new Set(ids); return; } // 首次不提示
      const newly = (a.unlocked || []).filter(x => !_seenAch.has(x.id));
      if (newly.length) {
        newly.forEach(x => {
          showToast({ title: "🏆 成就解锁！", body: x.icon + " " + x.name + " — " + x.desc, important: true });
          SFX.play("bigWin");
          addPM("🏆 恭喜解锁成就「" + x.name + "」！" + x.desc);
        });
      }
      _seenAch = new Set(ids);
    } catch (e) {}
  }

  function sendChat() {
    const v = el.chatInput.value.trim();
    if (!v) return;
    addBoss(v); el.chatInput.value = ""; showTyping();
    flowStep("pm", "PM理解中");
    Promise.resolve(PM.respond(v, { flow: flowStep })).then(reply => { hideTyping(); addPM(reply); afterReply(); })
      .catch(e => { hideTyping(); addPM("（出错了… " + (e && e.message ? e.message : "未知错误") + "）"); flowReset(); afterReply(); });
  }
  function afterReply() { renderHUD(); renderBadge(); SFX.play("msg"); }
  function addBoss(text) {
    if (!el.chatBody) return;
    const m = document.createElement("div");
    m.className = "msg boss";
    m.innerHTML = '<div class="avatar">老</div><div class="bubble"><span class="name">老板</span>' + esc(text) + "</div>";
    el.chatBody.appendChild(m); scrollChat();
  }
  function addPM(text) {
    if (!el.chatBody) return;
    const m = document.createElement("div");
    m.className = "msg pm";
    m.innerHTML = '<div class="avatar">P</div><div class="bubble"><span class="name">佐藤美咲 · 项目经理</span>' + esc(text) + "</div>";
    el.chatBody.appendChild(m); scrollChat();
  }
  function addSys(text) {
    if (!el.chatBody) return;
    const m = document.createElement("div");
    m.className = "msg sys";
    m.innerHTML = '<div class="bubble">' + esc(text) + "</div>";
    el.chatBody.appendChild(m); scrollChat();
  }
  function showTyping() { if (el.chatHead) { const t = el.chatHead.querySelector(".typing"); if (t) t.style.display = "block"; } }
  function hideTyping() { if (el.chatHead) { const t = el.chatHead.querySelector(".typing"); if (t) t.style.display = "none"; } }
  function scrollChat() { if (el.chatBody) el.chatBody.scrollTop = el.chatBody.scrollHeight; }

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
        flowShow(); flowStep("asr", "识别中");
        try {
          const text = await Bridge.transcribeAudio(blob);
          if (text) {
            flowStep("pm", "PM理解中");
            addBoss("🎤 " + text); el.chatInput.value = text; showTyping();
            const reply = await PM.respond(text, { flow: flowStep });
            hideTyping(); addPM(reply); afterReply();
          } else { el.mic.textContent = "🎤"; addSys("（没有识别到语音，请重试）"); flowReset(); }
        } catch (e) { el.mic.textContent = "🎤"; addSys("（语音识别失败：" + (e.message || "未知错误") + "）"); flowReset(); }
        el.mic.textContent = "🎤";
      };
      mediaRecorder.start(); recording = true; el.mic.textContent = "🔴"; el.mic.classList.add("recording"); addSys("（录音中…再次点击结束）");
    } catch (e) { addSys("（无法使用麦克风：" + (e.message || "权限被拒") + "）"); }
  }
  function stopVoice() { if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop(); recording = false; if (el.mic) { el.mic.classList.remove("recording"); } }

  // ---------- 语音/任务流程可视化 ----------
  // 阶段：asr(识别) → pm(PM理解) → dispatch(派发) → exec(执行) → done(完成)
  // show 阶段时把它点亮并滚动到聊天区可看到；超过 1 阶段后旧阶段自动置 done
  function flowShow() {
    const pipe = $("flow-pipe");
    if (pipe) pipe.classList.remove("hide");
  }
  function flowHide() {
    const pipe = $("flow-pipe");
    if (pipe) pipe.classList.add("hide");
  }
  function flowStep(name, label) {
    flowShow();
    const pipe = $("flow-pipe");
    if (!pipe) return;
    const steps = ["asr", "pm", "dispatch", "exec", "done"];
    const idx = steps.indexOf(name);
    pipe.querySelectorAll(".flow-step").forEach((s, i) => {
      s.classList.remove("on", "done");
      if (idx >= 0 && i < idx) s.classList.add("done");
      if (i === idx) { s.classList.add("on"); if (label) s.querySelector(".fs-lb").textContent = label; }
    });
    scrollChat();
    // 到达"完成"后延迟自动隐藏（保留完成态展示约 3 秒）
    if (name === "done") {
      clearTimeout(flowHideTimer);
      flowHideTimer = setTimeout(flowReset, 3000);
    }
  }
  function flowReset() {
    const pipe = $("flow-pipe");
    if (pipe) {
      pipe.querySelectorAll(".flow-step").forEach(s => s.classList.remove("on", "done"));
      pipe.classList.add("hide");
    }
  }

  function renderHUD() {
    const Ss = S.get();
    if (el.emp) el.emp.textContent = "👥 " + Ss.employees.length;
    const tasksBtn = $("hud-tasks");
    if (tasksBtn) tasksBtn.textContent = "📋 " + Ss.tasks.length;
    const fundsBtn = $("hud-funds");
    if (fundsBtn) fundsBtn.textContent = "💰 " + (Ss.funds != null ? fmt(Ss.funds) : "…");
    const titleBtn = $("hud-title");
    if (titleBtn) titleBtn.textContent = (Ss.company ? (Ss.company.emoji + " " + Ss.company.name) : "🏠 像素软件株式会社") + (Ss.company ? " Lv." + Ss.company.level : "");
  }
  // 拉取公司资金刷新 HUD
  async function refreshFunds() {
    if (!window.Bridge || !Bridge.isConfigured()) return;
    try {
      const d = await Bridge.getEconomy();
      if (d && d.economy && d.economy.funds != null) {
        S.get().funds = d.economy.funds;
        S.get().economy = d.economy;
        S.save(); S.emit();
      }
    } catch (e) {}
  }
  // 拉取公司等级刷新 HUD
  async function refreshCompany() {
    if (!window.Bridge || !Bridge.isConfigured()) return;
    try {
      const d = await Bridge.getCompany();
      if (d && d.company) {
        const prev = S.get().company;
        S.get().company = d.company;
        S.save(); S.emit();
        // 里程碑升级庆祝：等级提升时提示
        if (prev && prev.level && d.company.level > prev.level) {
          S.notify("🏆 公司升级！", "「" + d.company.name + "」Lv." + d.company.level + " 达成！", { icon: "star", type: "milestone", important: true });
          showToast({ title: "🏆 公司升级！", body: "「" + d.company.name + "」Lv." + d.company.level + " 达成，继续加油！", important: true });
          addPM("🎉 恭喜老板！公司升级为「" + d.company.name + "」（Lv." + d.company.level + "）！这是里程碑时刻，团队士气高涨！");
          SFX.play("bigWin");
          // 全办公室迸发庆祝粒子
          try {
            if (window.Game) {
              const Ss = S.get();
              Ss.employees.forEach((emp, i) => {
                const st = Game.stationPos(i);
                Game.spawnBurst({ x: st.x, y: st.y });
              });
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
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
    t.addEventListener("click", () => {
      n.read = true; S.emit(); t.remove();
      openPanel("tasks");
      // 若通知携带任务 id，直接打开任务详情（深链）
      if (n.taskId) { renderKanban(); setTimeout(() => { openTaskDetail(n.taskId); }, 80); }
    });
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
            S.notify("任务完成 ✅", "「" + ev.title + "」已完成！", { icon: "star", type: "complete", important: true, taskId: ev.id });
            showToast({ title: "任务完成 ✅", body: "「" + ev.title + "」已完成，点击查看产出", important: true, taskId: ev.id });
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
      const sk = e.skill || {};
      const domains = (sk.domains || []).join("、");
      const xp = sk.xp || 0;
      const lvl = sk.level || 1;
      const xpInLvl = xp % 30;
      const xpPct = Math.round((xpInLvl / 30) * 100);
      const card = document.createElement("div");
      card.className = "emp-card";
      card.style.cssText = "padding:8px;border:2px solid #4a3728;border-radius:4px;background:#fff;margin-bottom:8px";
      card.innerHTML = `<div class="emp-portrait">${esc(e.emoji || "👤")}</div>
        <div class="emp-info"><div class="ename">${esc(e.name)} ${esc(e.roleName || "")} <span style="font-size:10px;color:#f2d04a">Lv.${lvl}</span></div>
        <div class="erole">${esc(e.label || "")} · <span class="${e.status === 'working' ? 'stat-working' : ''}">${esc(statusZh)}</span></div>
        ${sk.tasksDone ? `<div style="font-size:11px;color:#8a6f52;margin-top:2px">已完成 ${sk.tasksDone} 项 · 经验 ${xp}${domains ? " · 擅长：" + esc(domains) : ""}</div>` : ""}
        <div class="proj-bar" style="margin-top:5px;height:6px"><div style="width:${xpPct}%"></div></div>
        <div style="font-size:9px;color:#b0a090;margin-top:1px">Lv.${lvl} 经验 ${xpInLvl}/30 到下一级</div></div>`;
      body.appendChild(card);
    }
    const hireRow = document.createElement("div");
    hireRow.className = "hire-row";
    const hc = (Ss.economy && Ss.economy.hireCost) || { dev: 1000, art: 1200, qa: 800, ops: 900 };
    for (const role of ["dev", "art", "qa", "ops"]) {
      const b = document.createElement("button");
      b.className = "btn blue";
      b.textContent = "招" + { dev: "程序员", art: "美术", qa: "测试", ops: "运营" }[role] + " 💰" + hc[role];
      b.addEventListener("click", async () => {
        const name = { dev: "阿伟", art: "小美", qa: "小测", ops: "小运" }[role] + "-" + Math.floor(Math.random() * 100);
        b.disabled = true; b.textContent = "雇佣中…";
        try {
          const d = await Bridge.hireEmployee(name, role);
          S.notify("新员工入职", name + " 已加入（花费 " + (d.cost||hc[role]) + " 元）", { icon: "users", type: "hire" });
          UI.refreshFunds();
        }
        catch (e) { S.notify("雇佣失败", e.message, { icon: "excl", type: "error" }); addPM("雇佣失败：" + e.message); }
        b.disabled = false; b.textContent = "招" + { dev: "程序员", art: "美术", qa: "测试", ops: "运营" }[role] + " 💰" + hc[role];
        await PM.syncFromBridge().catch(() => {}); renderTeam();
      });
      hireRow.appendChild(b);
    }
    body.appendChild(hireRow);
    // 公司记忆入口
    const memBtn = document.createElement("button");
    memBtn.className = "btn gray";
    memBtn.textContent = "📖 公司记忆";
    memBtn.style.cssText = "margin-top:10px;width:100%";
    memBtn.addEventListener("click", renderMemory);
    body.appendChild(memBtn);
  }
  async function renderMemory() {
    if (!window.Bridge || !Bridge.isConfigured()) { addPM("请先连接。"); return; }
    const body = $("panel-emp").querySelector(".panel-body");
    body.innerHTML = "";
    body.appendChild(sec("📖 公司长期记忆"));
    try {
      const d = await Bridge.getMemory();
      const m = d.memory || {};
      let html = "";
      const emps = Object.values(m.employees || {});
      if (emps.length) { html += "<div class='section-title'>团队成员</div>" + emps.map(e => "<div style='font-size:12px;padding:2px 0'>· " + esc(e.name) + "（" + esc(e.roleName||e.role) + "）</div>").join(""); }
      const tasks = m.tasks || [];
      if (tasks.length) { html += "<div class='section-title'>已完成任务</div>" + tasks.map(t => "<div style='font-size:12px;padding:3px 0;color:#6e5f50'>· " + esc(t.title) + "（" + esc((t.assign||[]).join("、")||"待定") + "）</div>").join(""); }
      const events = m.events || [];
      if (events.length) { html += "<div class='section-title'>关键事件</div>" + events.slice(0,8).map(e => "<div style='font-size:12px;padding:2px 0;color:#8a6f52'>· " + esc(e.text) + "</div>").join(""); }
      if (!html) html = '<div class="notif-empty">暂无公司记忆</div>';
      body.innerHTML += html;
    } catch (e) { body.innerHTML += '<div class="notif-empty">读取失败：' + esc(e.message||"") + "</div>"; }
    const back = document.createElement("button");
    back.className = "btn gray"; back.textContent = "← 返回团队";
    back.style.cssText = "margin-top:10px;width:100%";
    back.addEventListener("click", () => renderTeam());
    body.appendChild(back);
  }
  function sec(text) { const d = document.createElement("div"); d.className = "section-title"; d.textContent = text; return d; }

  // 点击办公室里的员工：显示该员工的卡片（气泡+面板）
  function onEmpClick(emp) {
    if (!emp) return;
    try {
      // 场景气泡：员工向老板打招呼
      if (window.Game && window.Game._showBubble) window.Game._showBubble(emp, "老板好！👋");
      // 打开团队面板并高亮该员工
      openPanel("emp");
      setTimeout(() => {
        const cards = document.querySelectorAll("#panel-emp .emp-card");
        for (const c of cards) {
          if (c.innerText.includes(emp.name || "")) {
            c.style.borderColor = "#f2d04a";
            c.style.boxShadow = "0 0 8px rgba(242,208,74,.7)";
            c.scrollIntoView({ block: "center", behavior: "smooth" });
          }
        }
      }, 120);
    } catch (e) {}
  }

  // ---------- 任务看板（多列） ----------
  const COLS = [ { id: "todo", name: "待办" }, { id: "doing", name: "执行中" }, { id: "failed", name: "失败" }, { id: "done", name: "已完成" } ];
  let projFilter = ""; // 项目筛选（空 = 全部）
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
    const statsBtn = document.createElement("button");
    statsBtn.className = "btn blue"; statsBtn.textContent = "📊 统计";
    statsBtn.addEventListener("click", renderStats);
    const archBtn = document.createElement("button");
    archBtn.className = "btn gray"; archBtn.textContent = "🗄 归档";
    archBtn.addEventListener("click", renderArchived);
    const reportBtn = document.createElement("button");
    reportBtn.className = "btn gray"; reportBtn.textContent = "📋 周报";
    reportBtn.addEventListener("click", renderWeeklyReport);
    const suggestBtn = document.createElement("button");
    suggestBtn.className = "btn blue"; suggestBtn.textContent = "💡 建议";
    suggestBtn.addEventListener("click", renderPmSuggest);
    const projBtn = document.createElement("button");
    projBtn.className = "btn gray"; projBtn.textContent = "📁 项目";
    projBtn.addEventListener("click", renderProjects);
    const dashBtn = document.createElement("button");
    dashBtn.className = "btn green"; dashBtn.textContent = "🏢 总览";
    dashBtn.addEventListener("click", renderDashboard);
    const tplBtn = document.createElement("button");
    tplBtn.className = "btn gray"; tplBtn.textContent = "📌 模板";
    tplBtn.addEventListener("click", renderTaskTemplates);
    const achBtn = document.createElement("button");
    achBtn.className = "btn gold"; achBtn.textContent = "🏆 成就";
    achBtn.style.cssText = "background:linear-gradient(#f2d04a,#d8a838);border:2px solid #a87e1e;color:#3b2b20";
    achBtn.addEventListener("click", renderAchievements);
    const btnWrap = document.createElement("div");
    btnWrap.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
    btnWrap.appendChild(dashBtn); btnWrap.appendChild(achBtn); btnWrap.appendChild(tplBtn); btnWrap.appendChild(archBtn); btnWrap.appendChild(statsBtn); btnWrap.appendChild(reportBtn); btnWrap.appendChild(suggestBtn); btnWrap.appendChild(projBtn); btnWrap.appendChild(addBtn);
    top.appendChild(cnt); top.appendChild(btnWrap);
    body.appendChild(top);

    // 项目筛选行
    const filterRow = document.createElement("div");
    filterRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:12px;color:#b0a080";
    filterRow.innerHTML = "<span>项目：</span>";
    const sel = document.createElement("select");
    sel.style.cssText = "flex:1;background:#f4f1ea;color:#2f2b26;border:1px solid #c8b8a0;border-radius:4px;padding:5px;font-size:12px";
    const projs = [...new Set(Ss.tasks.map(t => t.project || "未分类"))].sort();
    sel.innerHTML = '<option value="">全部</option>' + projs.map(p => `<option value="${esc(p)}" ${projFilter === p ? "selected" : ""}>${esc(p)}</option>`).join("");
    sel.addEventListener("change", () => { projFilter = sel.value; renderKanban(); });
    filterRow.appendChild(sel);
    body.appendChild(filterRow);

    const board = document.createElement("div");
    board.className = "kanban";
    board.style.cssText = "display:flex;gap:10px;overflow-x:auto;align-items:flex-start";
    for (const col of COLS) {
      const colDiv = document.createElement("div");
      colDiv.className = "kanban-col";
      colDiv.style.cssText = "flex:1;min-width:140px;background:#3a2a1a;border:1px solid #1a120a;border-radius:6px;padding:8px";
      const hdr = document.createElement("div");
      hdr.style.cssText = "font-weight:bold;font-size:13px;margin-bottom:8px;color:" + (col.id === "done" ? "#5fbf8f" : col.id === "doing" ? "#f2d04a" : "#cfe0ff");
      const colTasks = Ss.tasks.filter(t => t.status === col.id && (!projFilter || (t.project || "未分类") === projFilter))
        .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[(a.priority||"medium")] - { high: 0, medium: 1, low: 2 }[(b.priority||"medium")]));
      hdr.textContent = col.name + " (" + colTasks.length + ")";
      colDiv.appendChild(hdr);
      for (const t of colTasks) {
        const card = document.createElement("div");
        card.className = "task-card";
        card.style.cssText = "background:#4a3520;border:1px solid #1a120a;border-radius:4px;padding:8px;margin-bottom:8px;cursor:pointer";
        const stTxt = { todo: "待办", doing: "执行中", done: "已完成", failed: "失败" }[t.status];
        const stageTxt = { planning: "计划中", executing: "执行中", polishing: "完善中", retrying: "重试中", revising: "修订中", failed: "失败", done: "已完成" }[t.stage] || "";
        const statusHtml = t.status === "done" ? '<span style="color:#5fbf8f">✅ 已完成</span>'
          : t.status === "failed" ? '<span style="color:#e06c5a">❌ 失败</span>'
          : t.status === "doing" ? '<span style="color:#f2d04a">⏳ ' + esc(stageTxt||"执行中") + '</span>'
          : '<span style="color:#cfe0ff">待办</span>';
        // 子任务进度（若存在）—— 分段像素进度条
        const subHtml = (t.subtasks && t.subtasks.length) ? `<div style="font-size:10px;color:#b0a080;margin-top:4px">子任务 ${t.subtasks.filter(s=>s.done).length}/${t.subtasks.length}：${esc(t.currentSubtask||"")}</div><div class="sub-progress">${t.subtasks.map(s => '<i class="' + (s.done ? "on" : (t.currentSubtask === s.title ? "cur" : "")) + '"></i>').join("")}</div>` : "";
        // 修订次数徽标
        const revHtml = (t.feedback && t.feedback.length) ? `<span style="color:#f2d04a;font-size:10px;margin-left:4px">🔄${t.feedback.length}</span>` : "";
        const prioHtml = { high: '<span style="color:#e06c5a">🔺高</span>', medium: '<span style="color:#f2d04a">▪中</span>', low: '<span style="color:#5fbf8f">▫低</span>' }[t.priority||"medium"] || "";
        card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:4px">
            <div style="font-weight:bold;font-size:13px;flex:1">${esc(t.title)}</div>${prioHtml}
            <button class="card-act" style="background:none;border:none;color:#b0a080;font-size:13px;cursor:pointer" data-act="menu">☰</button></div>
          <div style="font-size:11px;color:#b0a080;margin-top:4px">负责人：${esc((t.assign||[]).join("、") || "待定")}${revHtml}</div>
          <div style="font-size:11px;color:#8a6f52;margin-top:2px;word-break:break-all">工作区：${esc(t.workspace||"")}</div>
          <div style="font-size:11px;margin-top:6px">${statusHtml}</div>
          ${subHtml}
          <div class="card-menu" data-menu="${t.id}" style="display:none;margin-top:6px;background:#3a2a1a;border:1px solid #1a120a;border-radius:4px;padding:4px">
            <button class="btn blue" data-act="redispatch" data-id="${t.id}" style="width:100%;margin:2px 0">${t.status === "done" ? "重新执行" : "重新执行"}</button>
            <button class="btn gray" data-act="cancel" data-id="${t.id}" style="width:100%;margin:2px 0">移到待办</button>
            <button class="btn gray" data-act="priority" data-id="${t.id}" data-p="high" style="width:100%;margin:2px 0">设为高优先级</button>
            <button class="btn gray" data-act="priority" data-id="${t.id}" data-p="low" style="width:100%;margin:2px 0">设为低优先级</button>
            <button class="btn gray" data-act="archive" data-id="${t.id}" style="width:100%;margin:2px 0">归档</button>
            <button class="btn gray" data-act="delete" data-id="${t.id}" style="width:100%;margin:2px 0;color:#e06c5a">删除任务</button>
          </div>`;
        card.addEventListener("click", (e) => { if (!e.target.closest(".card-act") && !e.target.closest(".card-menu")) openTaskDetail(t.id); });
        card.addEventListener("click", (e) => {
          const act = e.target.closest("[data-act]");
          if (!act) return;
          e.stopPropagation();
          if (act.dataset.act === "menu") { const m = card.querySelector(".card-menu"); m.style.display = m.style.display === "none" ? "block" : "none"; return; }
          const id = act.dataset.id;
          if (act.dataset.act === "redispatch") { Bridge.dispatchTask(id).then(() => { S.notify("已安排执行", "", { type: "task" }); return PM.syncFromBridge(); }).catch(()=>{}); }
          else if (act.dataset.act === "cancel") { Bridge.cancelTask(id).then(() => PM.syncFromBridge()).catch(()=>{}); }
          else if (act.dataset.act === "priority") { Bridge.setTaskPriority(id, act.dataset.p).then(() => PM.syncFromBridge()).catch(()=>{}); }
          else if (act.dataset.act === "archive") { if (confirm("归档此任务？")) Bridge.archiveTask(id).then(() => PM.syncFromBridge()).catch(()=>{}); }
          else if (act.dataset.act === "delete") { if (confirm("删除任务？")) Bridge.deleteTask(id).then(() => PM.syncFromBridge()).catch(()=>{}); }
        });
        colDiv.appendChild(card);
      }
      board.appendChild(colDiv);
    }
    body.appendChild(board);
  }

  // ---------- 数据统计 ----------
  async function renderStats() {
    if (!window.Bridge || !Bridge.isConfigured()) { addPM("请先连接。"); return; }
    const body = $("panel-tasks").querySelector(".panel-body");
    body.innerHTML = "";
    body.appendChild(sec("📊 数据统计"));
    body.innerHTML += '<div style="color:#8a6f52;font-size:12px">加载中…</div>';
    try {
      const d = await Bridge.getStats();
      const s = d.stats || {};
      const fmtDur = (sec) => { if (!sec) return "—"; if (sec < 60) return sec + "秒"; if (sec < 3600) return Math.round(sec/60) + "分"; return Math.round(sec/3600*10)/10 + "时"; };
      body.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
          <div class="stat-box" style="flex:1;min-width:90px;background:#3a2a1a;border:1px solid #1a120a;border-radius:6px;padding:8px;text-align:center"><div style="font-size:20px;color:#f2d04a;font-weight:bold">${s.total||0}</div><div style="font-size:11px;color:#b0a080">总任务</div></div>
          <div class="stat-box" style="flex:1;min-width:90px;background:#3a2a1a;border:1px solid #1a120a;border-radius:6px;padding:8px;text-align:center"><div style="font-size:20px;color:#5fbf8f;font-weight:bold">${s.done||0}</div><div style="font-size:11px;color:#b0a080">已完成</div></div>
          <div class="stat-box" style="flex:1;min-width:90px;background:#3a2a1a;border:1px solid #1a120a;border-radius:6px;padding:8px;text-align:center"><div style="font-size:20px;color:#f2d04a;font-weight:bold">${s.successRate||0}%</div><div style="font-size:11px;color:#b0a080">成功率</div></div>
          <div class="stat-box" style="flex:1;min-width:90px;background:#3a2a1a;border:1px solid #1a120a;border-radius:6px;padding:8px;text-align:center"><div style="font-size:20px;color:#9fe8cf;font-weight:bold">${fmtDur(s.avgDurationSec)}</div><div style="font-size:11px;color:#b0a080">平均耗时</div></div>
        </div>
        <div style="display:flex;gap:12px;margin-bottom:10px;font-size:12px;color:#b0a080">
          <span>待办 ${s.todo||0}</span><span>执行中 ${s.doing||0}</span><span>失败 ${s.failed||0}</span>
        </div>`;
      // 员工工作量
      const empWork = s.empWork || [];
      if (empWork.length) {
        body.appendChild(sec("员工工作量"));
        const maxDone = Math.max(1, ...empWork.map(e => e.done || 0));
        for (const e of empWork) {
          const row = document.createElement("div");
          row.style.cssText = "margin-bottom:8px";
          row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
              <span>${esc(e.name)}（${esc(e.role||"")}）Lv.${e.level||1}</span>
              <span style="color:#f2d04a">${e.done||0} 项</span>
            </div>
            <div class="proj-bar"><div style="width:${Math.round(((e.done||0)/maxDone)*100)}%"></div></div>`;
          body.appendChild(row);
        }
      }
    } catch (e) { body.innerHTML += '<div class="notif-empty">统计失败：' + esc(e.message||"") + "</div>"; }
    const back = document.createElement("button");
    back.className = "btn gray"; back.textContent = "← 返回看板";
    back.style.cssText = "margin-top:12px;width:100%";
    back.addEventListener("click", renderKanban);
    body.appendChild(back);
  }

  // ---------- 归档历史 ----------
  async function renderArchived() {
    if (!window.Bridge || !Bridge.isConfigured()) { addPM("请先连接。"); return; }
    const body = $("panel-tasks").querySelector(".panel-body");
    body.innerHTML = "";
    body.appendChild(sec("🗄 归档历史"));
    body.innerHTML += '<div style="color:#8a6f52;font-size:12px">加载中…</div>';
    try {
      const d = await Bridge.listArchived();
      const arch = d.archived || [];
      body.innerHTML = "";
      body.appendChild(sec("🗄 归档历史（" + arch.length + "）"));
      if (!arch.length) { body.innerHTML += '<div class="notif-empty">暂无归档任务</div>'; }
      for (const a of arch) {
        const card = document.createElement("div");
        card.className = "task-card";
        card.style.cssText = "background:#4a3520;border:1px solid #1a120a;border-radius:4px;padding:8px;margin-bottom:8px";
        card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px"><div style="font-weight:bold;font-size:13px;flex:1">${esc(a.title)}</div>
          <button class="btn green" data-restore="${esc(a.id)}" style="flex-shrink:0;padding:3px 8px;font-size:11px">↩ 恢复</button></div>
          <div style="font-size:11px;color:#b0a080;margin-top:4px">负责人：${esc((a.assign||[]).join("、") || "待定")} · 归档于 ${new Date(a.archivedAt||Date.now()).toLocaleDateString()}</div>
          <div style="font-size:11px;color:#8a6f52;margin-top:4px;word-break:break-all">工作区：${esc(a.workspace||"")}</div>
          <div style="font-size:11px;color:#6e5f50;margin-top:4px;white-space:pre-wrap">${a.output ? esc(a.output.slice(0,200)) + (a.output.length > 200 ? "…" : "") : "(无产出)"}</div>
          <span class="arch-toggle" style="font-size:10px;color:#f2d04a;margin-top:4px;display:inline-block">▼ 展开产出</span>
          <div class="arch-full" style="display:none;font-size:11px;color:#6e5f50;margin-top:4px;white-space:pre-wrap;background:#3a2a1a;border:1px solid #1a120a;border-radius:4px;padding:8px;max-height:300px;overflow-y:auto">${esc(a.output||"(无产出)")}</div>`;
        card.querySelector("[data-restore]").addEventListener("click", async (e) => {
          e.stopPropagation();
          try {
            await Bridge.restoreTask(a.id);
            addPM("已把「" + a.title + "」恢复到任务看板（待办）。");
            renderArchived();
          } catch (err) { addPM("恢复失败：" + (err.message||"")); }
        });
        // 点击卡片展开/收起完整产出
        const outDiv = card.querySelector(".arch-full");
        card.style.cursor = "pointer";
        card.addEventListener("click", (e) => {
          if (e.target.closest("[data-restore]")) return;
          if (!outDiv) return;
          const hidden = outDiv.style.display === "none";
          outDiv.style.display = hidden ? "block" : "none";
          card.querySelector(".arch-toggle").textContent = hidden ? "▲ 收起" : "▼ 展开产出";
        });
        body.appendChild(card);
      }
    } catch (e) { body.innerHTML += '<div class="notif-empty">读取失败：' + esc(e.message||"") + "</div>"; }
    const back = document.createElement("button");
    back.className = "btn gray"; back.textContent = "← 返回看板";
    back.style.cssText = "margin-top:12px;width:100%";
    back.addEventListener("click", renderKanban);
    body.appendChild(back);
  }

  // ---------- 项目周报 ----------
  async function renderWeeklyReport() {
    if (!window.Bridge || !Bridge.isConfigured()) { addPM("请先连接。"); return; }
    const body = $("panel-tasks").querySelector(".panel-body");
    body.innerHTML = "";
    body.appendChild(sec("📋 项目周报"));
    body.innerHTML += '<div style="color:#8a6f52;font-size:12px">PM 生成中…（约 10 秒）</div>';
    try {
      const d = await Bridge.pmReport();
      const content = d.content || "(无内容)";
      body.innerHTML = "";
      body.appendChild(sec("📋 项目周报"));
      // 复制按钮（分享/导出）
      const copyBtn = document.createElement("button");
      copyBtn.className = "btn gray"; copyBtn.textContent = "📋 复制";
      copyBtn.style.cssText = "width:100%;margin-bottom:6px";
      copyBtn.addEventListener("click", async () => {
        const ok = await copyText(content); copyBtn.textContent = ok ? "✅ 已复制" : "复制失败"; if (ok) setTimeout(() => { copyBtn.textContent = "📋 复制"; }, 1500);
      });
      body.appendChild(copyBtn);
      // 历史周报按钮
      const histBtn = document.createElement("button");
      histBtn.className = "btn blue"; histBtn.textContent = "🗓 历史周报";
      histBtn.style.cssText = "width:100%;margin-bottom:8px";
      histBtn.addEventListener("click", renderReportHistory);
      body.appendChild(histBtn);
      const pre = document.createElement("div");
      pre.style.cssText = "font-size:12px;white-space:pre-wrap;color:#333;background:#f4f1ea;padding:10px;border-radius:4px;line-height:1.6";
      pre.textContent = content;
      body.appendChild(pre);
      UI.addPM("【项目周报】\n" + content.slice(0, 300));
    } catch (e) { body.innerHTML += '<div class="notif-empty">周报生成失败：' + esc(e.message||"") + "</div>"; }
    const back = document.createElement("button");
    back.className = "btn gray"; back.textContent = "← 返回看板";
    back.style.cssText = "margin-top:12px;width:100%";
    back.addEventListener("click", renderKanban);
    body.appendChild(back);
  }

  // ---------- 历史周报 ----------
  async function renderReportHistory() {
    if (!window.Bridge || !Bridge.isConfigured()) { addPM("请先连接。"); return; }
    const body = $("panel-tasks").querySelector(".panel-body");
    body.innerHTML = "";
    body.appendChild(sec("🗓 历史周报"));
    body.innerHTML += '<div style="color:#8a6f52;font-size:12px">加载中…</div>';
    try {
      const d = await Bridge.listReports();
      const reports = d.reports || [];
      body.innerHTML = "";
      body.appendChild(sec("🗓 历史周报（" + reports.length + "）"));
      if (!reports.length) { body.innerHTML += '<div class="notif-empty">暂无历史周报，先生成一份吧</div>'; }
      for (const r of reports) {
        const st = r.stats || {};
        const card = document.createElement("div");
        card.className = "task-card";
        card.style.cssText = "background:#4a3520;border:1px solid #1a120a;border-radius:4px;padding:8px;margin-bottom:8px;cursor:pointer";
        card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:13px">${esc(r.day)}</b><span style="font-size:10px;color:#b0a080">${st.done||0}/${st.total||0} 完成</span></div>`;
        card.addEventListener("click", async () => {
          try {
            const rd = await Bridge.getReport(r.day);
            const rep = rd.report || {};
            body.innerHTML = "";
            body.appendChild(sec("🗓 周报 · " + r.day));
            const pre = document.createElement("div");
            pre.style.cssText = "font-size:12px;white-space:pre-wrap;color:#333;background:#f4f1ea;padding:10px;border-radius:4px;line-height:1.6";
            pre.textContent = rep.content || "(无内容)";
            body.appendChild(pre);
            const back2 = document.createElement("button");
            back2.className = "btn gray"; back2.textContent = "← 返回历史列表";
            back2.style.cssText = "margin-top:12px;width:100%";
            back2.addEventListener("click", renderReportHistory);
            body.appendChild(back2);
          } catch (e) { addPM("读取失败：" + (e.message||"")); }
        });
        body.appendChild(card);
      }
    } catch (e) { body.innerHTML += '<div class="notif-empty">读取失败：' + esc(e.message||"") + "</div>"; }
    const back = document.createElement("button");
    back.className = "btn gray"; back.textContent = "← 返回看板";
    back.style.cssText = "margin-top:12px;width:100%";
    back.addEventListener("click", renderKanban);
    body.appendChild(back);
  }

  // ---------- PM 行动建议 ----------
  async function renderPmSuggest() {
    if (!window.Bridge || !Bridge.isConfigured()) { addPM("请先连接。"); return; }
    const body = $("panel-tasks").querySelector(".panel-body");
    body.innerHTML = "";
    body.appendChild(sec("💡 PM 行动建议"));
    body.innerHTML += '<div style="color:#8a6f52;font-size:12px">PM 正在分析公司状态…（约 10 秒）</div>';
    try {
      const d = await Bridge.pmSuggest();
      const content = d.content || "(无内容)";
      body.innerHTML = "";
      body.appendChild(sec("💡 PM 行动建议"));
      const copyBtn = document.createElement("button");
      copyBtn.className = "btn gray"; copyBtn.textContent = "📋 复制";
      copyBtn.style.cssText = "width:100%;margin-bottom:8px";
      copyBtn.addEventListener("click", async () => {
        const ok = await copyText(content); copyBtn.textContent = ok ? "✅ 已复制" : "复制失败"; if (ok) setTimeout(() => { copyBtn.textContent = "📋 复制"; }, 1500);
      });
      body.appendChild(copyBtn);
      const pre = document.createElement("div");
      pre.style.cssText = "font-size:12px;white-space:pre-wrap;color:#333;background:#f4f1ea;padding:10px;border-radius:4px;line-height:1.6";
      pre.textContent = content;
      body.appendChild(pre);
      UI.addPM("【PM 行动建议】\n" + content.slice(0, 300));
    } catch (e) { body.innerHTML += '<div class="notif-empty">建议生成失败：' + esc(e.message||"") + "</div>"; }
    const back = document.createElement("button");
    back.className = "btn gray"; back.textContent = "← 返回看板";
    back.style.cssText = "margin-top:12px;width:100%";
    back.addEventListener("click", renderKanban);
    body.appendChild(back);
  }

  // ---------- 任务模板（一键创建常用任务） ----------
  const TASK_TEMPLATES = [
    { title: "写官网首页文案", desc: "为公司官网首页撰写介绍文案，突出像素风格与办公室经营玩法。", project: "官网", role: "ops" },
    { title: "写登录页代码", desc: "用 HTML/CSS/JS 实现像素风格登录页，含表单校验。", project: "登录页", role: "dev" },
    { title: "设计宣传海报", desc: "设计一张像素风宣传海报，含配色与构图说明。", project: "官网", role: "art" },
    { title: "编写测试用例", desc: "为核心功能编写测试用例表与验收标准。", project: "测试", role: "qa" },
    { title: "写推广活动方案", desc: "策划一次游戏推广活动，含目标/玩法/奖励/传播节奏。", project: "运营", role: "ops" },
    { title: "写吉祥物设定", desc: "设计公司吉祥物角色设定，含外观/性格/使用场景。", project: "品牌", role: "art" },
  ];
  async function renderTaskTemplates() {
    if (!window.Bridge || !Bridge.isConfigured()) { addPM("请先连接。"); return; }
    const body = $("panel-tasks").querySelector(".panel-body");
    body.innerHTML = "";
    body.appendChild(sec("📌 任务模板"));
    body.innerHTML += '<div style="color:#8a6f52;font-size:12px;margin-bottom:8px">一键创建常用任务，点击即派发执行</div>';
    for (const t of TASK_TEMPLATES) {
      const card = document.createElement("div");
      card.className = "task-card";
      card.style.cssText = "background:#4a3520;border:1px solid #1a120a;border-radius:4px;padding:8px;margin-bottom:8px;cursor:pointer";
      card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
        <div style="font-weight:bold;font-size:13px;flex:1">${esc(t.title)}</div>
        <span style="font-size:10px;color:#9fe8cf;flex-shrink:0">${esc(t.project||"")}</span>
        <span style="font-size:10px;color:#f2d04a;flex-shrink:0">${esc({dev:"程序员",art:"美术",qa:"测试",ops:"运营"}[t.role]||"")}</span>
      </div>
      <div style="font-size:11px;color:#b0a080;margin-top:4px">${esc(t.desc)}</div>`;
      card.addEventListener("click", async () => {
        card.style.opacity = "0.6";
        try {
          const d = await Bridge.createTask(t.title, t.desc, [], "", "medium", t.project);
          if (d.task) await Bridge.dispatchTask(d.task.id).catch(() => {});
          S.notify("任务已创建", "「" + t.title + "」已派发执行", { icon: "flag", type: "task", important: true });
          await PM.syncFromBridge().catch(() => {});
          addPM("好的老板，已按模板创建「" + t.title + "」并派发给员工执行！");
          renderKanban();
        } catch (e) { addPM("创建失败：" + (e.message||"")); }
        card.style.opacity = "1";
      });
      body.appendChild(card);
    }
    const back = document.createElement("button");
    back.className = "btn gray"; back.textContent = "← 返回看板";
    back.style.cssText = "margin-top:12px;width:100%";
    back.addEventListener("click", renderKanban);
    body.appendChild(back);
  }

  // ---------- 成就系统 ----------
  async function renderAchievements() {
    if (!window.Bridge || !Bridge.isConfigured()) { addPM("请先连接。"); return; }
    const body = $("panel-tasks").querySelector(".panel-body");
    body.innerHTML = "";
    body.appendChild(sec("🏆 成就"));
    body.innerHTML += '<div style="color:#8a6f52;font-size:12px">加载中…</div>';
    try {
      const d = await Bridge.getAchievements();
      const a = d.achievements || {};
      const unlockedIds = new Set((a.unlocked || []).map(x => x.id));
      const all = a.all || [];
      const total = a.total || all.length;
      body.innerHTML = "";
      body.appendChild(sec("🏆 成就（" + a.unlockedCount + "/" + total + "）"));
      if (!all.length) { body.innerHTML += '<div class="notif-empty">暂无成就数据</div>'; }
      for (const ach of all) {
        const unlocked = unlockedIds.has(ach.id);
        body.innerHTML += `<div style="display:flex;align-items:center;gap:8px;padding:8px;margin-bottom:6px;background:${unlocked ? "#2a6a4f" : "#4a3520"};border:1px solid ${unlocked ? "#5fbf8f" : "#1a120a"};border-radius:5px">
          <div style="font-size:22px;flex-shrink:0">${unlocked ? esc(ach.icon||"🏆") : "🔒"}</div>
          <div style="flex:1">
            <div style="font-weight:bold;font-size:13px;color:${unlocked ? "#cfe8da" : "#b0a080"}">${esc(ach.name||"")}</div>
            <div style="font-size:11px;color:${unlocked ? "#9fe8cf" : "#8a6f52"}">${esc(ach.desc||"")}</div>
          </div>
          ${unlocked ? '<span style="color:#f2d04a;font-size:11px;flex-shrink:0">✓ 已解锁</span>' : ""}
        </div>`;
      }
    } catch (e) { body.innerHTML += '<div class="notif-empty">读取失败：' + esc(e.message||"") + "</div>"; }
    const back = document.createElement("button");
    back.className = "btn gray"; back.textContent = "← 返回看板";
    back.style.cssText = "margin-top:12px;width:100%";
    back.addEventListener("click", renderKanban);
    body.appendChild(back);
  }

  // ---------- 公司经济 ----------
  async function renderEconomy() {
    if (!window.Bridge || !Bridge.isConfigured()) { addPM("请先连接。"); return; }
    const body = $("panel-tasks").querySelector(".panel-body");
    body.innerHTML = "";
    body.appendChild(sec("💰 公司财务"));
    body.innerHTML += '<div style="color:#8a6f52;font-size:12px">加载中…</div>';
    try {
      const d = await Bridge.getEconomy();
      const eco = d.economy || {};
      const funds = eco.funds || 0;
      body.innerHTML = "";
      body.appendChild(sec("💰 公司财务"));
      // 公司等级卡（里程碑）
      try {
        const cd = await Bridge.getCompany();
        const co = cd.company || {};
        body.innerHTML += `<div style="background:#3a2a1a;border:2px solid #1a120a;border-radius:6px;padding:12px;margin-bottom:10px;text-align:center">
          <div style="font-size:13px;color:#f2e6cf">${esc(co.emoji || "🏠")} <b>${esc(co.name || "像素软件株式会社")}</b> <span style="color:#f2d04a">Lv.${co.level || 1}</span></div>
          <div style="font-size:11px;color:#b0a080;margin-top:4px">已完成 ${co.doneTasks || 0} 项任务</div>
          ${co.next ? `<div style="font-size:11px;color:#8a6f52;margin-top:6px">下一阶段：${esc(co.next.emoji)} ${esc(co.next.name)}（任务 ${co.doneTasks}/${co.next.minTasks} · 资金 ${fmt(co.funds||0)}/${fmt(co.next.minFunds)}）</div>
          <div class="proj-bar" style="margin-top:4px"><div style="width:${Math.max(0, Math.min(100, (co.nextProgress ? co.nextProgress.tasksPct : 0)))}%"></div></div>` : '<div style="font-size:11px;color:#5fbf8f;margin-top:6px">🏆 已达成最高等级！</div>'}
        </div>`;
      } catch (e) {}
      // 资金大数字
      body.innerHTML += `<div style="background:#4a3520;border:2px solid #1a120a;border-radius:6px;padding:14px;text-align:center;margin-bottom:10px">
        <div style="font-size:12px;color:#b0a080">公司资金</div>
        <div style="font-size:30px;color:#f2d04a;font-weight:bold;font-family:'MisekiBitmap',monospace">${fmt(funds)}</div>
        <div style="font-size:11px;color:#8a6f52;margin-top:4px">完成任务赚钱 · 雇佣员工花钱</div>
      </div>`;
      // 价格表
      body.appendChild(sec("价格表"));
      const hc = eco.hireCost || { dev: 1000, art: 1200, qa: 800, ops: 900 };
      body.innerHTML += '<div style="font-size:12px;line-height:1.9;color:#6e5f50">' +
        "👨‍💻 程序员 " + hc.dev + "　🎨 美术 " + hc.art + "　🧪 测试 " + hc.qa + "　📣 运营 " + hc.ops + "</div>";
      const rw = eco.reward || { high: 800, medium: 500, low: 300 };
      body.innerHTML += '<div style="font-size:11px;color:#8a6f52;margin-top:4px">任务奖励：高优先 ' + rw.high + " / 中优先 " + rw.medium + " / 低优先 " + rw.low + " · 失败扣 200</div>";
      if (eco.bonusNote) body.innerHTML += '<div style="font-size:11px;color:#f2d04a;margin-top:3px">⭐ ' + esc(eco.bonusNote) + "</div>";
      if (eco.empBonusNote) body.innerHTML += '<div style="font-size:11px;color:#9fe8cf;margin-top:3px">🧑‍💻 ' + esc(eco.empBonusNote) + "</div>";
      // 资金流水
      body.appendChild(sec("资金流水"));
      const ledger = eco.ledger || [];
      if (!ledger.length) body.innerHTML += '<div class="notif-empty">暂无流水</div>';
      for (const l of ledger) {
        const t = new Date(l.at||Date.now()).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"});
        const sign = l.amount >= 0 ? "+" : "";
        body.innerHTML += `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:5px 6px;border-bottom:1px dashed #d8c9a3">
          <span style="color:#6e5f50">${esc(l.label)}</span>
          <span style="color:${l.amount >= 0 ? "#3d8b6f" : "#c33c3c"};font-weight:bold">${sign}${l.amount}</span>
          <span style="color:#b0a090;font-size:10px">${t}</span>
        </div>`;
      }
      S.get().funds = funds; S.get().economy = eco; S.save(); S.emit();
    } catch (e) { body.innerHTML += '<div class="notif-empty">读取失败：' + esc(e.message||"") + "</div>"; }
    const back = document.createElement("button");
    back.className = "btn gray"; back.textContent = "← 返回看板";
    back.style.cssText = "margin-top:12px;width:100%";
    back.addEventListener("click", renderKanban);
    body.appendChild(back);
  }

  // ---------- 项目聚合视图 ----------
  async function renderProjects() {
    if (!window.Bridge || !Bridge.isConfigured()) { addPM("请先连接。"); return; }
    const body = $("panel-tasks").querySelector(".panel-body");
    body.innerHTML = "";
    body.appendChild(sec("📁 项目总览"));
    body.innerHTML += '<div style="color:#8a6f52;font-size:12px">加载中…</div>';
    try {
      const d = await Bridge.listProjects();
      const projects = d.projects || [];
      body.innerHTML = "";
      body.appendChild(sec("📁 项目总览（" + projects.length + "）"));
      if (!projects.length) { body.innerHTML += '<div class="notif-empty">暂无任务，先去创建任务吧</div>'; }
      for (const p of projects) {
        const card = document.createElement("div");
        card.className = "proj-card";
        card.innerHTML = `<div class="pc-head"><span class="pc-name">${esc(p.name)}</span><span style="font-size:12px;color:${p.pct >= 100 ? "#3d8b6f" : "#f2d04a"}">${p.pct}%</span></div>
          <div class="pc-body">
            <div class="proj-line"><span class="lbl">进度</span><div class="proj-bar"><div style="width:${p.pct}%"></div></div><span class="proj-pct">${p.done}/${p.total}</span></div>
            <div style="font-size:11px;color:#8a6f52;margin-top:4px">✅ ${p.done} 完成 · ⏳ ${p.doing} 执行中 · 📝 ${p.todo} 待办${p.failed ? " · ❌ " + p.failed + " 失败" : ""}</div>
          </div>`;
        body.appendChild(card);
      }
      // 快捷：点击项目卡片可筛选看板
      body.querySelectorAll(".proj-card").forEach((c, i) => {
        c.style.cursor = "pointer";
        c.addEventListener("click", () => { projFilter = projects[i].name === "未分类" ? "" : projects[i].name; renderKanban(); });
      });
    } catch (e) { body.innerHTML += '<div class="notif-empty">读取失败：' + esc(e.message||"") + "</div>"; }
    const back = document.createElement("button");
    back.className = "btn gray"; back.textContent = "← 返回看板";
    back.style.cssText = "margin-top:12px;width:100%";
    back.addEventListener("click", renderKanban);
    body.appendChild(back);
  }

  // ---------- 公司总览看板（mission control） ----------
  async function renderDashboard() {
    if (!window.Bridge || !Bridge.isConfigured()) { addPM("请先连接。"); return; }
    const body = $("panel-tasks").querySelector(".panel-body");
    body.innerHTML = "";
    body.appendChild(sec("🏢 公司总览"));
    body.innerHTML += '<div style="color:#8a6f52;font-size:12px">加载中…</div>';
    try {
      const [dash, comp, proj] = await Promise.all([Bridge.getEconomy(), Bridge.getCompany(), Bridge.listProjects()]);
      const eco = dash.economy || {};
      const co = comp.company || {};
      const projects = proj.projects || [];
      const funds = eco.funds || 0;
      const Ss = S.get();
      // 同步到状态，保持 HUD 一致
      Ss.funds = funds; Ss.economy = eco; Ss.company = co; S.save(); S.emit();
      body.innerHTML = "";
      body.appendChild(sec("🏢 公司总览"));
      // 公司等级 + 资金
      body.innerHTML += `<div style="display:flex;gap:8px;margin-bottom:8px">
        <div style="flex:1;background:#3a2a1a;border:2px solid #1a120a;border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:11px;color:#b0a080">${esc(co.emoji||"🏠")} 公司等级</div>
          <div style="font-size:18px;color:#f2d04a;font-weight:bold">${esc(co.name||"—")} Lv.${co.level||1}</div>
        </div>
        <div style="flex:1;background:#3a2a1a;border:2px solid #1a120a;border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:11px;color:#b0a080">💰 公司资金</div>
          <div style="font-size:18px;color:#9fe8cf;font-weight:bold">${fmt(funds)}</div>
        </div>
      </div>`;
      // 下一等级进度
      if (co.next) {
        const np = co.nextProgress || {};
        body.innerHTML += `<div style="background:#3a2a1a;border:2px solid #1a120a;border-radius:6px;padding:8px;margin-bottom:8px">
          <div style="font-size:11px;color:#b0a080;margin-bottom:4px">下一阶段：${esc(co.next.emoji)} ${esc(co.next.name)}（Lv.${co.next.level}）</div>
          <div style="font-size:11px;color:#6e5f50;margin-bottom:2px">📋 任务 ${co.doneTasks||0}/${co.next.minTasks}</div>
          <div class="proj-bar"><div style="width:${np.tasksPct||0}%"></div></div>
          <div style="font-size:11px;color:#6e5f50;margin:4px 0 2px">💰 资金 ${fmt(co.funds||0)}/${fmt(co.next.minFunds)}</div>
          <div class="proj-bar"><div style="width:${np.fundsPct||0}%"></div></div>
        </div>`;
      } else {
        body.innerHTML += '<div style="font-size:12px;color:#5fbf8f;margin-bottom:8px">🏆 已达成最高公司等级！</div>';
      }
      // 任务/员工概览
      body.innerHTML += `<div style="display:flex;gap:8px;margin-bottom:8px">
        <div style="flex:1;background:#3a2a1a;border:2px solid #1a120a;border-radius:6px;padding:8px;text-align:center">
          <div style="font-size:20px;color:#9fe8cf;font-weight:bold">${Ss.tasks.length||0}</div><div style="font-size:10px;color:#b0a080">总任务</div></div>
        <div style="flex:1;background:#3a2a1a;border:2px solid #1a120a;border-radius:6px;padding:8px;text-align:center">
          <div style="font-size:20px;color:#5fbf8f;font-weight:bold">${Ss.employees.length||0}</div><div style="font-size:10px;color:#b0a080">员工数</div></div>
        <div style="flex:1;background:#3a2a1a;border:2px solid #1a120a;border-radius:6px;padding:8px;text-align:center">
          <div style="font-size:20px;color:#f2d04a;font-weight:bold">${projects.length||0}</div><div style="font-size:10px;color:#b0a080">项目数</div></div>
      </div>`;
      // 项目进度
      body.appendChild(sec("项目进度"));
      if (!projects.length) body.innerHTML += '<div class="notif-empty">暂无项目</div>';
      for (const p of projects.slice(0, 5)) {
        body.innerHTML += `<div style="font-size:12px;margin-bottom:5px">
          <div style="display:flex;justify-content:space-between;color:#6e5f50"><span>${esc(p.name)}</span><span style="color:${p.pct>=100?"#3d8b6f":"#f2d04a"}">${p.pct}% (${p.done}/${p.total})</span></div>
          <div class="proj-bar"><div style="width:${p.pct}%"></div></div></div>`;
      }
      // 最近完成任务
      body.appendChild(sec("最近完成"));
      const recent = Ss.tasks.filter(t => t.status === "done").slice(-5).reverse();
      if (!recent.length) body.innerHTML += '<div class="notif-empty">暂无完成任务</div>';
      for (const t of recent) {
        body.innerHTML += `<div style="font-size:12px;color:#6e5f50;padding:3px 0;border-bottom:1px dashed #d8c9a3">✅ ${esc(t.title)} <span style="color:#b0a090;font-size:10px">${esc((t.assign||[]).join("、")||"")}</span></div>`;
      }
    } catch (e) { body.innerHTML += '<div class="notif-empty">加载失败：' + esc(e.message||"") + "</div>"; }
    const back = document.createElement("button");
    back.className = "btn gray"; back.textContent = "← 返回看板";
    back.style.cssText = "margin-top:12px;width:100%";
    back.addEventListener("click", renderKanban);
    body.appendChild(back);
  }
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
      <div class="conn-field"><label>项目/分类（可选，如 官网/登录页/运营）</label><input id="tnew-project" placeholder="例如：官网" autocomplete="off"></div>
      <div class="conn-field"><label>优先级</label><select id="tnew-priority" style="width:100%;background:#f4f1ea;color:#2f2b26;border:1px solid #c8b8a0;border-radius:4px;padding:6px;font-size:13px"><option value="high">🔺 高</option><option value="medium" selected>▪ 中</option><option value="low">▫ 低</option></select></div>
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
      const priority = $("tnew-priority") ? $("tnew-priority").value : "medium";
      const project = $("tnew-project") ? $("tnew-project").value.trim() : "";
      if (!title) { addPM("请填写任务标题。"); return; }
      const assign = Array.from(document.querySelectorAll("#tnew-assign input:checked")).map(i => i.value);
      const btn = $("tnew-submit");
      btn.disabled = true; btn.textContent = "创建中…";
      try {
        const d = await Bridge.createTask(title, desc, assign, ws, priority, project);
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
    const stTxt = { todo: "待办", doing: "执行中", done: "已完成", failed: "失败" }[t.status] || t.status;
    body.innerHTML = "";
    body.appendChild(sec("任务详情"));
    body.innerHTML += `
      <div style="font-size:15px;font-weight:bold;margin-bottom:6px">${esc(t.title)}</div>
      <div style="font-size:12px;color:#b0a080;margin-bottom:6px">状态：${esc(stTxt)}${t.stage ? " · " + esc({planning:"计划中",executing:"执行中",polishing:"完善中",retrying:"重试中",revising:"修订中",failed:"失败",done:"已完成"}[t.stage]||t.stage) : ""} · 负责人：${esc((t.assign||[]).join("、")||"待定")}${t.feedback && t.feedback.length ? " · 🔄 已修订 " + t.feedback.length + " 次" : ""}</div>
      <div class="section-title">任务描述</div>
      <div style="font-size:12px;white-space:pre-wrap;color:#6e5f50;margin-bottom:8px">${esc(t.desc||"(无描述)")}</div>`;
    // 子任务进度（任务拆解可视化）
    if (t.subtasks && t.subtasks.length) {
      body.appendChild(sec("子任务进度（" + t.subtasks.filter(s => s.done).length + "/" + t.subtasks.length + "）"));
      for (const st of t.subtasks) {
        const done = st.done, cur = t.currentSubtask === st.title;
        body.innerHTML += `<div style="display:flex;align-items:center;gap:6px;font-size:12px;padding:4px 6px;margin-bottom:4px;background:${done ? "#2a6a4f" : cur ? "#5a4020" : "#3a2a1a"};border:1px solid ${done ? "#5fbf8f" : "#1a120a"};border-radius:4px">
          <span>${done ? "✅" : cur ? "⏳" : "⬜"}</span>
          <span style="color:${done ? "#cfe8da" : "#ffe8a0"}">${esc(st.title)}</span>
        </div>`;
      }
    }
    body.innerHTML += `
      <div class="section-title">员工产出</div>
      <div style="font-size:12px;white-space:pre-wrap;color:#333;background:#f4f1ea;padding:8px;border-radius:4px;max-height:180px;overflow-y:auto;margin-bottom:8px">${esc(t.output||"(尚未产出)")}</div>
      <div class="section-title">工作区文件</div>
      <div id="ws-files" style="font-size:12px;color:#8a6f52;margin-bottom:8px">加载中…</div>
      <div class="section-title">老板反馈</div>
      <div id="fb-list" style="font-size:12px;color:#8a6f52;margin-bottom:6px">${renderFeedbackList(t.feedback)}</div>
      <div style="display:flex;gap:6px;align-items:stretch">
        <input id="fb-input" placeholder="给员工提反馈，员工会按反馈修订交付…" style="flex:1;background:#f4f1ea;color:#2f2b26;border:1px solid #c8b8a0;border-radius:4px;padding:6px;font-size:12px" autocomplete="off">
        <button class="btn blue" id="fb-send" style="flex-shrink:0">提交</button>
      </div>`;
    // 老板反馈提交：触发员工修订
    const fbBtn = $("fb-send");
    const fbInp = $("fb-input");
    if (fbBtn && fbInp) {
      fbBtn.addEventListener("click", async () => {
        const fb = fbInp.value.trim();
        if (!fb) { addPM("请先填写反馈内容。"); return; }
        fbBtn.disabled = true; fbBtn.textContent = "修订中…";
        try {
          await Bridge.sendFeedback(t.id, fb);
          addPM("收到！已把反馈转达员工「" + t.title + "」，员工将按你的要求修订并重新交付。");
          fbInp.value = "";
          await PM.syncFromBridge().catch(() => {});
          renderTaskDetail();
        } catch (e) { addPM("反馈提交失败：" + (e.message||"")); }
        fbBtn.disabled = false; fbBtn.textContent = "提交";
      });
    }
    // 异步加载工作区文件列表
    if (window.Bridge && Bridge.isConfigured() && t.workspace) {
      Bridge.listWorkspace(t.id).then(d => {
        const wf = $("ws-files");
        if (!wf) return;
        const files = d.files || [];
        if (!files.length) { wf.textContent = "（工作区暂无文件）"; return; }
        wf.innerHTML = "";
        for (const f of files) {
          if (f.dir) { wf.innerHTML += '<div style="color:#b0a080">📁 ' + esc(f.name) + "/</div>"; continue; }
          const row = document.createElement("div");
          row.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:6px;padding:4px 6px;margin-bottom:4px;background:#4a3520;border:1px solid #1a120a;border-radius:4px;cursor:pointer";
          row.innerHTML = '<span style="color:#cfe0ff;word-break:break-all">📄 ' + esc(f.name) + '</span><span style="color:#5fbf8f;font-size:11px;flex-shrink:0">查看</span>';
          row.addEventListener("click", () => viewWorkspaceFile(t.id, f.name));
          wf.appendChild(row);
        }
      }).catch(() => { const wf = $("ws-files"); if (wf) wf.textContent = "（加载失败）"; });
    } else {
      const wf = $("ws-files"); if (wf) wf.textContent = "（未连接或未分配工作区）";
    }
    const btn = document.createElement("button");
    btn.className = "btn " + (t.status === "done" ? "gray" : "green");
    btn.textContent = t.status === "done" ? "重新执行" : (t.status === "failed" ? "重试" : "立即执行");
    btn.addEventListener("click", async () => {
      try {
        await Bridge.dispatchTask(t.id); S.notify("已安排执行", t.title, { icon: "flag", type: "task" });
        closeAllPanels(); addPM("已安排执行「" + t.title + "」。"); await PM.syncFromBridge().catch(() => {});
      } catch (e) { addPM("执行失败：" + (e.message||"")); }
    });
    body.appendChild(btn);
  }

  // 渲染老板反馈历史列表
  function renderFeedbackList(fb) {
    if (!fb || !fb.length) return '<span style="color:#8a6f52">（暂无反馈）</span>';
    return fb.map(f => '<div style="background:#4a3520;border:1px solid #1a120a;border-radius:4px;padding:6px;margin-bottom:4px">' +
      '<div style="font-size:10px;color:#b0a080;margin-bottom:2px">老板 · ' + new Date(f.at||Date.now()).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}) + '</div>' +
      '<div style="color:#ffe8a0">' + esc(f.text) + '</div></div>').join("");
  }

  // 查看工作区文件内容
  async function viewWorkspaceFile(id, name) {
    const body = $("panel-taskdetail").querySelector(".panel-body");
    const t = S.get().tasks.find(x => x.id === id);
    if (!t) return;
    body.innerHTML = "";
    body.appendChild(sec("📄 " + name));
    body.innerHTML += '<div style="font-size:12px;color:#8a6f52;margin-bottom:8px">' + esc(t.title) + " · " + esc(name) + "</div>";
    body.innerHTML += '<div style="font-size:12px;color:#8a6f52" id="ws-file-loading">加载中…</div>';
    try {
      const d = await Bridge.readWorkspaceFile(id, name);
      const pre = document.createElement("pre");
      pre.style.cssText = "font-size:11px;white-space:pre-wrap;word-break:break-all;color:#333;background:#f4f1ea;padding:10px;border-radius:4px;max-height:340px;overflow-y:auto;line-height:1.5";
      pre.textContent = d.content || "(空文件)";
      body.querySelector("#ws-file-loading").replaceWith(pre);
      if (d.truncated) body.innerHTML += '<div style="font-size:11px;color:#e06c5a;margin-top:6px">⚠ 文件较大，已截断显示</div>';
    } catch (e) {
      const ld = $("ws-file-loading"); if (ld) ld.textContent = "读取失败：" + (e.message||"");
    }
    const back = document.createElement("button");
    back.className = "btn gray"; back.textContent = "← 返回任务详情";
    back.style.cssText = "margin-top:12px;width:100%";
    back.addEventListener("click", renderTaskDetail);
    body.appendChild(back);
  }

  function renderNotif() {
    const Ss = S.get();
    const body = $("panel-notif").querySelector(".panel-body");
    if (!Ss.notifications.length) { body.innerHTML = '<div class="notif-empty">暂无通知</div>'; return; }
    body.innerHTML = "";
    // 清空按钮
    const clearBtn = document.createElement("button");
    clearBtn.className = "btn gray";
    clearBtn.textContent = "🗑 清空全部（" + Ss.notifications.length + "）";
    clearBtn.style.cssText = "width:100%;margin-bottom:8px";
    clearBtn.addEventListener("click", () => { if (confirm("清空全部通知？")) { S.get().notifications = []; S.save(); S.emit(); renderNotif(); } });
    body.appendChild(clearBtn);
    for (const n of Ss.notifications) {
      const item = document.createElement("div");
      item.className = "notif-item" + (n.read ? "" : " unread");
      item.innerHTML = '<div class="nt"><div class="t"></div><div class="b"></div><div class="tm"></div></div>';
      item.querySelector(".t").textContent = n.title;
      item.querySelector(".b").textContent = n.body;
      item.querySelector(".tm").textContent = new Date(n.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      item.addEventListener("click", () => { n.read = true; S.emit(); if (n.taskId) { closeAllPanels(); openPanel("tasks"); setTimeout(() => openTaskDetail(n.taskId), 80); } else { renderNotif(); } });
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
  // 复制文本（WebView 兼容：优先 Clipboard API，回退 textarea+execCommand）
  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand && document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }

  return { init, startBoot, openPanel, closeAllPanels, showToast, sendChat, addPM, addSys, addBoss, renderHUD, openTaskNew, openTaskDetail, onEmpClick, renderProjects, renderDashboard, renderEconomy, renderStats, renderWeeklyReport, renderPmSuggest, renderTaskTemplates, renderAchievements, renderArchived, flowShow, flowHide, flowStep, flowReset, refreshFunds, refreshCompany, claimDaily, checkAchievements };
})();
