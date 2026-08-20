// 游戏状态管理 —— DSH 任务编排版
// 状态只跟踪：连接状态、真实员工（DSH agent）、任务（真实派发）
window.GState = (function () {
  const SAVE_KEY = "pixelOfficeSave_dsh";

  function defaultState() {
    return {
      version: 2,
      startedAt: Date.now(),
      companyName: "像素软件株式会社",
      // 员工 = 真实 DSH agent（从桥接服务获取）
      employees: [],   // { id(agentId), name, role, roleName, emoji, status, label }
      // 任务 = 真实派发记录 { id, title, desc, assign:[names], createdAt, status, results:[] }
      tasks: [],
      notifications: [], // { uid, icon, title, body, time, read, type }
      connected: false,
      lastSync: 0,
    };
  }

  let S = null;
  const listeners = [];

  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(S));
    } catch (e) {}
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.version === 2) { S = Object.assign(defaultState(), d); return; }
      }
    } catch (e) {}
    S = defaultState();
  }

  function reset() { S = defaultState(); save(); emit(); }

  function get() { return S; }
  function emit() { listeners.forEach(f => { try { f(S); } catch (e) {} }); }
  function on(fn) { listeners.push(fn); }
  function set(mutator) { mutator(S); save(); emit(); }

  function notify(title, body, opts = {}) {
    const n = {
      uid: "n" + Date.now() + Math.floor(Math.random() * 9999),
      icon: opts.icon || "bell", title, body,
      time: Date.now(), read: false, type: opts.type || "info",
      important: !!opts.important,
    };
    S.notifications.unshift(n);
    if (S.notifications.length > 80) S.notifications.length = 80;
    save(); emit();
    return n;
  }

  return {
    defaultState, save, load, reset, get, emit, on, set, notify,
    SAVE_KEY,
  };
})();
