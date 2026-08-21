// 核心引擎 —— DSH 任务编排版
// 只负责：办公室场景渲染 + 真实员工（agent）站位展示 + 状态轮询
window.Game = (function () {
  const S = GState, Sp = Sprites, PAL = window.PAL;
  let canvas, g, W = 0, H = 0, scale = 2;
  let lastT = 0;
  let raf = null, running = false;
  let selEmp = null;
  let mouse = { x: -1, y: -1 };
  let particles = [];
  let talking = [];

  const ROOM = { w: 390, h: 220 };
  const STATION_W = 58, STATION_H = 66;

  function stationPos(i) {
    const n = Math.max(1, S.get().employees.length);
    const cols = Math.min(5, Math.max(2, Math.floor(ROOM.w / (STATION_W + 6))));
    const col = i % cols, row = Math.floor(i / cols);
    const startX = 36;
    const x = startX + col * (STATION_W + 6) + STATION_W / 2;
    const y = 118 + row * (STATION_H + 10);
    return { x, y };
  }

  function init(cv) {
    canvas = cv;
    g = canvas.getContext("2d");
    g.imageSmoothingEnabled = false;
    resize();
    window.addEventListener("resize", resize);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", () => { mouse.x = -1; });
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const t = e.touches[0];
      const r = canvas.getBoundingClientRect();
      mouse.x = (t.clientX - r.left) / scale;
      mouse.y = (t.clientY - r.top) / scale;
      onClick(e);
    }, { passive: false });
    start();
  }

  function resize() {
    const pr = window.devicePixelRatio || 1;
    const cw = canvas.parentElement ? canvas.parentElement.clientWidth : canvas.clientWidth;
    const ch = canvas.parentElement ? canvas.parentElement.clientHeight : canvas.clientHeight;
    W = cw; H = ch;
    canvas.width = W * pr; canvas.height = H * pr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    g.setTransform(pr * scale, 0, 0, pr * scale, 0, 0);
    ROOM.w = W / scale;
    ROOM.h = H / scale;
  }

  function start() {
    if (running) return;
    running = true;
    lastT = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function loop(t) {
    const dt = Math.min(0.1, (t - lastT) / 1000);
    lastT = t;
    update(dt);
    render();
    raf = requestAnimationFrame(loop);
  }

  // ---------- 更新（动画） ----------
  function update(dt) {
    for (const p of particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    particles = particles.filter(p => p.life > 0);
    talking = talking.filter(t => t.until > performance.now());
  }

  function spawnBurst(pos) {
    for (let i = 0; i < 6; i++) {
      particles.push({
        x: pos.x + 8, y: pos.y - 6, vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 20,
        life: 0.6, col: Math.random() < 0.5 ? "#e8a33d" : "#f2e08a",
      });
    }
  }

  // 员工角色 → 精灵类型映射（旧引擎按 typeId 画，这里把 role 映射过去）
  function roleToType(role) {
    return { dev: "dev", art: "art", qa: "qa", ops: "ops", pm: "pm" }[role] || "dev";
  }

  // 角色配色（给 makeCharacter）
  function roleColors(role) {
    return {
      dev: { shirt: "#3d8b6f", pants: "#3a4450", hair: "#2e2a32", skin: "#f2b58a", eye: "#2e2a32" },
      art: { shirt: "#d97a9c", pants: "#5a4a6a", hair: "#7a4a6a", skin: "#ffdcb4", eye: "#7a5fa0" },
      qa: { shirt: "#e8a33d", pants: "#4a5560", hair: "#5a3a22", skin: "#f2b58a", eye: "#2e2a32" },
      ops: { shirt: "#7a5fa0", pants: "#4a5560", hair: "#2e2a32", skin: "#ffdcb4", eye: "#d97a9c" },
      pm: { shirt: "#3f6fae", pants: "#4a5560", hair: "#3a2a3a", skin: "#ffdcb4", eye: "#3f6fae" },
    }[role] || { shirt: "#3d8b6f", pants: "#3a4450", hair: "#2e2a32", skin: "#f2b58a", eye: "#2e2a32" };
  }

  // ---------- 渲染 ----------
  function render() {
    g.clearRect(0, 0, ROOM.w, ROOM.h);
    drawRoom();
    for (const p of particles) {
      g.globalAlpha = Math.min(1, p.life * 2);
      g.fillStyle = p.col;
      g.fillRect(p.x, p.y, 3, 3);
    }
    g.globalAlpha = 1;
    drawEmployees();
    for (const tb of talking) {
      const emps = S.get().employees;
      const idx = emps.findIndex(e => e.id === (tb.emp && tb.emp.id));
      if (idx < 0) continue;
      const st = stationPos(idx);
      drawBubble(st.x, st.y - 46, tb.text);
    }
  }

  function drawRoom() {
    const w = ROOM.w, h = ROOM.h;
    // 墙
    g.fillStyle = PAL.wall || "#d8c9a8";
    g.fillRect(0, 0, w, 42);
    // 墙纸装饰线
    g.fillStyle = "rgba(0,0,0,0.05)";
    for (let x = 0; x < w; x += 24) g.fillRect(x, 6, 12, 30);
    // 踢脚线
    g.fillStyle = "#c8b8a0"; g.fillRect(0, 42, w, 3);
    // 地板
    g.fillStyle = PAL.floor1 || "#e8d9b8"; g.fillRect(0, 45, w, h - 45);
    for (let x = 0; x < w; x += 18) { g.fillStyle = PAL.floor2 || "#dcc9a0"; g.fillRect(x, 45, 9, h - 45); }
    g.fillStyle = PAL.floorLine || "#c8b088";
    for (let y = 45; y < h; y += 18) g.fillRect(0, y, w, 1);
    for (let x = 0; x < w; x += 18) g.fillRect(x, 45, 1, h - 45);

    // 窗户
    const win = Sp.makeWindow(false);
    const winX = Math.max(8, w - 58);
    g.drawImage(win, winX, 5, 48, 34);
    g.fillStyle = "#d97a9c";
    g.fillRect(winX - 2, 5, 3, 34);
    g.fillRect(winX + 47, 5, 3, 34);
    // 门
    const door = Sp.makeDoor(false);
    g.drawImage(door, 6, 45, 26, 40);
    // 标题挂画
    g.fillStyle = "#4a3728"; g.fillRect(46, 6, 64, 20);
    g.fillStyle = "#f2e6cf"; g.fillRect(48, 8, 60, 16);
    g.fillStyle = "#d94f2b"; g.fillRect(48, 8, 60, 5);
    // 公告板
    const board = Sp.makeBoard();
    g.drawImage(board, 122, 5, 34, 26);
    // 植物
    const plant = Sp.makePlant();
    g.drawImage(plant, w - 16, 48, 18, 24);
  }

  function drawEmployees() {
    const emps = S.get().employees;
    const now = performance.now();
    emps.forEach((emp, i) => {
      const st = stationPos(i);
      const chr = Sp.makeCharacter(roleColors(emp.role));
      const busy = emp.status === "working" || emp.status === "running";
      // 忙碌动画：轻微上下浮动（工作中的员工有节奏感）
      const bob = busy ? Math.sin(now / 300 + i * 1.5) * 2 : 0;
      const img = chr.idle;
      g.drawImage(img, st.x - 8, st.y - 38 + bob, 16, 20);
      // 工位桌
      g.fillStyle = "#8a6a42"; g.fillRect(st.x - 18, st.y + 4, 36, 6);
      // 名字
      const nm = emp.name || emp.label || "员工";
      g.font = "7px 'MisekiBitmap', monospace";
      g.textAlign = "center";
      g.fillStyle = "#fff";
      g.strokeStyle = "#000";
      g.lineWidth = 2;
      g.strokeText(nm.length > 4 ? nm.slice(0, 4) : nm, st.x, st.y + 18);
      g.fillText(nm.length > 4 ? nm.slice(0, 4) : nm, st.x, st.y + 18);
      // 状态点（工作中的员工显示闪烁的忙碌指示灯）
      g.fillStyle = busy ? "#3d8b6f" : "#c8b8a0";
      g.fillRect(st.x - 18, st.y - 42, 8, 3);
      if (busy) {
        // 闪烁指示
        g.fillStyle = Math.sin(now / 200) > 0 ? "#5fbf8f" : "#2a6a4f";
        g.fillRect(st.x - 18, st.y - 42, 8, 3);
      } else {
        g.fillStyle = "#999";
        g.fillRect(st.x - 18, st.y - 42, 3, 3);
      }
      // 工作中的员工头顶小气泡（省略号）
      if (busy) {
        g.fillStyle = "rgba(255,255,255,0.9)";
        g.beginPath(); g.arc(st.x, st.y - 46, 3, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#222";
        g.font = "6px sans-serif";
        g.fillText("···", st.x, st.y - 45);
        // 显示当前执行任务标题（流程可视化：一眼看到员工在做什么）
        const curTask = currentTaskFor(emp.name);
        if (curTask) {
          const label = "「" + (curTask.title.length > 8 ? curTask.title.slice(0, 8) + "…" : curTask.title) + "」";
          g.font = "7px 'MisekiBitmap', monospace";
          const tw = g.measureText(label).width;
          const bx = st.x - tw / 2 - 3, by = st.y - 54;
          g.fillStyle = "rgba(43,32,20,0.92)";
          g.fillRect(bx, by, tw + 6, 11);
          g.strokeStyle = "#f2d04a"; g.lineWidth = 1;
          g.strokeRect(bx + 0.5, by + 0.5, tw + 5, 10);
          g.fillStyle = "#ffe8a0"; g.textAlign = "center";
          g.fillText(label, st.x, by + 8);
        }
      }
    });
  }

  // 找到该员工正在执行的任务（doing/planning 且 assign 含该员工）
  function currentTaskFor(empName) {
    const Ss = S.get();
    const active = (Ss.tasks || []).filter(t => t.status === "doing" || t.status === "todo");
    for (const t of active) {
      if ((t.assign || []).some(n => n === empName)) return t;
    }
    return null;
  }

  function drawBubble(x, y, text) {
    g.font = "8px 'MisekiBitmap', monospace";
    const w = Math.min(120, g.measureText(text).width + 12);
    g.fillStyle = "rgba(255,255,255,0.95)";
    g.strokeStyle = "#333"; g.lineWidth = 1;
    g.beginPath(); g.roundRect(x - w / 2, y - 16, w, 20, 3); g.fill(); g.stroke();
    g.fillStyle = "#222"; g.textAlign = "center";
    g.fillText(text, x, y);
  }

  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / scale;
    mouse.y = (e.clientY - r.top) / scale;
  }

  function onClick(e) {
    const emps = S.get().employees;
    emps.forEach((emp, i) => {
      const st = stationPos(i);
      if (mouse.x > st.x - 20 && mouse.x < st.x + 20 && mouse.y > st.y - 46 && mouse.y < st.y + 10) {
        selEmp = emp;
        window.GameEvents && window.GameEvents.onEmpClick(emp);
      }
    });
  }

  return {
    init, start, spawnBurst, stationPos, roleToType,
    _showBubble(emp, text) {
      talking.push({ emp, text, until: performance.now() + 2500 });
    },
  };
})();
