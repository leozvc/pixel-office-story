// LLM 桥接客户端 —— 对接 DSH 桥接服务的网络层
// 负责：配对流程、token 管理、调用 /v1/chat、离线检测与回退
window.Bridge = (function () {
  const S = GState;
  const SETTINGS_KEY = "pixelOfficeBridgeSettings";

  let settings = { server: "", token: "", deviceName: "", paired: false, model: "" };
  let busy = false;

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) settings = Object.assign(settings, JSON.parse(raw));
    } catch (e) {}
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
  }
  function getSettings() { return Object.assign({}, settings); }

  function baseUrl() {
    let s = (settings.server || "").trim();
    if (!s) return "";
    s = s.replace(/\/+$/, "");
    if (!/^https?:\/\//.test(s)) s = "http://" + s;
    return s;
  }

  async function req(path, method, body, token) {
    const url = baseUrl() + path;
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;
    const resp = await fetch(url, {
      method: method || "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || ("HTTP " + resp.status));
    return data;
  }

  function isConfigured() {
    return !!baseUrl() && !!settings.token;
  }

  // 配对步骤 1：请求配对码
  async function requestPairCode() {
    if (!baseUrl()) throw new Error("请先填写服务器地址");
    const d = await req("/pair/request", "POST", {});
    return d;
  }

  // 配对步骤 2：确认配对码，换取 token
  async function confirmPair(code, deviceName) {
    const d = await req("/pair/confirm", "POST", { code: code.trim(), deviceName: deviceName || "PixelOffice" });
    settings.token = d.token;
    settings.paired = true;
    settings.model = d.model || "";
    saveSettings();
    return d;
  }

  // 调用 LLM 对话（游戏状态会附加给 PM 上下文）
  async function chat(messages, gameState) {
    if (!isConfigured()) throw new Error("未配对");
    if (busy) throw new Error("busy");
    busy = true;
    try {
      const d = await req("/v1/chat", "POST", { messages, gameState }, settings.token);
      return d;
    } finally { busy = false; }
  }

  // 健康检查（带 token）
  async function health() {
    if (!baseUrl()) return { ok: false };
    try {
      const d = await req("/health", "GET");
      return d;
    } catch (e) { return { ok: false, error: e.message }; }
  }

  function clearPair() {
    settings.token = "";
    settings.paired = false;
    settings.model = "";
    saveSettings();
  }

  function setServer(s) { settings.server = (s || "").trim(); saveSettings(); }
  function setDeviceName(n) { settings.deviceName = (n || "").trim(); saveSettings(); }

  // 组装游戏状态给 PM
  function buildGameState() {
    const Ss = S.get();
    return {
      day: Ss.day,
      clock: Ss.clock,
      money: Ss.money,
      companyLevel: Ss.companyLevel,
      companyName: Ss.companyName,
      reputation: Ss.reputation,
      employees: Ss.employees.map(e => ({
        id: e.id, name: e.name, role: e.typeId, mood: e.mood, level: e.level, salary: e.salary,
      })),
      projects: Ss.projects.map(p => ({
        id: p.id, name: p.name, client: p.client, reward: p.reward, difficulty: p.difficulty,
        required: p.required,
        progress: p.required.map(t => ({ role: t, done: p.progress[t] || 0, total: p.hours[t] })),
      })),
      tasks: Ss.tasks.map(t => ({ emp: (Ss.employees.find(e => e.id === t.empId) || {}).name, role: t.typeId, done: t.done, total: t.total })),
      archiveCount: Ss.archive.length,
      money: Ss.money,
      lastOffer: Ss._lastOffer ? {
        name: Ss._lastOffer.name, client: Ss._lastOffer.client,
        reward: Ss._lastOffer.reward, difficulty: Ss._lastOffer.difficulty,
        required: Ss._lastOffer.required,
      } : null,
    };
  }

  return {
    loadSettings, saveSettings, getSettings,
    isConfigured, requestPairCode, confirmPair, chat, health, clearPair,
    setServer, setDeviceName, buildGameState,
    SETTINGS_KEY,
  };
})();
