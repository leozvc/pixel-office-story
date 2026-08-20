// 核心引擎 —— 模拟 + 办公室场景渲染 + 交互
window.Game = (function () {
  const S = GState, Sp = Sprites, PAL = window.PAL;
  let canvas, g, W = 0, H = 0, scale = 2;
  let lastT = 0, acc = 0;
  let raf = null, running = false;
  let selEmp = null; // 点击选中的员工
  let mouse = { x: -1, y: -1 };
  let walkers = []; // 走动动画 {x,y,tx,ty,frame,emp}
  let particles = [];
  let talking = []; // 气泡 {emp, text, until}

  // 场景布局（逻辑坐标，自适应）
  const ROOM = { w: 390, h: 220 };
  const STATION_W = 58, STATION_H = 66;

  // 计算工位位置（根据房间宽度自适应）
  function stationPos(i) {
    const n = Math.max(1, S.get().employees.length);
    const cols = Math.min(5, Math.max(2, Math.floor(ROOM.w / (STATION_W + 6))));
    const col = i % cols, row = Math.floor(i / cols);
    const startX = 36;
    const totalW = cols * (STATION_W + 6) - 6;
    const x = startX + col * (STATION_W + 6) + STATION_W / 2;
    const y = 118 + row * (STATION_H + 10);
    return { x, y };
  }

  // ---------- 初始化 ----------
  function init(cv) {
    canvas = cv;
    g = canvas.getContext("2d");
    g.imageSmoothingEnabled = false;
    resize();
    window.addEventListener("resize", resize);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", () => { mouse.x = -1; });
    canvas.addEventListener("click", onClick);
    // 触摸
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
    acc += dt;
    if (acc >= 6) { // 每6秒模拟一次（工作量 tick）
      acc = 0;
      sim();
    }
    update(dt);
    render();
    raf = requestAnimationFrame(loop);
  }

  // ---------- 模拟 ----------
  function sim() {
    const Ss = S.get();
    const upg = Ss.upg;
    const speedBonus = 1 + (upg.desk || 0) * 0.10 + (upg.network || 0) * 0.05;
    const emps = Ss.employees;
    for (const task of Ss.tasks) {
      const emp = emps.find(e => e.id === task.empId);
      if (!emp) continue;
      if (emp.mood < 30) continue; // 心情太差罢工
      const spd = 1.0 * emp.stats.speed * speedBonus * (0.6 + emp.mood / 160);
      task.done = Math.min(task.total, task.done + spd);
    }
    const doneTasks = Ss.tasks.filter(t => t.done >= t.total);
    for (const t of doneTasks) finishTask(t);
    Ss.tasks = Ss.tasks.filter(t => t.done < t.total);
    checkProjects();
    const decor = upg.decor || 0;
    for (const e of emps) {
      if (Math.random() < 0.02) {
        e.mood = Math.max(10, Math.min(100, e.mood - 1 + Math.random() * 2 + decor * 0.3));
      }
    }
    S.emit();
  }

  function finishTask(t) {
    const Ss = S.get();
    const proj = Ss.projects.find(p => p.id === t.projectId);
    if (proj) {
      proj.progress[t.typeId] = (proj.progress[t.typeId] || 0) + t.total;
      const st = stationPos(Ss.employees.findIndex(e => e.id === t.empId));
      spawnBurst({ x: st.x, y: st.y });
    }
    const emp = Ss.employees.find(e => e.id === t.empId);
    if (emp) {
      emp.exp = (emp.exp || 0) + 5;
      if (emp.exp >= 100) { emp.exp -= 100; emp.level = (emp.level || 1) + 1; }
    }
  }

  function checkProjects() {
    const Ss = S.get();
    for (const p of Ss.projects) {
      if (p.status !== "active") continue;
      const allDone = p.required.every(t => (p.progress[t] || 0) >= p.hours[t]);
      if (allDone) {
        p.status = "done";
        const rating = qualityRating(p);
        let reward = Math.round(p.reward * (1 + (rating - 3) * 0.15));
        S.addMoney(reward);
        const rep = p.difficulty * (rating >= 3 ? 2 : 1);
        S.addRep(rep);
        const arch = { name: p.name, reward, day: Ss.day, date: new Date(), rating, flavor: p.flavor, client: p.client, difficulty: p.difficulty };
        Ss.archive.unshift(arch);
        Ss.stats.projectsDone += 1;
        const ratingStars = "★".repeat(rating) + "☆".repeat(5 - rating);
        const n = S.notify("项目完成！", `${p.name} 完成！评价 ${ratingStars} 收入 ¥${reward}`, { icon: "star", type: "complete", important: true, projectId: p.id });
        window.GameEvents && GameEvents.onProjectDone(p, arch, n);
      }
    }
    Ss.projects = Ss.projects.filter(p => p.status !== "done");
  }

  function qualityRating(p) {
    let quality = 0;
    for (const t of p.required) {
      const hours = p.hours[t];
      const done = p.progress[t] || 0;
      quality += Math.min(1, done / hours);
    }
    quality = quality / p.required.length;
    const Ss = S.get();
    let moodSum = 0, cnt = 0;
    for (const t of p.required) {
      const task = Ss.tasks.find(tt => tt.projectId === p.id && tt.typeId === t);
      if (task) { const e = Ss.employees.find(ee => ee.id === task.empId); if (e) { moodSum += e.mood; cnt++; } }
    }
    const mood = cnt ? moodSum / cnt : 80;
    let score = quality * 100 * 0.7 + (mood / 100) * 30;
    let rating = Math.max(1, Math.min(5, Math.round(score / 20)));
    if (p.difficulty <= 1 && rating < 4) rating = 4;
    return rating;
  }

  // ---------- 更新（动画） ----------
  function update(dt) {
    for (const wk of walkers) {
      const dx = wk.tx - wk.x, dy = wk.ty - wk.y;
      const d = Math.hypot(dx, dy);
      if (d < 1.5) { wk.x = wk.tx; wk.y = wk.ty; wk.done = true; }
      else { const sp = 30 * dt; wk.x += (dx / d) * sp; wk.y += (dy / d) * sp; wk.frame += dt * 6; }
    }
    walkers = walkers.filter(w => !w.done);
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
    for (const wk of walkers) drawEmp(wk.emp, wk.x, wk.y, wk.frame);
    for (const tb of talking) {
      const idx = S.get().employees.indexOf(tb.emp);
      if (idx < 0) continue;
      const st = stationPos(idx);
      drawBubble(st.x, st.y - 46, tb.text);
    }
    if (selEmp) {
      const idx = S.get().employees.indexOf(selEmp);
      if (idx >= 0) {
        const st = stationPos(idx);
        g.strokeStyle = "#e8a33d";
        g.lineWidth = 1;
        g.strokeRect(st.x - 20, st.y - 46, 40, 48);
      }
    }
  }

  function drawRoom() {
    const w = ROOM.w, h = ROOM.h;
    const isDay = S.get().clock < 18 * 60;
    // 墙
    g.fillStyle = isDay ? PAL.wall : "#b8a888";
    g.fillRect(0, 0, w, 42);
    // 墙纸装饰线
    g.fillStyle = "rgba(0,0,0,0.05)";
    for (let x = 0; x < w; x += 24) g.fillRect(x, 6, 12, 30);
    // 踢脚线
    g.fillStyle = "#c8b8a0"; g.fillRect(0, 42, w, 3);
    // 地板
    g.fillStyle = PAL.floor1; g.fillRect(0, 45, w, h - 45);
    // 地板砖
    for (let x = 0; x < w; x += 18) { g.fillStyle = PAL.floor2; g.fillRect(x, 45, 9, h - 45); }
    g.fillStyle = PAL.floorLine;
    for (let y = 45; y < h; y += 18) g.fillRect(0, y, w, 1);
    for (let x = 0; x < w; x += 18) g.fillRect(x, 45, 1, h - 45);

    // 窗户（左上，窗外城市/夜空）
    const win = Sp.makeWindow(isDay);
    const winX = Math.max(8, w - 58);
    g.drawImage(win, winX, 5, 48, 34);
    // 窗帘
    g.fillStyle = "#d97a9c";
    g.fillRect(winX - 2, 5, 3, 34);
    g.fillRect(winX + 47, 5, 3, 34);

    // 门（左下）
    const door = Sp.makeDoor(false);
    g.drawImage(door, 6, 45, 26, 40);

    // 标题挂画
    g.fillStyle = "#4a3728"; g.fillRect(46, 6, 64, 20);
    g.fillStyle = "#f2e6cf"; g.fillRect(48, 8, 60, 16);
    g.fillStyle = "#d94f2b"; g.fillRect(48, 8, 60, 5);

    // 公告板
    const board = Sp.makeBoard();
    g.drawImage(board, 122, 5, 34, 26);

    // 植物（右中）
    const plant = Sp.makePlant();
    g.drawImage(plant, w - 16, 48, 18, 24);

    // 文件柜（右侧）
    const cab = Sp.makeCabinet();
    g.drawImage(cab, w - 42, 58, 20, 26);

    // 工位
    const Ss = S.get();
    const n = Ss.employees.length;
    for (let i = 0; i < n; i++) {
      const st = stationPos(i);
      drawStation(st, i);
    }
    // 空位（装饰）
    for (let i = n; i < 5; i++) {
      const st = stationPos(i);
      drawEmptyStation(st);
    }
  }

  function drawStation(st, idx) {
    // 隔板
    g.fillStyle = "#cfc0a0"; g.fillRect(st.x - 26, st.y - 44, 52, 50);
    g.fillStyle = "#b8a888"; g.fillRect(st.x - 26, st.y - 6, 52, 3);
    // 桌子
    const desk = Sp.makeDesk();
    g.drawImage(desk, st.x - 20, st.y - 14, 40, 24);
    // 椅子
    const chair = Sp.makeChair(idx % 2 ? "#7a4a6a" : "#5a6a8a");
    g.drawImage(chair, st.x + 16, st.y - 22, 18, 20);
    // 小台灯/屏风灯
    g.fillStyle = "#8a6f52"; g.fillRect(st.x - 24, st.y - 30, 2, 12);
    g.fillStyle = "#e8a33d"; g.fillRect(st.x - 25, st.y - 32, 4, 3);
  }

  function drawEmptyStation(st) {
    g.fillStyle = "#cfc0a0"; g.fillRect(st.x - 26, st.y - 44, 52, 50);
    g.fillStyle = "#b8a888"; g.fillRect(st.x - 26, st.y - 6, 52, 3);
    const desk = Sp.makeDesk();
    g.drawImage(desk, st.x - 20, st.y - 14, 40, 24);
    const chair = Sp.makeChair("#8a8a8a");
    g.drawImage(chair, st.x + 16, st.y - 22, 18, 20);
    g.globalAlpha = 0.6;
    g.fillStyle = "#8a7a68"; g.fillRect(st.x - 24, st.y - 32, 4, 3);
    g.globalAlpha = 1;
  }

  function drawEmployees() {
    const Ss = S.get();
    for (let i = 0; i < Ss.employees.length; i++) {
      const emp = Ss.employees[i];
      const st = stationPos(i);
      const busy = Ss.tasks.some(t => t.empId === emp.id);
      // 忙碌时坐在桌前（角色在桌后，只露上半身）
      const x = busy ? st.x + 2 : st.x + 6;
      const y = busy ? st.y - 12 : st.y - 16;
      // 忙碌时上下轻微"敲键盘"抖动
      const anim = busy ? Math.floor(performance.now() / 350) : 0;
      drawEmp(emp, x, y, anim);
      drawStatus(emp, st.x, st.y - 48);
    }
  }

  function drawEmp(emp, x, y, frame) {
    const type = GD.EMP_TYPES.find(t => t.id === emp.typeId);
    const colors = {
      hair: emp.hair || (type && type.hair) || "#2e2a32",
      skin: emp.skin || (type && type.skin) || "#ffdcb4",
      shirt: emp.shirt || (type && type.shirt) || "#3f6fae",
      tie: emp.tie !== undefined ? emp.tie : (type && type.tie),
      pants: emp.pants || (type && type.pants) || "#4a5560",
      shoes: emp.shoes || "#2e2a32",
      eye: emp.eye || (type && type.eye) || "#2e2a32",
      mouth: "#b0543a",
    };
    const sp = Sp.makeCharacter(colors);
    const spr = (frame % 3 === 0) ? sp.idle : (frame % 3 === 1 ? sp.walk0 : sp.walk1);
    const bob = Math.sin(performance.now() / 400 + (emp.id ? emp.id.length : 1)) * 0.8;
    g.drawImage(spr, Math.round(x - 8), Math.round(y - 20 + bob), 16, 20);
    if (emp.typeId === "pm") {
      g.fillStyle = "#e8a33d";
      g.fillRect(x - 8, y - 24, 3, 3);
      g.fillRect(x - 7, y - 25, 1, 1);
    }
  }

  function drawStatus(emp, x, y) {
    const Ss = S.get();
    const busy = Ss.tasks.some(t => t.empId === emp.id);
    // 名字条
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.fillRect(x - 16, y - 12, 32, 10);
    g.strokeStyle = "#8a6f52"; g.lineWidth = 1;
    g.strokeRect(x - 16, y - 12, 32, 10);
    g.fillStyle = "#4a3728";
    g.font = "6px monospace";
    g.fillText(emp.name.slice(0, 2), x - 13, y - 4);
    // 心情
    let moodChar = "☺", moodCol = "#3d8b6f";
    if (emp.mood < 40) { moodChar = "☹"; moodCol = "#c33c3c"; }
    else if (emp.mood < 70) { moodChar = "🙂"; moodCol = "#e8a33d"; }
    g.fillStyle = moodCol;
    g.font = "7px monospace";
    g.fillText(moodChar, x + 4, y - 4);
    // 忙碌标志
    if (busy) {
      g.fillStyle = "#3f6fae";
      g.fillRect(x + 13, y - 10, 7, 6);
      g.fillStyle = "#cfe9f8";
      g.fillRect(x + 14, y - 9, 5, 4);
    }
    // 等级
    if (emp.level > 1) {
      g.fillStyle = "#e8a33d";
      g.fillText("Lv" + emp.level, x - 13, y + 6);
    }
  }

  function drawBubble(x, y, text) {
    const w = Math.min(90, text.length * 6 + 10);
    g.fillStyle = "#ffffff";
    g.strokeStyle = "#4a3728";
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(x - w / 2, y - 14, w, 16, 2);
    g.fill(); g.stroke();
    g.fillStyle = "#3b2b20";
    g.font = "6px monospace";
    const clipped = text.length > 14 ? text.slice(0, 14) + "…" : text;
    g.fillText(clipped, x - w / 2 + 4, y - 3);
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(x, y + 2); g.lineTo(x - 3, y + 7); g.lineTo(x + 3, y + 7);
    g.fill();
  }

  // ---------- 交互 ----------
  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / scale;
    mouse.y = (e.clientY - r.top) / scale;
  }

  function onClick() {
    const Ss = S.get();
    for (let i = 0; i < Ss.employees.length; i++) {
      const st = stationPos(i);
      if (mouse.x > st.x - 26 && mouse.x < st.x + 26 && mouse.y > st.y - 50 && mouse.y < st.y + 5) {
        selEmp = Ss.employees[i];
        window.GameEvents && GameEvents.onEmpClick(selEmp);
        SFX.play("select");
        return;
      }
    }
    selEmp = null;
  }

  // 对外接口
  return {
    init, start, resize,
    spawnBurst,
    _sim: sim,
    showBubble(emp, text, dur) {
      talking = talking.filter(t => t.emp !== emp);
      talking.push({ emp, text, until: performance.now() + (dur || 2000) });
    },
  };
})();
