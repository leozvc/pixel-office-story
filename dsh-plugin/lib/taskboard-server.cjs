#!/usr/bin/env node
/**
 * 像素办公室物语 —— DSH 任务编排服务 HTTP 入口（自包含，无需重启 DSH）
 * 监听 0.0.0.0:8867，承载配对/员工/看板/工作区/ASR/PM 快问快答/完成通知。
 * 用法：node taskboard-server.js [--port 8867]
 */
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const C = require("./taskboard-core.cjs");
const DshSync = require("./taskboard-dsh-sync.cjs");

const PORT = process.argv[2] === "--port" ? parseInt(process.argv[3], 10) : C.PORT;
const HOST = C.HOST;

C.ensureDirs();

// 任务执行调度：把 todo 任务交给员工执行（顺序，避免并发混乱）
let dispatching = new Set(); // 正在执行的任务 id，避免重复派发
async function dispatchTask(task) {
  // 若已在执行则跳过
  if (dispatching.has(task.id)) return;
  const es = C.loadEmployees();
  const assignees = task.assigneeIds.length ? task.assigneeIds.map(id => es.find(e => e.id === id)).filter(Boolean) : es.filter(e => e.role !== "pm" && e.id !== undefined).slice(0, 1);
  if (!assignees.length) {
    // 无可用员工：保持 todo 并提示，等自动推进重试
    const k = C.loadKanban();
    const t = k.tasks.find(x => x.id === task.id);
    if (t) {
      t.status = "todo";
      t.output = "（等待可用员工 agent 执行）";
      t.updatedAt = Date.now();
      C.saveKanban(k);
    }
    return;
  }
  dispatching.add(task.id);
  try {
    // 先更新 kanban 中该任务的 doing + dispatchedAt（持久化，避免自动推进重复排队）
    const kb = C.loadKanban();
    const kbTask = kb.tasks.find(x => x.id === task.id);
    if (kbTask) {
      kbTask.status = "doing";
      kbTask.updatedAt = Date.now();
      kbTask.dispatchedAt = Date.now();
      C.saveKanban(kb);
    }
    task.status = "doing";
    task.updatedAt = Date.now();
    task.dispatchedAt = Date.now();
    for (const e of assignees) { e.status = "working"; }
    C.saveEmployees(es);
    // 实际执行（取第一个员工执行），实时回写执行阶段
    const emp = assignees[0];
    const setStage = (stage) => {
      const k = C.loadKanban();
      const t = k.tasks.find(x => x.id === task.id);
      if (t) { t.stage = stage; t.status = stage === "done" ? "done" : "doing"; t.updatedAt = Date.now(); C.saveKanban(k); }
    };
    try {
      const out = await C.executeTask(emp, task, setStage);
      const k = C.loadKanban();
      const t = k.tasks.find(x => x.id === task.id);
      if (t) {
        t.output = out;
        t.outputFiles = [];
        try { t.outputFiles = fs.readdirSync(task.workspace).filter(f => !f.endsWith(".txt")); } catch (e) {}
        t.status = "done";
        t.updatedAt = Date.now();
        C.saveKanban(k);
      }
    } catch (e) {
      const k = C.loadKanban();
      const t = k.tasks.find(x => x.id === task.id);
      if (t) { t.output = "（执行失败：" + e.message + "）"; t.status = "done"; t.updatedAt = Date.now(); C.saveKanban(k); }
    }
    // 复位员工状态
    for (const e of assignees) e.status = "idle";
    C.saveEmployees(C.loadEmployees());
  } finally {
    dispatching.delete(task.id);
  }
}

