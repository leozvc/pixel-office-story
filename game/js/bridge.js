// DSH 任务编排客户端 —— 对接自包含任务编排服务（8867）
// 负责：配对、员工管理、任务看板、工作区、ASR 语音、PM 对话、完成通知
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
      signal: AbortSignal.timeout(120000),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || ("HTTP " + resp.status));
    return data;
  }

  function isConfigured() {
    return !!baseUrl() && !!settings.token;
  }

  // ---- 配对 ----
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
    settings.token = ""; settings.paired = false; settings.model = "";
    saveSettings();
  }
  function setServer(s) { settings.server = (s || "").trim(); saveSettings(); }
  function setDeviceName(n) { settings.deviceName = (n || "").trim(); saveSettings(); }
  async function health() {
    if (!baseUrl()) return { ok: false };
    try { return await req("/health", "GET"); }
    catch (e) { return { ok: false, error: e.message }; }
  }

  // ---- 员工 ----
  async function listEmployees() { return await req("/v1/employees", "GET", null, settings.token); }
  async function hireEmployee(name, role) { return await req("/v1/employees/hire", "POST", { name, role }, settings.token); }
  async function fireEmployee(id) { return await req("/v1/employees/fire", "POST", { id }, settings.token); }

  // ---- 任务看板 ----
  async function listTasks() { return await req("/v1/tasks", "GET", null, settings.token); }
  async function createTask(title, desc, assign, workspace) { return await req("/v1/tasks", "POST", { title, desc, assign, workspace }, settings.token); }
  async function dispatchTask(id) { return await req("/v1/tasks/dispatch", "POST", { id }, settings.token); }
  async function setTaskStatus(id, status) { return await req("/v1/tasks/status", "POST", { id, status }, settings.token); }
  async function listWorkspace(id) { return await req("/v1/tasks/" + id + "/workspace", "GET", null, settings.token); }

  // ---- PM 对话 ----
  async function pmChat(messages, team, tasks) {
    return await req("/v1/pm/chat", "POST", { messages, team, tasks }, settings.token);
  }

  // ---- ASR 语音 ----
  async function transcribeAudio(audioBlob) {
    const url = baseUrl() + "/v1/asr";
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Authorization": "Bearer " + settings.token },
      body: audioBlob,
      signal: AbortSignal.timeout(120000),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || ("HTTP " + resp.status));
    return data.text || "";
  }

  // ---- 完成通知 ----
  async function listNotifications(since) {
    return await req("/v1/notifications?since=" + (since || 0), "GET", null, settings.token);
  }

  // 组装游戏状态给 PM
  function buildGameState() {
    const Ss = S.get();
    return {
      companyName: Ss.companyName,
      connected: Ss.connected,
      employees: Ss.employees.map(e => ({ id: e.id, name: e.name, role: e.role, status: e.status })),
      tasks: Ss.tasks.map(t => ({ id: t.id, title: t.title, desc: t.desc, assign: t.assign, status: t.status })),
    };
  }

  return {
    loadSettings, saveSettings, getSettings,
    isConfigured, requestPairCode, confirmPair, clearPair, setServer, setDeviceName,
    health, buildGameState,
    listEmployees, hireEmployee, fireEmployee,
    listTasks, createTask, dispatchTask, setTaskStatus, listWorkspace,
    pmChat, transcribeAudio, listNotifications,
    SETTINGS_KEY,
  };
})();
