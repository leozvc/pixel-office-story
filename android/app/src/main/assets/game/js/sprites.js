// 像素画生成器 —— 全部用 canvas 程序化绘制，无需外部图片
(function () {
  const S = 1; // 基础像素尺寸（后续 draw 时 scale）

  function cv(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    return c;
  }

  // 16x20 人物模板。grid 行: 0=透明
  // 字符: H=发, F=脸, E=眼, M=嘴, S=衬衫, T=领带, P=裤, L=腿, K=鞋, B=背包带, A=手
  const BODY = [
    "......HHHH......",
    ".....HHHHHH.....",
    ".....HHHHHH.....",
    ".....HHHHHH.....",
    "......HHHH......",
    "......FFFF......",
    ".....FFEFFE.....",
    ".....FFFFFF.....",
    "......FFFF......",
    "....SSSSSSSS....",
    "...SSSSSSSSSS...",
    "...SSSTTTSSS....",
    "...SSSTTTSSS....",
    "...SSSSSSSSS....",
    "....PPPPPPPP....",
    "....PPPPPPPP....",
    "...PPPPPPPPPP...",
    "...LL......LL...",
    "...LL......LL...",
    "..KKK......KKK..",
  ];

  const HAIR_BACK = [
    "......HHHH......",
    ".....HHHHHH.....",
    ".....HHHHHH.....",
    ".....HHHHHH.....",
    "......HHHH......",
    "......FFFF......",
    ".....FFFFFF.....",
    ".....FFFFFF.....",
    ".....FFFFFF.....",
    "....SSSSSSSS....",
    "...SSSSSSSSSS...",
    "...SSSSSSSSSS...",
    "...SSSSSSSSSS...",
    "...SSSSSSSSS....",
    "....PPPPPPPP....",
    "....PPPPPPPP....",
    "...PPPPPPPPPP...",
    "...LL......LL...",
    "...LL......LL...",
    "..KKK......KKK..",
  ];

  // 行走帧（腿交替）
  const LEG_FRAME_A = 19, LEG_FRAME_B = 18;

  function charCanvas(grid, colors, frameLegs) {
    const c = cv(16, 20);
    const g = c.getContext("2d");
    const rows = frameLegs ? grid.map((r, i) => {
      if (i === 18 && frameLegs[0]) return frameLegs[0](r);
      if (i === 19 && frameLegs[1]) return frameLegs[1](r);
      return r;
    }) : grid;
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        let col = null;
        if (ch === "H") col = colors.hair;
        else if (ch === "F") col = colors.skin;
        else if (ch === "E") col = colors.eye || "#2e2a32";
        else if (ch === "M") col = colors.mouth || "#b0543a";
        else if (ch === "S") col = colors.shirt;
        else if (ch === "T") col = colors.tie || "#c33c3c";
        else if (ch === "P") col = colors.pants;
        else if (ch === "L") col = colors.pants;
        else if (ch === "K") col = colors.shoes;
        else if (ch === "A") col = colors.shirt;
        if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
      }
    }
    return c;
  }

  // 腿帧修改器
  const legsIdle = null;
  const legsWalk1 = [
    r => r.slice(0, 16) + "LL....LL....LL".slice(0, 16),
    r => r.slice(0, 16) + "LL....LL....LL".slice(0, 16),
  ];
  // 简化：行走 = 整体上下轻微位移 + 腿前移，用两个不同画布
  function legsFrame(grid, mode) {
    if (mode === 0) return grid.map((r, i) => (i === 18 || i === 19) ? r.slice(0, 4) + "LL" + r.slice(6, 10) + "LL" + r.slice(12) : r);
    if (mode === 1) return grid.map((r, i) => (i === 18 || i === 19) ? r.slice(0, 3) + ".LL" + r.slice(6, 9) + ".LL" + r.slice(12) : r);
    return grid;
  }

  function makeCharacter(colors) {
    const base = colors.back ? HAIR_BACK : BODY;
    return {
      idle: charCanvas(base, colors),
      walk0: charCanvas(legsFrame(base, 0), colors),
      walk1: charCanvas(legsFrame(base, 1), colors),
      w: 16, h: 20,
    };
  }

  // ------- 办公道具 -------
  // 办公桌 40x24
  function makeDesk() {
    const c = cv(40, 24); const g = c.getContext("2d");
    // 桌面
    g.fillStyle = "#9a6a3a"; g.fillRect(1, 6, 38, 8);
    g.fillStyle = "#b0783f"; g.fillRect(0, 5, 40, 3);
    g.fillStyle = "#7c5230"; g.fillRect(0, 12, 40, 2);
    // 腿
    g.fillStyle = "#6e4526"; g.fillRect(3, 14, 4, 10); g.fillRect(33, 14, 4, 10);
    // 显示器
    g.fillStyle = "#2e2a3a"; g.fillRect(10, 0, 18, 13);
    g.fillStyle = "#55c9a3"; g.fillRect(12, 2, 14, 8);
    g.fillStyle = "#9fe8cf"; g.fillRect(13, 3, 4, 2);
    g.fillStyle = "#2e2a3a"; g.fillRect(17, 13, 4, 2);
    g.fillStyle = "#2e2a3a"; g.fillRect(8, 14, 4, 1);
    // 键盘
    g.fillStyle = "#3a3a44"; g.fillRect(4, 19, 16, 3);
    return c;
  }

  // 椅子 20x22（面向桌）
  function makeChair(color) {
    const c = cv(20, 22); const g = c.getContext("2d");
    const col = color || "#7a4a6a";
    g.fillStyle = col; g.fillRect(5, 8, 10, 8);
    g.fillStyle = shade(col, 0.8); g.fillRect(5, 16, 10, 2);
    g.fillStyle = col; g.fillRect(6, 18, 2, 4); g.fillRect(12, 18, 2, 4);
    g.fillStyle = shade(col, 1.15); g.fillRect(4, 6, 12, 3);
    return c;
  }

  // 盆栽 20x26
  function makePlant() {
    const c = cv(20, 26); const g = c.getContext("2d");
    g.fillStyle = "#7a5230"; g.fillRect(5, 18, 10, 8);
    g.fillStyle = "#5a3a20"; g.fillRect(4, 20, 12, 2);
    // 叶子
    g.fillStyle = "#3f8a3f"; g.fillRect(9, 8, 2, 10);
    g.fillStyle = "#4fae4f"; g.fillRect(4, 6, 3, 8); g.fillRect(13, 4, 3, 10); g.fillRect(8, 3, 3, 8);
    g.fillStyle = "#2f6b2f"; g.fillRect(3, 14, 2, 3); g.fillRect(15, 13, 2, 3);
    return c;
  }

  // 文件柜 24x30
  function makeCabinet() {
    const c = cv(24, 30); const g = c.getContext("2d");
    g.fillStyle = "#8a7a68"; g.fillRect(2, 2, 20, 26);
    g.fillStyle = "#a09280"; g.fillRect(2, 2, 20, 3);
    for (let i = 0; i < 3; i++) {
      g.fillStyle = "#6e5f50"; g.fillRect(2, 8 + i * 7, 20, 1);
      g.fillStyle = "#d8c9a3"; g.fillRect(9, 5 + i * 7, 3, 1);
    }
    g.fillStyle = "#5a4a3a"; g.fillRect(11, 26, 2, 3);
    return c;
  }

  // 公告板 36x28
  function makeBoard() {
    const c = cv(36, 28); const g = c.getContext("2d");
    g.fillStyle = "#8a5a33"; g.fillRect(0, 2, 36, 26);
    g.fillStyle = "#c89a5a"; g.fillRect(2, 4, 32, 22);
    // 纸张
    const papers = [[5, 6, "#f7f1e3"], [13, 8, "#f2e08a"], [21, 5, "#e8c8c8"], [8, 15, "#cfe9f8"], [18, 16, "#e8e0c8"], [26, 13, "#f7e3d0"]];
    for (const [x, y, col] of papers) { g.fillStyle = col; g.fillRect(x, y, 8, 9); g.fillStyle = "#c0b0a0"; g.fillRect(x + 1, y + 1, 6, 7); }
    // 图钉
    g.fillStyle = "#c33c3c"; g.fillRect(7, 5, 2, 2); g.fillRect(15, 7, 2, 2);
    return c;
  }

  // 窗户(窗外城市) 48x34
  function makeWindow(isDay) {
    const c = cv(48, 34); const g = c.getContext("2d");
    g.fillStyle = isDay ? "#aee3f0" : "#2a3a5a";
    g.fillRect(2, 2, 44, 30);
    if (isDay) {
      g.fillStyle = "#8ecbee"; g.fillRect(2, 2, 44, 16);
      // 云
      g.fillStyle = "#ffffff"; g.fillRect(8, 6, 12, 4); g.fillRect(30, 9, 10, 3);
      // 楼
      g.fillStyle = "#c8b8a0"; g.fillRect(4, 18, 10, 14); g.fillRect(18, 14, 12, 18); g.fillRect(34, 20, 12, 12);
      g.fillStyle = "#f2e08a";
      for (let y = 20; y < 32; y += 4) for (let x = 6; x < 12; x += 4) g.fillRect(x, y, 2, 2);
      for (let y = 16; y < 32; y += 4) for (let x = 20; x < 28; x += 4) g.fillRect(x, y, 2, 2);
      for (let y = 22; y < 32; y += 4) for (let x = 36; x < 44; x += 4) g.fillRect(x, y, 2, 2);
      // 远山
      g.fillStyle = "#5a9a6a"; g.fillRect(2, 30, 44, 2);
    } else {
      // 夜空
      g.fillStyle = "#f2e08a"; g.fillRect(8, 6, 2, 2); g.fillRect(20, 10, 2, 2); g.fillRect(32, 5, 2, 2); g.fillRect(40, 12, 2, 2);
      g.fillStyle = "#c8b8a0"; g.fillRect(4, 16, 10, 16); g.fillRect(18, 12, 12, 20); g.fillRect(34, 18, 12, 14);
      g.fillStyle = "#f2e08a";
      for (let y = 18; y < 30; y += 4) for (let x = 6; x < 12; x += 4) g.fillRect(x, y, 2, 2);
      for (let y = 14; y < 30; y += 4) for (let x = 20; x < 28; x += 4) g.fillRect(x, y, 2, 2);
      for (let y = 20; y < 30; y += 4) for (let x = 36; x < 44; x += 4) g.fillRect(x, y, 2, 2);
    }
    g.fillStyle = "#8a6f52"; g.fillRect(0, 0, 48, 2); g.fillRect(0, 32, 48, 2); g.fillRect(0, 0, 2, 34); g.fillRect(46, 0, 2, 34);
    g.fillRect(23, 2, 2, 30);
    return c;
  }

  // 门 28x44
  function makeDoor(open) {
    const c = cv(28, 44); const g = c.getContext("2d");
    g.fillStyle = "#6e4526"; g.fillRect(0, 0, 28, 44);
    g.fillStyle = open ? "#4a3a2a" : "#9a6a3a"; g.fillRect(3, 3, 22, 38);
    if (!open) {
      g.fillStyle = "#c89a5a"; g.fillRect(3, 3, 22, 4);
      g.fillStyle = "#f2d8a0"; g.fillRect(7, 6, 4, 12);
      g.fillStyle = "#d8b078"; g.fillRect(7, 20, 4, 18);
      g.fillStyle = "#e8c88a"; g.fillRect(11, 6, 4, 12); g.fillRect(11, 20, 4, 18);
      g.fillStyle = "#f2d8a0"; g.fillRect(15, 6, 4, 12); g.fillRect(15, 20, 4, 18);
      g.fillStyle = "#e8c88a"; g.fillRect(19, 6, 4, 12); g.fillRect(19, 20, 4, 18);
      g.fillStyle = "#f2d8a0"; g.fillRect(9, 34, 8, 6);
      // 把手
      g.fillStyle = "#f2d8a0"; g.fillRect(20, 20, 3, 3);
    }
    g.fillStyle = "#4a3728"; g.fillRect(0, 0, 28, 2);
    return c;
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
    const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
    const b = Math.min(255, Math.round((n & 255) * f));
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // ------- 像素小图标 -------
  const icons = {};
  function drawIcon(name, size) {
    if (icons[name]) return icons[name];
    const c = cv(size, size); const g = c.getContext("2d");
    const px = size / 8; // 8x8 网格
    const P = (x, y, col) => { g.fillStyle = col; g.fillRect(Math.round(x * px), Math.round(y * px), Math.max(1, Math.ceil(px)), Math.max(1, Math.ceil(px))); };
    const INK = "#4a3728", R = "#c33c3c", G = "#3d8b6f", B = "#3f6fae", Y = "#e8a33d", W = "#f7f1e3", D = "#8a6f52", P2 = "#7a5fa0", Pk = "#d97a9c";
    switch (name) {
      case "money": // 金币
        P(1, 3, Y); P(2, 2, Y); P(3, 2, Y); P(4, 2, Y); P(5, 3, Y); P(5, 4, Y); P(4, 5, Y); P(3, 5, Y); P(2, 5, Y); P(1, 4, Y);
        P(2, 1, Y); P(3, 1, Y); P(4, 1, Y); P(1, 2, Y); P(5, 2, Y); P(6, 3, Y); P(6, 4, Y); P(5, 5, Y); P(2, 6, Y); P(3, 6, Y); P(4, 6, Y); P(1, 5, Y);
        P(3, 3, "#fff3b0"); P(3, 4, "#fff3b0");
        break;
      case "star":
        P(3, 1, Y); P(4, 1, Y); P(2, 2, Y); P(5, 2, Y); P(1, 3, Y); P(6, 3, Y); P(2, 4, Y); P(5, 4, Y); P(3, 5, Y); P(4, 5, Y); P(2, 6, Y); P(5, 6, Y); P(3, 7, Y); P(4, 7, Y);
        break;
      case "bell":
        P(2, 1, Y); P(3, 1, Y); P(4, 1, Y); P(5, 1, Y); P(2, 2, Y); P(5, 2, Y); P(2, 3, Y); P(5, 3, Y); P(2, 4, Y); P(5, 4, Y); P(1, 5, Y); P(6, 5, Y); P(3, 6, Y); P(4, 6, Y); P(3, 7, Y); P(4, 7, Y);
        break;
      case "chat":
        P(1, 1, B); P(2, 1, B); P(3, 1, B); P(4, 1, B); P(5, 1, B); P(6, 1, B); P(1, 2, B); P(6, 2, B); P(1, 3, B); P(6, 3, B); P(1, 4, B); P(6, 4, B); P(2, 5, B); P(3, 5, B); P(4, 5, B); P(5, 5, B);
        P(1, 1, W); P(2, 1, W); P(3, 1, W); P(4, 1, W); P(5, 1, W); P(1, 2, W); P(5, 2, W); P(1, 3, W); P(5, 3, W); P(2, 4, W); P(3, 4, W); P(4, 4, W);
        break;
      case "check":
        P(1, 4, G); P(2, 5, G); P(3, 6, G); P(6, 1, G); P(5, 2, G); P(4, 3, G);
        break;
      case "tick":
        P(2, 4, G); P(3, 5, G); P(4, 5, G); P(6, 2, G); P(5, 3, G);
        break;
      case "doc":
        P(2, 1, W); P(3, 1, W); P(4, 1, W); P(5, 1, W); P(5, 2, W); P(5, 3, W); P(5, 4, W); P(5, 5, W); P(5, 6, W); P(5, 7, W); P(2, 2, W); P(2, 3, W); P(2, 4, W); P(2, 5, W); P(2, 6, W); P(2, 7, W); P(3, 7, W); P(4, 7, W);
        P(3, 3, B); P(4, 3, B); P(3, 5, D); P(4, 5, D);
        break;
      case "wrench":
        P(3, 1, D); P(4, 1, D); P(2, 2, D); P(3, 2, D); P(2, 3, D); P(3, 3, D); P(4, 4, D); P(4, 5, D); P(5, 5, D); P(5, 6, D); P(6, 7, D); P(5, 7, D); P(6, 6, D);
        break;
      case "heart":
        P(2, 2, Pk); P(5, 2, Pk); P(1, 3, Pk); P(6, 3, Pk); P(1, 4, Pk); P(6, 4, Pk); P(2, 5, Pk); P(5, 5, Pk); P(3, 6, Pk); P(4, 6, Pk);
        break;
      case "users":
        P(2, 2, P2); P(3, 2, P2); P(4, 2, P2); P(5, 2, P2); P(2, 3, P2); P(5, 3, P2); P(2, 4, P2); P(5, 4, P2); P(3, 5, P2); P(4, 5, P2);
        P(1, 6, P2); P(2, 6, P2); P(3, 6, P2); P(4, 6, P2); P(5, 6, P2); P(6, 6, P2);
        break;
      case "sun":
        P(3, 1, Y); P(4, 1, Y); P(2, 2, Y); P(5, 2, Y); P(2, 5, Y); P(5, 5, Y); P(3, 6, Y); P(4, 6, Y); P(1, 3, Y); P(1, 4, Y); P(6, 3, Y); P(6, 4, Y); P(3, 3, Y); P(4, 3, Y); P(3, 4, Y); P(4, 4, Y);
        break;
      case "moon":
        P(3, 2, "#c8d8f0"); P(4, 2, "#c8d8f0"); P(3, 3, "#c8d8f0"); P(4, 3, "#c8d8f0"); P(5, 3, "#c8d8f0"); P(3, 4, "#c8d8f0"); P(4, 4, "#c8d8f0"); P(5, 4, "#c8d8f0"); P(2, 5, "#c8d8f0"); P(3, 5, "#c8d8f0"); P(4, 5, "#c8d8f0"); P(2, 6, "#c8d8f0"); P(3, 6, "#c8d8f0");
        break;
      case "up": P(3, 1, G); P(4, 1, G); P(2, 2, G); P(5, 2, G); P(1, 3, G); P(6, 3, G); P(3, 4, G); P(4, 4, G); P(3, 5, G); P(4, 5, G); P(3, 6, G); P(4, 6, G); P(3, 7, G); P(4, 7, G); break;
      case "down": P(3, 1, R); P(4, 1, R); P(3, 2, R); P(4, 2, R); P(3, 3, R); P(4, 3, R); P(3, 4, R); P(4, 4, R); P(1, 5, R); P(6, 5, R); P(2, 6, R); P(5, 6, R); P(3, 7, R); P(4, 7, R); break;
      case "ok": P(1, 3, G); P(2, 4, G); P(3, 5, G); P(6, 2, G); P(5, 3, G); P(4, 4, G); break;
      case "flag":
        P(2, 1, D); P(2, 2, D); P(2, 3, D); P(2, 4, D); P(2, 5, D); P(2, 6, D); P(2, 7, D);
        P(3, 1, R); P(4, 1, R); P(5, 1, R); P(6, 1, R); P(3, 2, R); P(4, 2, R); P(5, 2, R); P(3, 3, R); P(4, 3, R);
        break;
      case "clock":
        P(1, 2, INK); P(1, 3, INK); P(1, 4, INK); P(1, 5, INK); P(6, 2, INK); P(6, 3, INK); P(6, 4, INK); P(6, 5, INK); P(2, 1, INK); P(3, 1, INK); P(4, 1, INK); P(5, 1, INK); P(2, 6, INK); P(3, 6, INK); P(4, 6, INK); P(5, 6, INK);
        P(3, 3, INK); P(3, 4, INK); P(4, 3, INK); P(4, 4, INK); P(3, 3, W); P(4, 3, W); P(3, 4, W); P(4, 4, W);
        P(4, 2, INK); P(4, 3, INK); P(4, 4, INK); P(4, 5, INK);
        break;
      case "shop": // 商店/升级
        P(1, 5, INK); P(6, 5, INK); P(1, 6, INK); P(6, 6, INK); P(1, 7, INK); P(6, 7, INK); P(2, 7, INK); P(3, 7, INK); P(4, 7, INK); P(5, 7, INK);
        P(2, 1, R); P(3, 1, R); P(4, 1, R); P(5, 1, R); P(2, 2, R); P(5, 2, R); P(2, 3, R); P(5, 3, R); P(2, 4, R); P(5, 4, R);
        break;
      case "eye":
        P(1, 3, W); P(2, 3, W); P(3, 3, W); P(4, 3, W); P(5, 3, W); P(6, 3, W); P(1, 4, W); P(6, 4, W); P(1, 5, W); P(2, 5, W); P(3, 5, W); P(4, 5, W); P(5, 5, W); P(6, 5, W); P(2, 4, B); P(3, 4, B); P(4, 4, B); P(5, 4, B); P(3, 4, W); P(4, 4, W);
        break;
      case "gear":
        P(1, 3, D); P(1, 4, D); P(5, 3, D); P(5, 4, D); P(2, 1, D); P(3, 1, D); P(4, 1, D); P(2, 5, D); P(3, 5, D); P(4, 5, D); P(1, 2, D); P(5, 2, D); P(1, 5, D); P(5, 5, D); P(2, 6, D); P(3, 6, D); P(4, 6, D);
        P(2, 2, W); P(3, 2, W); P(4, 2, W); P(2, 3, W); P(3, 3, W); P(4, 3, W); P(2, 4, W); P(3, 4, W); P(4, 4, W);
        break;
      case "note":
        P(3, 1, W); P(3, 2, W); P(3, 3, W); P(3, 4, W); P(4, 3, W); P(5, 3, W); P(5, 4, W); P(5, 5, W); P(4, 5, W); P(4, 4, W); P(3, 6, W); P(4, 6, W);
        break;
      case "excl":
        P(3, 1, R); P(4, 1, R); P(3, 2, R); P(4, 2, R); P(3, 3, R); P(4, 3, R); P(3, 4, R); P(4, 4, R); P(3, 5, R); P(4, 5, R); P(3, 6, R); P(4, 6, R); P(3, 7, R); P(4, 7, R); P(2, 4, R); P(5, 4, R);
        break;
      case "gift":
        P(1, 2, R); P(2, 2, R); P(3, 2, R); P(4, 2, R); P(5, 2, R); P(6, 2, R); P(1, 3, R); P(6, 3, R); P(1, 4, R); P(6, 4, R); P(1, 5, R); P(6, 5, R); P(2, 5, R); P(3, 5, R); P(4, 5, R); P(5, 5, R);
        P(2, 3, Y); P(3, 3, Y); P(4, 3, Y); P(5, 3, Y); P(3, 1, Y); P(4, 1, Y); P(3, 2, Y); P(4, 2, Y);
        break;
      case "lock":
        P(2, 1, D); P(3, 1, D); P(4, 1, D); P(5, 1, D); P(2, 2, D); P(5, 2, D); P(1, 3, D); P(6, 3, D); P(1, 4, D); P(6, 4, D); P(1, 5, D); P(6, 5, D); P(1, 6, D); P(6, 6, D); P(2, 7, D); P(3, 7, D); P(4, 7, D); P(5, 7, D); P(3, 4, Y); P(4, 4, Y);
        break;
    }
    icons[name] = c;
    return c;
  }

  window.Sprites = {
    makeCharacter, makeDesk, makeChair, makePlant, makeCabinet, makeBoard, makeWindow, makeDoor, drawIcon, shade,
  };
})();
