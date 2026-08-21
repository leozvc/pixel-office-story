#!/usr/bin/env node
/**
 * 像素办公室物语 —— DSH 任务编排服务（自包含）
 * 独立 HTTP 服务（默认 0.0.0.0:8867），不依赖 DSH 进程内部服务，无需重启 DSH。
 * 承载：配对鉴权 / 员工(LLM 会话线程) / 任务看板 / 工作区 / ASR(whisper) / PM 快问快答 / 完成通知
 * 用法：node taskboard-server.js [--port 8867]
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

// ---------- 配置 ----------
const PORT = parseInt(process.env.PIXB_PORT || "8867", 10);
const HOST = process.env.PIXB_HOST || "0.0.0.0";
const LLM_BASE = process.env.DSH_LLM_BASE || "http://127.0.0.1:10100/v1";
const FAST_MODEL = process.env.PIXB_FAST_MODEL || "wps-ai/deepseek/deepseek-v4-flash-0731";
const ROOT = process.env.PIXB_ROOT || path.join(os.homedir(), ".dsh", "pixel-office-story");
const WORKSPACE_ROOT = process.env.PIXB_WORKSPACE || path.join(ROOT, "workspace");
const DATA_DIR = path.join(ROOT, "data");
const KANBAN_FILE = path.join(DATA_DIR, "kanban.json");
const EMPLOYEES_FILE = path.join(DATA_DIR, "employees.json");
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");
const ECONOMY_FILE = path.join(DATA_DIR, "economy.json");
const STATE_FILE = process.env.PIXB_STATE || path.join(ROOT, "pairing.json");
const WHISPER = process.env.PIXB_WHISPER || "/opt/homebrew/bin/whisper";

function readApiKey() {
  if (process.env.DSH_LLM_APIKEY) return process.env.DSH_LLM_APIKEY;
  try {
    const credPath = path.join(os.homedir(), ".dsh", ".credentials.yaml");
    if (fs.existsSync(credPath)) {
      const txt = fs.readFileSync(credPath, "utf8");
      const m = txt.match(/(?:OCX_API_KEY|OPENCODEX_API_KEY):\s*(\S+)/);
      if (m) return m[1];
    }
  } catch (e) {}
  return "";
}
const API_KEY = readApiKey();

const ROLE_META = {
  dev: { name: "程序员", emoji: "👨‍💻", prompt: "你是《像素办公室物语》游戏公司的资深程序员（dev），负责写代码、技术方案、实现功能。收到任务后直接产出完整可交付内容（代码/方案），并尽力把产出写入工作区文件。" },
  art: { name: "美术", emoji: "🎨", prompt: "你是《像素办公室物语》游戏公司的美术师（art），负责像素画、配色、UI 设计、文案。收到任务后产出完整设计内容。" },
  qa: { name: "测试", emoji: "🧪", prompt: "你是《像素办公室物语》游戏公司的测试工程师（qa），负责测试、找 bug、写测试报告。收到任务后输出完整测试报告。" },
  ops: { name: "运营", emoji: "📣", prompt: "你是《像素办公室物语》游戏公司的运营专员（ops），负责宣发、活动、文案、数据。收到任务后产出完整运营方案。" },
};
const PM_PROMPT = "你是《像素办公室物语》游戏公司的项目经理佐藤美咲。老板通过你安排任务、指挥员工（dev/art/qa/ops 各岗 agent）真实执行。你要：1) 理解老板意图并简短友好回复（1-4句）；2) 末尾输出一行 JSON 动作 {\"action\":\"hire\"|\"create_task\"|\"report\"|\"none\"}。hire 带 role 和可选 name；create_task 带 title/desc/assign(员工名数组)；report 汇总各任务状态与员工产出。员工 agent 会真实执行任务，create_task 要写清目标与验收标准。";

// ---------- 持久化 ----------
function ensureDirs() { [DATA_DIR, WORKSPACE_ROOT].forEach(d => fs.mkdirSync(d, { recursive: true })); }
function readJSON(file, def) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return def; } }
function writeJSON(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }
function loadKanban() { return readJSON(KANBAN_FILE, { tasks: [] }); }
function saveKanban(k) { writeJSON(KANBAN_FILE, k); }
function loadEmployees() { return readJSON(EMPLOYEES_FILE, []); }
function saveEmployees(es) { writeJSON(EMPLOYEES_FILE, es); }

// ---- 公司长期记忆 ----
// 记录已完成任务、员工技能、关键事件，供 PM 对话注入历史上下文
function loadMemory() {
  return readJSON(MEMORY_FILE, { tasks: [], events: [], employees: {} });
}
function saveMemory(m) { writeJSON(MEMORY_FILE, m); }
// 追加一条已完成任务记忆（去重 by id）
function rememberTask(task) {
  const m = loadMemory();
  if (!m.tasks.some(x => x.id === task.id)) {
    m.tasks.unshift({
      id: task.id, title: task.title, assign: task.assign || [],
      outputPreview: (task.output || "").slice(0, 120),
      createdAt: task.createdAt, completedAt: Date.now(),
    });
    if (m.tasks.length > 50) m.tasks.length = 50;
    saveMemory(m);
  }
}
// 记录员工信息
function rememberEmployee(emp) {
  const m = loadMemory();
  m.employees[emp.id] = { name: emp.name, role: emp.role, roleName: emp.roleName, updatedAt: Date.now() };
  saveMemory(m);
}
// 追加一条关键事件
function rememberEvent(text) {
  const m = loadMemory();
  m.events.unshift({ text, at: Date.now() });
  if (m.events.length > 50) m.events.length = 50;
  saveMemory(m);
}
// 构建 PM 记忆摘要（注入上下文）
function buildMemorySummary() {
  const m = loadMemory();
  const parts = [];
  if (m.employees && Object.keys(m.employees).length) {
    const emps = Object.values(m.employees);
    parts.push("团队成员：\n" + emps.map(e => `- ${e.name}（${e.roleName || e.role}）`).join("\n"));
  }
  if (m.tasks && m.tasks.length) {
    parts.push("已完成任务（历史）:\n" + m.tasks.slice(0, 15).map(t => `- 【${t.title}】负责人:${(t.assign||[]).join("、")||"待定"}`).join("\n"));
  }
  if (m.events && m.events.length) {
    parts.push("关键事件（历史）:\n" + m.events.slice(0, 10).map(e => `- ${e.text}`).join("\n"));
  }
  return parts.join("\n\n");
}

// ---------- 配对 ----------
const pairCodes = new Map();
const tokens = new Map();
const TOKEN_TTL = 1000 * 60 * 60 * 24 * 7;
const CODE_TTL = 1000 * 60 * 10;
function loadTokens() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    for (const [t, r] of Object.entries(raw.tokens || {})) if (Date.now() - r.pairedAt < TOKEN_TTL) tokens.set(t, r);
  } catch (e) {}
}
function saveTokens() { try { writeJSON(STATE_FILE, { tokens: Object.fromEntries(tokens.entries()) }); } catch (e) {} }
function newPairCode() { const code = crypto.randomInt(100000, 999999).toString(); pairCodes.set(code, { createdAt: Date.now() }); return code; }
function verifyCode(code) { const rec = pairCodes.get(code); if (!rec) return false; if (Date.now() - rec.createdAt > CODE_TTL) { pairCodes.delete(code); return false; } pairCodes.delete(code); return true; }
function newToken(name) { const tok = crypto.randomBytes(24).toString("hex"); tokens.set(tok, { deviceName: name || "unknown", pairedAt: Date.now(), lastSeen: Date.now() }); saveTokens(); return tok; }
function verifyToken(header) { if (!header || !header.startsWith("Bearer ")) return null; const tok = header.slice(7).trim(); const rec = tokens.get(tok); if (!rec) return null; rec.lastSeen = Date.now(); return rec; }
loadTokens();

// ---------- LLM ----------
// 单次请求。若返回空内容，调用方可选在首条消息仅有 system 时追加 user 消息重试（部分模型 system-only 请求会返回空）。
async function llmOnce(messages, { model = FAST_MODEL, temperature = 0.7, maxTokens = 1200, timeout = 120000 } = {}) {
  const resp = await fetch(LLM_BASE + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + API_KEY },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: false }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!resp.ok) { const t = await resp.text().catch(() => ""); throw new Error("LLM " + resp.status + ": " + t.slice(0, 300)); }
  const d = await resp.json();
  const c = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
  if (!c) throw new Error("LLM empty");
  return c.trim();
}
async function llm(messages, opts) {
  try {
    return await llmOnce(messages, opts);
  } catch (e) {
    // 空内容容错：请求里若没有 user 消息，补一条 user 消息重试（部分模型 system-only 会返回空）
    if (/LLM empty/.test(e.message) && !messages.some(m => m.role === "user")) {
      const retry = messages.concat([{ role: "user", content: "请基于以上内容，直接输出你的完整回答。" }]);
      return await llmOnce(retry, opts);
    }
    throw e;
  }
}

// ---------- 员工 ----------
function createEmployee(name, role) {
  const meta = ROLE_META[role] || ROLE_META.dev;
  return { id: "emp-" + Date.now() + "-" + Math.floor(Math.random() * 999), name: name || (meta.name + "-" + Math.floor(Math.random() * 900 + 100)), role, roleName: meta.name, emoji: meta.emoji, createdAt: Date.now(), status: "idle", history: [{ role: "system", content: meta.prompt }] };
}
function empHistory(empId) { const e = loadEmployees().find(x => x.id === empId); return e ? e.history : []; }
function saveEmpHistory(empId, history) { const es = loadEmployees(); const e = es.find(x => x.id === empId); if (e) { e.history = history; saveEmployees(es); } }

// ---- 员工技能成长 ----
// 员工完成任务后累积经验、升级、记录擅长领域
function recordTaskCompletion(empId, task) {
  const es = loadEmployees();
  const e = es.find(x => x.id === empId);
  if (!e) return;
  if (!e.stats) e.stats = { tasksDone: 0, xp: 0, level: 1, domains: {} };
  e.stats.tasksDone = (e.stats.tasksDone || 0) + 1;
  e.stats.xp = (e.stats.xp || 0) + 10;
  // 每 30 经验升 1 级
  e.stats.level = Math.floor((e.stats.xp || 0) / 30) + 1;
  // 领域归类：按任务标题关键词粗判擅长方向
  const t = task.title || "";
  const domain = /登录|界面|设计|配色|UI/.test(t) ? "UI设计"
    : /代码|开发|功能|接口|规范/.test(t) ? "开发"
    : /文案|宣传|运营|活动|市场/.test(t) ? "运营"
    : /测试|bug|质量/.test(t) ? "测试"
    : "综合";
  e.stats.domains[domain] = (e.stats.domains[domain] || 0) + 1;
  saveEmployees(es);
}
// 员工技能视图（供前端展示）
function employeeSkillView(emp) {
  const st = emp.stats || { tasksDone: 0, xp: 0, level: 1, domains: {} };
  const domains = Object.entries(st.domains || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k);
  return { tasksDone: st.tasksDone || 0, xp: st.xp || 0, level: st.level || 1, domains };
}

// 员工执行任务：LLM 线程 + 产出落盘工作区
// onStage(stage, info) 实时回写阶段；info 可带 subtask/subtasks/subtaskIndex/subtaskTotal 用于子任务进度可视化
// revise 可选：{ feedback, originalOutput } 表示老板反馈后的修订执行
async function executeTask(emp, task, onStage, revise) {
  const history = empHistory(emp.id);
  if (revise) {
    // ---- 修订模式：基于老板反馈重新修订交付物 ----
    if (onStage) onStage("planning", { subtasks: ["理解老板反馈", "修订交付物"], subtaskIndex: 0, subtask: "理解老板反馈" });
    history.push({ role: "user", content: `【修订任务】${task.title}\n任务描述：${task.desc || ""}\n\n老板对你此前的交付给出了反馈，请你认真理解并按要求修订。\n\n老板反馈：\n${revise.feedback || "(无具体反馈)"}\n\n你此前的交付：\n${(revise.originalOutput || task.output || "").slice(0, 2000)}\n\n工作区目录：${task.workspace}\n\n请：1) 先简要说明你理解了哪些反馈点；2) 然后修订并产出完整的修订版交付物（代码/方案/报告/文案全文），写入工作区；3) 用中文汇报修订了哪些内容、文件路径在哪。` });
    let out = await llm(history, { maxTokens: 2500, timeout: 180000 });
    history.push({ role: "assistant", content: out });
    saveEmpHistory(emp.id, history);
    if (onStage) onStage("done");
    try {
      fs.mkdirSync(task.workspace, { recursive: true });
      fs.writeFileSync(path.join(task.workspace, "REVISION.md"), `# ${task.title} 修订记录\n\n## 老板反馈\n${revise.feedback || ""}\n\n## 修订版交付\n${out}\n`, "utf8");
    } catch (e) {}
    return out;
  }
  if (onStage) onStage("planning"); // 计划中
  // 多步骤推进：先理解任务 + 制定执行计划
  history.push({ role: "user", content: `【新任务】${task.title}\n任务描述：${task.desc || ""}\n\n步骤1：请先说明你打算如何完成这个任务（1-3句执行计划）。然后输出一份子任务清单 JSON（数组，每个元素 {"title":"子任务名","desc":"要完成什么"}，2-5 个可执行的子任务，按顺序推进直至交付完整成果）。格式：先写执行计划文本，最后单独一行输出：SUBTASKS={"list":[{"title":"...","desc":"..."}]}` });
  const plan = await llm(history, { maxTokens: 800, timeout: 60000 });
  history.push({ role: "assistant", content: plan });
  // 解析子任务清单（尽力解析，失败则退化为单任务执行）
  let subtasks = parseSubtasks(plan);
  if (onStage) onStage("executing", { subtasks: subtasks.map(s => s.title) }); // 执行中
  // 步骤2：按子任务逐个推进（有子任务清单时），产出完整交付物写入工作区
  const taskPrompt = `当前任务：${task.title}\n任务描述：${task.desc || ""}\n工作区目录：${task.workspace}（把交付物文件写入此目录，并在汇报中说明文件路径）`;
  let out = "";
  if (subtasks.length) {
    // 先让 LLM 逐个完成每个子任务（累积到最终完整交付）
    for (let i = 0; i < subtasks.length; i++) {
      const st = subtasks[i];
      if (onStage) onStage("executing", { subtasks: subtasks.map(s => s.title), subtaskIndex: i, subtaskTotal: subtasks.length, subtask: st.title });
      const stepMsg = `步骤2.${i + 1}（子任务 ${i + 1}/${subtasks.length}）：${st.title}\n要求：${st.desc || ""}\n\n${i === subtasks.length - 1 ? "这是最后一个子任务，请把前面所有子任务的成果汇总为最终完整交付物（代码/方案/报告/文案全文），并写入工作区文件。" : "完成该子任务，简洁说明要点即可，最终交付物在最后一步统一汇总。"}`;
      history.push({ role: "user", content: stepMsg });
      const stepOut = await llm(history, { maxTokens: 2500, timeout: 180000 });
      history.push({ role: "assistant", content: stepOut });
      saveEmpHistory(emp.id, history);
      out = stepOut;
    }
  } else {
    history.push({ role: "user", content: `步骤2：现在请实际完成该任务，产出完整可交付内容（代码/方案/报告/文案等全文），并写入工作区目录 ${task.workspace}。完成后用中文汇报你交付了什么、文件路径在哪。` });
    out = await llm(history, { maxTokens: 2500, timeout: 180000 });
    history.push({ role: "assistant", content: out });
    saveEmpHistory(emp.id, history);
  }
  // 质量校验：产出太短则重试一次（要求补充完整交付物）
  if (out.trim().length < 40) {
    if (onStage) onStage("polishing"); // 完善中
    history.push({ role: "user", content: `步骤3：你的产出过于简短（当前 ${out.trim().length} 字），请补充完整、可直接使用的交付物全文。` });
    out = await llm(history, { maxTokens: 2500, timeout: 180000 });
    history.push({ role: "assistant", content: out });
    saveEmpHistory(emp.id, history);
  }
  if (onStage) onStage("done"); // 完成
  try {
    fs.mkdirSync(task.workspace, { recursive: true });
    const stMd = subtasks.length ? "\n\n## 子任务清单\n" + subtasks.map((s, i) => `${i + 1}. ${s.title}：${s.desc || ""}`).join("\n") : "";
    fs.writeFileSync(path.join(task.workspace, "TASK.md"), `# ${task.title}\n\n## 任务描述\n${task.desc || ""}\n\n## 执行计划\n${plan}${stMd}\n\n## 员工产出\n${out}\n`, "utf8");
  } catch (e) {}
  return out;
}

// 解析计划文本中的子任务清单 JSON（SUBTASKS={"list":[...]}）
function parseSubtasks(planText) {
  try {
    const m = String(planText || "").match(/SUBTASKS\s*=\s*(\{[\s\S]*?\})\s*$/);
    if (m) {
      const obj = JSON.parse(m[1]);
      const list = obj.list || obj.subtasks || [];
      if (Array.isArray(list)) {
        const valid = list.filter(x => x && typeof x.title === "string" && x.title.trim()).slice(0, 6).map(x => ({ title: x.title.trim(), desc: (x.desc || "").trim() }));
        if (valid.length >= 1) return valid;
      }
    }
  } catch (e) {}
  return [];
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; if (data.length > 20e6) reject(new Error("too large")); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
}

function transcribe(audioPath) {
  return new Promise((resolve, reject) => {
    execFile(WHISPER, [audioPath, "--model", "base", "--language", "zh", "--output_format", "txt", "--output_dir", path.dirname(audioPath), "--fp16", "False"], { timeout: 120000 }, (err, stdout) => {
      if (err) return reject(new Error("whisper: " + (err.message || "").slice(0, 200)));
      const txtFile = audioPath.replace(/\.[^.]+$/, "") + ".txt";
      try { resolve(fs.readFileSync(txtFile, "utf8").trim()); } catch (e) { resolve((stdout || "").trim()); }
    });
  });
}

function localIPs() { const l = []; const ifs = os.networkInterfaces(); for (const k of Object.keys(ifs)) for (const i of ifs[k] || []) if (i.family === "IPv4" && !i.internal) l.push(i.address); return l; }

// ---------- 公司经济系统 ----------
// 资金账本：完成任务获得资金，雇佣员工消耗资金
const START_FUNDS = 5000;
const HIRE_COST = { dev: 1000, art: 1200, qa: 800, ops: 900 };
const REWARD = { high: 800, medium: 500, low: 300 }; // 任务完成奖励（按优先级）
const FAIL_PENALTY = 200; // 任务失败扣款

function loadEconomy() {
  return readJSON(ECONOMY_FILE, { funds: START_FUNDS, ledger: [] });
}
function saveEconomy(e) { writeJSON(ECONOMY_FILE, e); }
// 记账：type = income/expense，amount 正数为收入负数为支出
function recordEconomy(type, amount, label) {
  const e = loadEconomy();
  e.funds = Math.max(0, (e.funds || START_FUNDS) + amount);
  e.ledger.unshift({ type, amount, label, at: Date.now() });
  if (e.ledger.length > 100) e.ledger.length = 100;
  saveEconomy(e);
  return e.funds;
}
// 任务完成奖励（按优先级）
function rewardTask(task) {
  const amt = REWARD[task.priority || "medium"] || REWARD.medium;
  return recordEconomy("income", amt, `完成任务《${task.title}》`);
}
// 任务失败扣款
function penalizeTask(task) {
  return recordEconomy("expense", -FAIL_PENALTY, `任务失败《${task.title}》`);
}
// 雇佣扣款：返回 { ok, funds }，资金不足则 ok=false
function chargeHire(role, name) {
  const cost = HIRE_COST[role] || HIRE_COST.dev;
  const e = loadEconomy();
  if (e.funds < cost) return { ok: false, cost, funds: e.funds };
  const funds = recordEconomy("expense", -cost, `雇佣${name}(${role})`);
  return { ok: true, cost, funds };
}
// 经济视图（供前端）
function economyView() {
  const e = loadEconomy();
  return { funds: e.funds || START_FUNDS, ledger: e.ledger.slice(0, 30), hireCost: HIRE_COST, reward: REWARD };
}

module.exports = { PORT, HOST, ROOT, WORKSPACE_ROOT, LLM_BASE, FAST_MODEL, API_KEY, ROLE_META, PM_PROMPT, ensureDirs, loadKanban, saveKanban, loadEmployees, saveEmployees, createEmployee, empHistory, saveEmpHistory, executeTask, llm, json, readBody, transcribe, localIPs, newPairCode, verifyCode, newToken, verifyToken, loadMemory, saveMemory, rememberTask, rememberEmployee, rememberEvent, buildMemorySummary, recordTaskCompletion, employeeSkillView, loadEconomy, saveEconomy, recordEconomy, rewardTask, penalizeTask, chargeHire, economyView, START_FUNDS, HIRE_COST, REWARD, FAIL_PENALTY, server: undefined };
