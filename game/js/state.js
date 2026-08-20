// 游戏状态管理
window.GState = (function () {
  const SAVE_KEY = "pixelOfficeSave_v1";

  function defaultState() {
    return {
      version: 1,
      startedAt: Date.now(),
      money: 3000,
      companyLevel: 1,
      companyName: "像素软件株式会社",
      reputation: 0,
      day: 1,
      clock: 9 * 60, // 分钟（9:00）
      employees: [],   // { id, typeId, name, salary, mood, level, exp, stats, hiredAt, custom }
      projects: [],    // 已接项目 { id, typeId, name, client, reward, difficulty, required, progress:{typeId:hoursDone}, status }
      archive: [],     // 已完成项目 { name, reward, day, date, rating, flavor }
      tasks: [],       // 分配给员工的微观任务 { uid, empId, typeId, projectId, total, done, desc }
      notifications: [], // { uid, icon, title, body, time, read, type, at, projectId }
      moodEvents: [],
      upg: { desk: 0, chairs: 0, decor: 0, coffee: 0, network: 0 }, // 升级
      hiredOnce: false,
      stats: { projectsDone: 0, totalRevenue: 0, bugsFixed: 0 },
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
        if (d && d.version === 1) { S = Object.assign(defaultState(), d); return; }
      }
    } catch (e) {}
    S = defaultState();
  }

  function reset() { S = defaultState(); save(); emit(); }

  function get() { return S; }
  function emit() { listeners.forEach(f => { try { f(S); } catch (e) {} }); }
  function on(fn) { listeners.push(fn); }
  function set(mutator) { mutator(S); save(); emit(); }

  // 通知
  function notify(title, body, opts = {}) {
    const n = {
      uid: "n" + Date.now() + Math.floor(Math.random() * 9999),
      icon: opts.icon || "bell", title, body,
      time: Date.now(), read: false, type: opts.type || "info",
      at: S.day, projectId: opts.projectId || null,
      important: !!opts.important,
    };
    S.notifications.unshift(n);
    if (S.notifications.length > 120) S.notifications.length = 120;
    save(); emit();
    return n;
  }

  function addMoney(amount, silent) {
    S.money += amount;
    if (amount > 0 && !silent) { S.stats.totalRevenue += amount; }
    save(); emit();
  }

  function addRep(v) { S.reputation = Math.max(0, S.reputation + v); save(); emit(); }

  function tickMinute() {
    S.clock += 1;
    if (S.clock >= 22 * 60) { // 22:00 下班结算
      endDay();
    }
    if (S.clock >= 24 * 60) S.clock = 0;
  }

  function endDay() {
    S.day += 1;
    S.clock = 9 * 60;
    // 发工资
    const total = S.employees.reduce((a, e) => a + e.salary, 0);
    S.money -= total;
    // 员工心情缓慢下降/恢复
    S.employees.forEach(e => {
      e.mood = Math.max(20, Math.min(100, e.mood + (e.mood >= 80 ? 0 : 3)));
    });
    // 每日咖啡免费恢复
    S.upg.coffee = 0;
    save(); emit();
    notify("新的一天", "第" + S.day + "天开始啦！今天也要加油！", { icon: "sun", type: "day" });
  }

  return {
    defaultState, save, load, reset, get, emit, on, set,
    notify, addMoney, addRep, tickMinute, endDay,
    SAVE_KEY,
  };
})();
