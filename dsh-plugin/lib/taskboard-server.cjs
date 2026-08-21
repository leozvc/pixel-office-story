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
        t.completedAt = Date.now(); // 记录完成时间（用于统计耗时）
        t.updatedAt = Date.now();
        C.saveKanban(k);
        // 记入公司长期记忆 + 员工技能成长
        C.rememberTask(t);
        C.rememberEvent(`完成任务《${t.title}》`);
        for (const eid of (t.assigneeIds || [])) C.recordTaskCompletion(eid, t);
      }
    } catch (e) {
      const k = C.loadKanban();
      const t = k.tasks.find(x => x.id === task.id);
      if (t) {
        const retries = (t.retries || 0) + 1;
        // 首次失败自动重试一次；仍失败则标记 failed 并给出可读提示
        if (retries <= 1) {
          t.retries = retries;
          t.output = "（首次执行失败，正在重试…）" + e.message;
          t.stage = "retrying";
          C.saveKanban(k);
          // 延迟后重新派发
          setTimeout(() => { queueDispatch(t); }, 3000);
          return;
        }
        t.output = "（执行失败：" + e.message + "）\n建议：检查 DSH/LLM 服务是否可用，或稍后在任务详情点击「重新执行」重试。";
        t.status = "failed";
        t.stage = "failed";
        t.updatedAt = Date.now();
        C.saveKanban(k);
      }
    }
    // 复位员工状态
    for (const e of assignees) e.status = "idle";
    C.saveEmployees(C.loadEmployees());
  } finally {
    dispatching.delete(task.id);
  }
}

// 任务派发：支持并行执行（并发上限），避免单任务串行阻塞
// 同一员工的多个任务仍串行（员工一次只干一个活）
const MAX_PARALLEL = 3;
let activeDispatches = 0;
const waitingQueue = [];
function scheduleNext() {
  if (activeDispatches >= MAX_PARALLEL) return;
  // 从等待队列中挑一个"员工未繁忙"的任务执行
  const es = C.loadEmployees();
  const busyEmp = new Set(es.filter(e => e.status === "working").map(e => e.id));
  const idx = waitingQueue.findIndex(t => !(t.assigneeIds || []).some(id => busyEmp.has(id)));
  if (idx < 0) return; // 都忙，等有人空闲后再调度
  const task = waitingQueue.splice(idx, 1)[0];
  activeDispatches++;
  dispatchTask(task).catch(() => {}).finally(() => {
    activeDispatches--;
    scheduleNext();
  });
}
function queueDispatch(task) {
  waitingQueue.push(task);
  scheduleNext();
}
// 当员工状态变化时可能有人空闲，重新调度
setInterval(() => scheduleNext(), 2000);

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
      C.json(res, 200, { ok: true, employees: C.loadEmployees().map(e => ({ id: e.id, name: e.name, role: e.role, roleName: e.roleName, emoji: e.emoji, status: e.status, createdAt: e.createdAt, skill: C.employeeSkillView(e) })) });
      return;
    }
    if (req.method === "POST" && pathname === "/v1/employees/hire") {
      const b = await C.readBody(req);
      const emp = C.createEmployee(b.name, b.role || "dev");
      const es = C.loadEmployees(); es.push(emp); C.saveEmployees(es);
      C.rememberEmployee(emp); // 记入公司记忆
      C.json(res, 200, { ok: true, employee: { id: emp.id, name: emp.name, role: emp.role, roleName: emp.roleName, emoji: emp.emoji } });
      return;
    }
    if (req.method === "POST" && pathname === "/v1/employees/fire") {
      const b = await C.readBody(req);
      C.saveEmployees(C.loadEmployees().filter(e => e.id !== b.id));
      C.json(res, 200, { ok: true });
      return;
    }
    // 公司长期记忆（供游戏/调试查看）
    if (req.method === "GET" && pathname === "/v1/memory") {
      C.json(res, 200, { ok: true, memory: C.loadMemory(), summary: C.buildMemorySummary() });
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
      const priority = b.priority && ["high", "medium", "low"].includes(b.priority) ? b.priority : "medium";
      const task = { id: taskId, title, desc: desc || "", assign: Array.isArray(assign) ? assign : [], assigneeIds: [], workspace: ws, status: "todo", priority, createdAt: Date.now(), updatedAt: Date.now(), output: "", outputFiles: [] };
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
      if (b.status && ["todo", "doing", "done", "failed"].includes(b.status)) { t.status = b.status; t.updatedAt = Date.now(); }
      if (b.priority && ["high", "medium", "low"].includes(b.priority)) { t.priority = b.priority; t.updatedAt = Date.now(); }
      if (b.cancel) { t.status = "todo"; t.stage = ""; t.updatedAt = Date.now(); }
      C.saveKanban(k);
      DshSync.syncTaskToDsh(t).catch(e => console.log("[pixb-sync] status 同步失败:", e.message));
      C.json(res, 200, { ok: true, task: { ...t, history: undefined } });
      return;
    }
    if (req.method === "POST" && pathname === "/v1/tasks/delete") {
      const b = await C.readBody(req);
      const k = C.loadKanban();
      k.tasks = k.tasks.filter(x => x.id !== b.id);
      C.saveKanban(k);
      C.json(res, 200, { ok: true });
      return;
    }
    // 数据统计
    if (req.method === "GET" && pathname === "/v1/stats") {
      const k = C.loadKanban();
      const es = C.loadEmployees();
      const tasks = k.tasks;
      const total = tasks.length;
      const done = tasks.filter(t => t.status === "done").length;
      const doing = tasks.filter(t => t.status === "doing").length;
      const todo = tasks.filter(t => t.status === "todo").length;
      const failed = tasks.filter(t => t.status === "failed").length;
      const successRate = total ? Math.round(done / total * 100) : 0;
      // 平均耗时（有 completedAt 的任务）
      const withDur = tasks.filter(t => t.completedAt && t.createdAt);
      const avgDuration = withDur.length ? Math.round(withDur.reduce((s, t) => s + (t.completedAt - t.createdAt), 0) / withDur.length / 1000) : 0;
      // 员工工作量
      const empWork = es.map(e => ({
        name: e.name, role: e.roleName,
        done: (e.stats && e.stats.tasksDone) || 0,
        level: (e.stats && e.stats.level) || 1,
        domains: (e.stats && e.stats.domains) || {},
      }));
      C.json(res, 200, { ok: true, stats: { total, done, doing, todo, failed, successRate, avgDurationSec: avgDuration, empWork } });
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
      const memory = C.buildMemorySummary();
      const sys = C.PM_PROMPT + "\n\n【公司长期记忆】\n" + (memory || "(暂无历史记忆)") + "\n\n当前任务看板（JSON）：\n" + JSON.stringify(k.tasks.map(t => ({ id: t.id, title: t.title, status: t.status, assign: t.assign, outputPreview: (t.output || "").slice(0, 100) }))) + "\n当前员工（JSON）：\n" + JSON.stringify(es.map(e => ({ name: e.name, role: e.role, status: e.status })));
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
  // 启动时复位残留 working 的员工（防止上次异常/重启导致员工卡在忙碌态，任务无法派发）
  try {
    const es0 = C.loadEmployees();
    let changed = false;
    for (const e of es0) { if (e.status === "working") { e.status = "idle"; changed = true; } }
    if (changed) { C.saveEmployees(es0); console.log("[pixb] 已复位 " + es0.filter(e => e.status === "idle").length + " 名员工状态"); }
  } catch (e) {}
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