// 任务派发队列（顺序执行）
let dispatchChain = Promise.resolve();
function queueDispatch(task) {
  dispatchChain = dispatchChain.then(() => dispatchTask(task)).catch(() => {});
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  if (req.method === "OPTIONS") { C.json(res, 200, {}); return; }
  try {
    if (req.method === "GET" && pathname === "/health") {
      C.json(res, 200, { ok: true, service: "pixel-office-taskboard", port: PORT, llmReachable: !!C.API_KEY, pairedDevices: 0, hostHints: C.localIPs(), time: new Date().toISOString() });
      return;
    }
    if (req.method === "POST" && pathname === "/pair/request") {
      const code = C.newPairCode();
      C.json(res, 200, { ok: true, code, expiresInSec: 600, hostHints: C.localIPs() });
      return;
    }
    if (req.method === "POST" && pathname === "/pair/confirm") {
      const b = await C.readBody(req);
      if (!C.verifyCode(b.code)) { C.json(res, 401, { ok: false, error: "配对码无效或已过期" }); return; }
      C.json(res, 200, { ok: true, token: C.newToken(b.deviceName || "pixel-office-app"), model: C.FAST_MODEL, expiresInSec: 604800 });
      return;
    }

    const rec = C.verifyToken(req.headers["authorization"]);
    if (!rec) { C.json(res, 401, { ok: false, error: "未授权" }); return; }

    // ---- 员工 ----
    if (req.method === "GET" && pathname === "/v1/employees") {
      C.json(res, 200, { ok: true, employees: C.loadEmployees().map(e => ({ id: e.id, name: e.name, role: e.role, roleName: e.roleName, emoji: e.emoji, status: e.status, createdAt: e.createdAt })) });
      return;
    }
    if (req.method === "POST" && pathname === "/v1/employees/hire") {
      const b = await C.readBody(req);
      const emp = C.createEmployee(b.name, b.role || "dev");
      const es = C.loadEmployees(); es.push(emp); C.saveEmployees(es);
      C.json(res, 200, { ok: true, employee: { id: emp.id, name: emp.name, role: emp.role, roleName: emp.roleName, emoji: emp.emoji } });
      return;
    }
    if (req.method === "POST" && pathname === "/v1/employees/fire") {
      const b = await C.readBody(req);
      C.saveEmployees(C.loadEmployees().filter(e => e.id !== b.id));
      C.json(res, 200, { ok: true });
      return;
    }

    // ---- 任务看板 ----
    if (req.method === "GET" && pathname === "/v1/tasks") {
      const k = C.loadKanban();
      C.json(res, 200, { ok: true, tasks: k.tasks.map(t => ({ ...t, history: undefined })) });
      return;
    }
    if (req.method === "POST" && pathname === "/v1/tasks") {
      const b = await C.readBody(req);
      const { title, desc, assign, workspace } = b;
      if (!title) { C.json(res, 400, { ok: false, error: "title required" }); return; }
      const taskId = "task-" + Date.now() + "-" + Math.floor(Math.random() * 999);
      const ws = workspace || path.join(C.WORKSPACE_ROOT, "tasks", taskId);
      const task = { id: taskId, title, desc: desc || "", assign: Array.isArray(assign) ? assign : [], assigneeIds: [], workspace: ws, status: "todo", createdAt: Date.now(), updatedAt: Date.now(), output: "", outputFiles: [] };
      const es = C.loadEmployees();
      for (const name of task.assign) { const e = es.find(x => x.name === name || x.roleName === name); if (e) task.assigneeIds.push(e.id); }
      const k = C.loadKanban(); k.tasks.push(task); C.saveKanban(k);
      fs.mkdirSync(task.workspace, { recursive: true });
      // 同步到 DSH web 任务看板（不阻塞响应）
      DshSync.syncTaskToDsh(task).catch(e => console.log("[pixb-sync] create 同步失败:", e.message));
      // 自动派发执行，任务创建后立即推进
      queueDispatch(task);
      C.json(res, 200, { ok: true, task, autoDispatched: true });
      return;
    }
    if (req.method === "POST" && pathname === "/v1/tasks/dispatch") {
      const b = await C.readBody(req);
      const k = C.loadKanban();
      const t = k.tasks.find(x => x.id === b.id);
      if (!t) { C.json(res, 404, { ok: false, error: "task not found" }); return; }
      queueDispatch(t);
      // 同步到 DSH web 看板
      DshSync.syncTaskToDsh(t).catch(e => console.log("[pixb-sync] dispatch 同步失败:", e.message));
      C.json(res, 200, { ok: true, status: "dispatched" });
      return;
    }
    if (req.method === "POST" && pathname === "/v1/tasks/sync") {
      const k = C.loadKanban();
      const results = await DshSync.syncAllToDsh(k.tasks);
      C.json(res, 200, { ok: true, synced: results.length, results });
      return;
    }
    if (req.method === "POST" && pathname === "/v1/tasks/status") {
      const b = await C.readBody(req);
      const k = C.loadKanban();
      const t = k.tasks.find(x => x.id === b.id);
      if (!t) { C.json(res, 404, { ok: false, error: "task not found" }); return; }
      if (b.status && ["todo", "doing", "done"].includes(b.status)) { t.status = b.status; t.updatedAt = Date.now(); C.saveKanban(k); }
      DshSync.syncTaskToDsh(t).catch(e => console.log("[pixb-sync] status 同步失败:", e.message));
      C.json(res, 200, { ok: true, task: { ...t, history: undefined } });
      return;
    }
    if (req.method === "GET" && pathname.startsWith("/v1/tasks/") && pathname.endsWith("/workspace")) {
      const id = pathname.slice("/v1/tasks/".length, -"/workspace".length);
      const k = C.loadKanban();
      const t = k.tasks.find(x => x.id === id);
      if (!t) { C.json(res, 404, { ok: false, error: "not found" }); return; }
      let files = [];
      try { files = fs.readdirSync(t.workspace, { withFileTypes: true }).map(d => ({ name: d.name, dir: d.isDirectory() })); } catch (e) {}
      C.json(res, 200, { ok: true, workspace: t.workspace, files });
      return;
    }

    // ---- PM 快问快答 ----
    if (req.method === "POST" && pathname === "/v1/pm/chat") {
      const b = await C.readBody(req);
      const { messages } = b;
      if (!Array.isArray(messages) || !messages.length) { C.json(res, 400, { ok: false, error: "messages required" }); return; }
      const k = C.loadKanban();
      const es = C.loadEmployees();
      const sys = C.PM_PROMPT + "\n\n当前任务看板（JSON）：\n" + JSON.stringify(k.tasks.map(t => ({ id: t.id, title: t.title, status: t.status, assign: t.assign, outputPreview: (t.output || "").slice(0, 100) }))) + "\n当前员工（JSON）：\n" + JSON.stringify(es.map(e => ({ name: e.name, role: e.role, status: e.status })));
      const content = await C.llm([{ role: "system", content: sys }, ...messages], { maxTokens: 600, timeout: 60000 });
      C.json(res, 200, { ok: true, content, model: C.FAST_MODEL });
      return;
    }

    // ---- ASR（whisper） ----
    if (req.method === "POST" && pathname === "/v1/asr") {
      // 接收 multipart 或 raw audio；这里简化：raw audio body -> 临时文件 -> whisper
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const buf = Buffer.concat(chunks);
      const tmp = path.join(os.tmpdir(), "pixb_audio_" + Date.now() + ".wav");
      fs.writeFileSync(tmp, buf);
      try {
        const text = await C.transcribe(tmp);
        C.json(res, 200, { ok: true, text });
      } catch (e) {
        C.json(res, 500, { ok: false, error: e.message });
      }
      try { fs.unlinkSync(tmp); } catch (e) {}
      return;
    }

    // ---- 完成通知（APK 轮询） ----
    if (req.method === "GET" && pathname === "/v1/notifications") {
      const since = parseInt(url.searchParams.get("since") || "0", 10);
      const k = C.loadKanban();
      const events = k.tasks.filter(t => t.status === "done" && t.updatedAt > since).map(t => ({ id: t.id, title: t.title, at: t.updatedAt, type: "done" }));
      C.json(res, 200, { ok: true, events, serverTime: Date.now() });
      return;
    }

    C.json(res, 404, { ok: false, error: "not found: " + pathname });
  } catch (e) {
    C.json(res, 500, { ok: false, error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log("====================================================");
  console.log("  像素办公室物语 · DSH 任务编排服务");
  console.log("====================================================");
  console.log("  监听: http://" + HOST + ":" + PORT);
  console.log("  LLM : " + C.LLM_BASE + "  model: " + C.FAST_MODEL);
  console.log("  工作区: " + C.WORKSPACE_ROOT);
  console.log("  本机 IP: " + C.localIPs().join(", "));
  console.log("----------------------------------------------------");
  // 后台自动推进：定期扫描"未派发过"的 todo 任务自动派发执行，杜绝任务停滞
  setInterval(() => {
    const k = C.loadKanban();
    // 只推进从未派发过的 todo 任务（已派发但执行中的不重复排队）
    const pending = k.tasks.filter(t => t.status === "todo" && !t.dispatchedAt);
    for (const t of pending) {
      console.log("[pixb-auto] 自动推进任务: " + t.title + " (" + t.id + ")");
      queueDispatch(t);
    }
  }, 5000);
});
