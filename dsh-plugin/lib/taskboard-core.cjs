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
async function llm(messages, { model = FAST_MODEL, temperature = 0.7, maxTokens = 1200, timeout = 120000 } = {}) {
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

// ---------- 员工 ----------
function createEmployee(name, role) {
  const meta = ROLE_META[role] || ROLE_META.dev;
  return { id: "emp-" + Date.now() + "-" + Math.floor(Math.random() * 999), name: name || (meta.name + "-" + Math.floor(Math.random() * 900 + 100)), role, roleName: meta.name, emoji: meta.emoji, createdAt: Date.now(), status: "idle", history: [{ role: "system", content: meta.prompt }] };
}
function empHistory(empId) { const e = loadEmployees().find(x => x.id === empId); return e ? e.history : []; }
function saveEmpHistory(empId, history) { const es = loadEmployees(); const e = es.find(x => x.id === empId); if (e) { e.history = history; saveEmployees(es); } }

// 员工执行任务：LLM 线程 + 产出落盘工作区
async function executeTask(emp, task, onStage) {
  const history = empHistory(emp.id);
  if (onStage) onStage("planning"); // 计划中
  // 多步骤推进：先理解任务 + 制定执行计划
  history.push({ role: "user", content: `【新任务】${task.title}\n任务描述：${task.desc || ""}\n\n步骤1：请先说明你打算如何完成这个任务（1-3句执行计划），并给出你要产出的交付物清单。` });
  const plan = await llm(history, { maxTokens: 600, timeout: 60000 });
  history.push({ role: "assistant", content: plan });
  if (onStage) onStage("executing"); // 执行中
  // 步骤2：实际执行并产出完整交付物，写入工作区
  history.push({ role: "user", content: `步骤2：现在请实际完成该任务，产出完整可交付内容（代码/方案/报告/文案等全文），并写入工作区目录 ${task.workspace}。完成后用中文汇报你交付了什么、文件路径在哪。` });
  let out = await llm(history, { maxTokens: 2500, timeout: 180000 });
  history.push({ role: "assistant", content: out });
  saveEmpHistory(emp.id, history);
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
    fs.writeFileSync(path.join(task.workspace, "TASK.md"), `# ${task.title}\n\n## 任务描述\n${task.desc || ""}\n\n## 执行计划\n${plan}\n\n## 员工产出\n${out}\n`, "utf8");
  } catch (e) {}
  return out;
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

module.exports = { PORT, HOST, ROOT, WORKSPACE_ROOT, LLM_BASE, FAST_MODEL, API_KEY, ROLE_META, PM_PROMPT, ensureDirs, loadKanban, saveKanban, loadEmployees, saveEmployees, createEmployee, empHistory, saveEmpHistory, executeTask, llm, json, readBody, transcribe, localIPs, newPairCode, verifyCode, newToken, verifyToken, server: undefined };
