// LLM 桥接客户端 —— 对接 DSH 桥接服务（DSH 任务编排版）
// 负责：配对、token 管理、真实员工 agent 管理、任务派发、PM 对话
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
      signal: AbortSignal.timeout(60000),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || ("HTTP " + resp.status));
    return data;
  }

  function isConfigured() {
    return !!baseUrl() && !!settings.token;
  }

  // 配对
  async function requestPairCode() {
    if (!baseUrl()) throw new Error("请先填写服务器地址");
    return await req("/pair/request", "POST", {});
  }
  async function confirmPair(code, deviceName) {
    const d = await req("/pair/confirm", "POST", { code: code.trim(), deviceName: deviceName || "PixelOffice" });
    settings.token = d.token;
    settings.paired = true;
    settings.model = d.model || "";
    saveSettings();
    return d;
  }
  function clearPair() {
    settings.token = "";
    settings.paired = false;
    settings.model = "";
    saveSettings();
  }
  function setServer(s) { settings.server = (s || "").trim(); saveSettings(); }
  function setDeviceName(n) { settings.deviceName = (n || "").trim(); saveSettings(); }

  // 健康检查
  async function health() {
    if (!baseUrl()) return { ok: false };
    try { return await req("/health", "GET"); }
    catch (e) { return { ok: false, error: e.message }; }
  }

  // ---- DSH 任务编排 API ----
  // 列出员工（真实 continuable 子代理）
  async function listAgents() {
    return await req("/v1/agents", "GET", null, settings.token);
  }
  // 雇佣员工
  async function hireAgent(name, role) {
    return await req("/v1/agents/hire", "POST", { name, role }, settings.token);
  }
  // 创建任务并指派
  async function createTask(title, desc, assign) {
    return await req("/v1/tasks", "POST", { title, desc, assign }, settings.token);
  }
  // 列出任务/员工实时状态
  async function listTasks() {
    return await req("/v1/tasks", "GET", null, settings.token);
  }
  // 指派单个任务给员工
  async function assignTask(childId, taskText) {
    return await req("/v1/tasks/assign", "POST", { childId, taskText }, settings.token);
  }
  // 读取员工会话日志（汇报用）
  async function readLogs(childId) {
    return await req("/v1/tasks/" + childId + "/logs", "GET", null, settings.token);
  }
  // PM 汇报
  async function pmReport() {
    return await req("/v1/pm/report", "POST", {}, settings.token);
  }
  // PM 对话（LLM 解读意图 + 调度）
  async function pmChat(messages, team, tasks) {
    return await req("/v1/pm/chat", "POST", { messages, team, tasks }, settings.token);
  }

  // 组装游戏状态给 PM
  function buildGameState() {
    const Ss = S.get();
    return {
      companyName: Ss.companyName,
      connected: Ss.connected,
      employees: Ss.employees.map(e => ({
        id: e.id, name: e.name, role: e.role, status: e.status,
      })),
      tasks: Ss.tasks.map(t => ({
        id: t.id, title: t.title, desc: t.desc, assign: t.assign, status: t.status,
      })),
    };
  }

  return {
    loadSettings, saveSettings, getSettings,
    isConfigured, requestPairCode, confirmPair, clearPair, setServer, setDeviceName,
    health, buildGameState,
    listAgents, hireAgent, createTask, listTasks, assignTask, readLogs, pmReport, pmChat,
    SETTINGS_KEY,
  };
})();
