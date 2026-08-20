// dsh-pixel-office-bridge 服务模块（ESM）
//
// DSH ↔ 像素办公室物语（DSH 任务编排版）桥接服务。
//
// 本服务把 DSH harness 的真实能力暴露给手机 APK 游戏：
//   - 员工 = 真实 DSH continuable 子代理（subagents.startContinuable，带岗位 persona）
//   - 任务 = 真实 DSH 任务，通过 followup 派发给员工 agent 去执行
//   - PM 汇报 = 读取子代理会话日志（sessionQuery.readSession）汇总真实工作结果
//
// 接口（均需配对 token）：
//   GET  /health                健康检查
//   POST /pair/request          获取配对码
//   POST /pair/confirm          确认配对换取 token
//   GET  /devices               已配对设备
//   POST /device/revoke         撤销设备
//   ---- DSH 任务编排 ----
//   GET  /v1/agents             列出已雇佣员工（真实子代理）
//   POST /v1/agents/hire        雇佣员工：创建 continuable 子代理（role: dev|art|qa|ops）
//   POST /v1/agents/fire        解雇员工：释放子代理
//   POST /v1/tasks              创建任务并指派给一个或多个员工
//   GET  /v1/tasks              列出任务 + 员工实时状态
//   POST /v1/tasks/{id}/assign  指派任务给员工
//   GET  /v1/tasks/{id}/logs    读取某任务相关的员工会话日志（供 PM 汇报）
//   POST /v1/pm/report          PM 汇报：汇总所有任务与员工状态
//   POST /v1/pm/chat            老板 ↔ PM 对话（LLM 解读意图 + 调度动作）
//
// 独立运行（调试/无 DSH 时）：
//   node lib/server.js [--port 8866]   （此时无子代理能力，任务 API 返回"未连接 DSH"）

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const PORT = parseInt(process.env.BRIDGE_PORT || "8866", 10);
export const HOST = process.env.BRIDGE_HOST || "0.0.0.0";
const LLM_BASE = process.env.DSH_LLM_BASE || "http://127.0.0.1:10100/v1";
const LLM_MODEL = process.env.DSH_LLM_MODEL || "wps-ai/deepseek/deepseek-v4-flash-0731";

// ---- 岗位 persona（员工 agent 的系统提示，随子代理创建注入） ----
// 员工工作区：所有产出（文件/文档/代码）统一落到这里，方便 PM 与老板查看
const WORKSPACE = process.env.PIXEL_WORKSPACE || "/Users/zichao/data/tmp/pixel-office-story/employees";
// 提示：优先尝试写文件；若环境未提供文件/bash 工具，则直接在回复中产出完整可交付内容
const WS_HINT = "如果当前会话提供了本地文件写入或 bash 工具，请把产出实际写入 " + WORKSPACE + " 目录并给出文件路径；如果环境没有这些工具，就把完整成果直接写在回复正文里（代码/方案/报告全文），确保交付内容完整可用，不要只写'已准备内容'却不给出全文。";
const ROLE_META = {
  dev: { name: "程序员", emoji: "👨‍💻", prompt: "你是《像素办公室物语》游戏公司的一名资深程序员（dev）。老板通过项目经理给你派发开发任务。你要：1) 认真理解任务需求；2) 用你的专业技能实际产出结果（完整代码、分析、方案、文档等）；3) 完成后用简洁的中文汇报你做了什么、产出在哪里。你的最后一条回复必须包含完整可交付内容。" + WS_HINT },
  art: { name: "美术", emoji: "🎨", prompt: "你是《像素办公室物语》游戏公司的一名美术师（art）。老板通过项目经理给你派发美术任务。你要：1) 认真理解任务需求；2) 产出美术相关成果（像素画方案、配色设计、UI 设计文档、Sprite 描述等，内容要完整具体）；3) 完成后用简洁的中文汇报你设计了什么。你的最后一条回复必须包含完整可交付内容。" + WS_HINT },
  qa: { name: "测试", emoji: "🧪", prompt: "你是《像素办公室物语》游戏公司的一名测试工程师（qa）。老板通过项目经理给你派发测试任务。你要：1) 认真理解被测内容；2) 实际执行测试/审查（检查代码、跑命令、找问题）；3) 输出完整测试报告：发现的问题、严重级别、复现步骤、建议。完成后用简洁的中文汇报。你的最后一条回复必须包含完整测试报告。" + WS_HINT },
  ops: { name: "运营", emoji: "📣", prompt: "你是《像素办公室物语》游戏公司的一名运营专员（ops）。老板通过项目经理给你派发运营任务。你要：1) 认真理解运营需求；2) 产出运营方案（宣发文案、活动策划、数据分析、竞品调研等，内容要完整具体）；3) 完成后用简洁的中文汇报你的产出。你的最后一条回复必须包含完整可交付内容。" + WS_HINT },
};

// ---- 读取 API key ----
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

const STATE_FILE = process.env.BRIDGE_STATE || path.join(os.homedir(), ".dsh", "pixel-office-bridge-state.json");
const pairCodes = new Map();
const tokens = new Map();
const TOKEN_TTL = 1000 * 60 * 60 * 24 * 7;
const CODE_TTL = 1000 * 60 * 10;

function loadTokens() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      for (const [t, r] of Object.entries(raw.tokens || {})) {
        if (Date.now() - r.pairedAt < TOKEN_TTL) tokens.set(t, r);
      }
    }
  } catch (e) {}
}
function saveTokens() {
  try {
    const obj = { tokens: Object.fromEntries(tokens.entries()) };
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {}
}
function newPairCode() {
  const code = crypto.randomInt(100000, 999999).toString();
  pairCodes.set(code, { createdAt: Date.now() });
  return code;
}
function verifyCode(code) {
  const rec = pairCodes.get(code);
  if (!rec) return false;
  if (Date.now() - rec.createdAt > CODE_TTL) { pairCodes.delete(code); return false; }
  pairCodes.delete(code);
  return true;
}
function newToken(deviceName) {
  const tok = crypto.randomBytes(24).toString("hex");
  tokens.set(tok, { deviceName: deviceName || "unknown", pairedAt: Date.now(), lastSeen: Date.now() });
  saveTokens();
  return tok;
}
function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const tok = authHeader.slice(7).trim();
  const rec = tokens.get(tok);
  if (!rec) return null;
  rec.lastSeen = Date.now();
  return rec;
}
loadTokens();

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 5e6) reject(new Error("body too large")); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
}
async function callLLM(messages, opts = {}) {
  const model = opts.model || LLM_MODEL;
  const payload = { model, messages, temperature: opts.temperature ?? 0.7, max_tokens: opts.maxTokens || 800, stream: false };
  const resp = await fetch(LLM_BASE + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + API_KEY },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(opts.timeout || 60000),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error("LLM " + resp.status + ": " + errText.slice(0, 500));
  }
  const data = await resp.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error("LLM empty response");
  return content.trim();
}

// ============================================================
// DSH 集成层：员工 agent + 任务编排
// createBridgeServer(ctx) 在 DSH 插件上下文内调用，获得真实服务；
// 无 ctx 时（独立运行）这些能力降级，返回"未连接 DSH"。
// ============================================================
let dshCtx = null; // 由 createBridgeServer(ctx) 注入
let parentAgent = null;
let parentHandle = null; // 稳定 parent agent 的 handle（需 dispose）

// 稳定的"公司负责人"会话 id —— 重启后恢复同一 parent，员工子代理归属稳定
// v3：code 预设版本（让员工子代理继承 bash/fs 完整工具）
const COMPANY_LEAD_SESSION = "pixel-office-company-lead-v3";

// 建立/恢复稳定的 parent agent
async function ensureParentAgent(ctx) {
  const agents = ctx.get("agents");
  if (!agents) return null;
  // 已在 live registry（本进程内已建立过）
  const existing = agents.get(COMPANY_LEAD_SESSION);
  if (existing) {
    parentAgent = existing;
    return existing;
  }
  try {
    const handle = await agents.create({
      sessionId: COMPANY_LEAD_SESSION,
      agentOptions: { provider: "ocx", model: LLM_MODEL },
      // 挂载 code 预设，让员工子代理继承 bash/fs 等完整工具
      meta: { cwd: (typeof process !== "undefined" && process.cwd) ? process.cwd() : os.homedir(), agentPreset: "code" },
    });
    parentHandle = handle;
    parentAgent = handle.agent;
    return handle.agent;
  } catch (e) {
    // 已持久化的会话可能无法 create（重复），尝试从 registry get
    try {
      const got = agents.get(COMPANY_LEAD_SESSION);
      if (got) { parentAgent = got; return got; }
    } catch (e2) {}
    return null;
  }
}

function haveDSH() {
  return !!dshCtx && !!parentAgent;
}
// 惰性确保 parent agent（请求到达时若尚未就绪则重试建立）
async function ensureParent() {
  if (!dshCtx) return false;
  if (!parentAgent) {
    try { await ensureParentAgent(dshCtx); } catch (e) { return false; }
  }
  return !!parentAgent;
}
function dshUnavailable() {
  return { ok: false, error: "未连接 DSH（桥接服务未在 DSH 宿主内运行），无法编排真实 agent。请通过 DSH 插件方式启动桥接。" };
}

// 从 childId 读取子代理会话最近文本（供汇报）
// 事件结构：assistant/message -> e.data.message.content[]；user/message -> e.data.content[]
function extractEventText(e) {
  try {
    let blocks = null;
    if (e.type === "assistant/message" && e.data && e.data.message) {
      blocks = e.data.message.content;
    } else if (e.type === "user/message" && e.data) {
      const content = e.data.content;
      if (Array.isArray(content)) blocks = content;
      else if (content && typeof content === "object" && Array.isArray(content.content)) blocks = content.content;
    } else if (e.type === "assistant/chunk" && e.data && e.data.chunk && e.data.chunk.type === "block-end" && e.data.chunk.block) {
      blocks = [e.data.chunk.block];
    }
    if (!Array.isArray(blocks)) return "";
    return blocks
      .filter(b => b && b.type === "text" && typeof b.text === "string")
      .map(b => b.text)
      .join(" ")
      .trim();
  } catch (err) {
    return "";
  }
}
async function readChildLatest(childId, limit = 4) {
  try {
    const sq = dshCtx.get("sessionQuery");
    if (!sq || !sq.readSession) return [];
    const snap = await sq.readSession(childId);
    const out = [];
    // 只取 assistant 回复（用户任务文本是输入，不重复展示）
    for (const e of snap.events) {
      if (e.type === "assistant/message") {
        const text = extractEventText(e);
        if (text) out.push(text);
      }
    }
    return out.slice(-limit);
  } catch (e) {
    return [];
  }
}

// 雇佣一名员工：创建 continuable 子代理
async function hireEmployee({ name, role }) {
  if (!(await ensureParent())) throw new Error("DSH 未连接");
  const meta = ROLE_META[role] || ROLE_META.dev;
  const sub = dshCtx.get("subagents");
  if (!sub || !sub.startContinuable) throw new Error("DSH subagents 服务不可用");
  const ab = new AbortController();
  const start = await sub.startContinuable({
    provider: "spawn",
    label: `员工-${meta.name}`,
    request: {
      parent: parentAgent,
      prompt: [{ type: "text", text: meta.prompt + "\n\n你的名字：" + (name || "未命名") + "。" }],
      agentOptions: { provider: "ocx", model: LLM_MODEL },
      persona: meta.prompt,
    },
    signal: ab.signal,
  });
  return {
    id: start.childId,
    name: name || (meta.name + "-" + Math.floor(Math.random() * 900 + 100)),
    role,
    roleName: meta.name,
    emoji: meta.emoji,
    status: "provisioning",
    createdAt: Date.now(),
  };
}

// 给员工 agent 派发任务
async function assignTaskToEmployee(childId, taskText) {
  if (!(await ensureParent())) throw new Error("DSH 未连接");
  const sub = dshCtx.get("subagents");
  if (!sub || !sub.followup) throw new Error("DSH subagents 服务不可用");
  const ab = new AbortController();
  const mid = await sub.followup(parentAgent, childId, [{ type: "text", text: taskText }], {
    source: { kind: "user", userId: "boss" },
    signal: ab.signal,
  });
  return { messageId: mid };
}

// 列出子代理
async function listChildren() {
  if (!haveDSH()) return [];
  const sub = dshCtx.get("subagents");
  if (!sub || !sub.listChildren) return [];
  try {
    const list = await sub.listChildren(parentAgent.id);
    return list.filter(c => c.kind === "child").map(c => ({ id: c.id, mode: c.mode, label: c.label, activity: c.activity }));
  } catch (e) {
    return [];
  }
}

function localIPs() {
  const list = [];
  const ifs = os.networkInterfaces();
  for (const k of Object.keys(ifs)) {
    for (const i of ifs[k] || []) {
      if (i.family === "IPv4" && !i.internal) list.push(i.address);
    }
  }
  return list;
}

// ---- PM 系统提示词（任务编排版）----
function buildPMSystemPrompt(team, tasks) {
  return [
    "你是《像素办公室物语》游戏里的项目经理「佐藤美咲」，一位干练、体贴、带点日式语气的游戏项目经理。",
    "这个版本的游戏已接入真实 DeepSeek harness：你的「员工」都是真实运行的 AI agent，每个都有明确岗位（程序员/美术/测试/运营）。",
    "老板（用户）通过聊天跟你交流，你的职责是：",
    "1. 理解老板意图，给出自然、有人情味的中文回复（简短，1-4句）。",
    "2. 在回复的末尾用一行 JSON 输出你想执行的动作（没有动作就输出 {\"action\":\"none\"}）。",
    "可执行动作：",
    "  {\"action\":\"hire\",\"role\":\"dev|art|qa|ops\"}  雇佣对应岗位的员工 agent",
    "  {\"action\":\"create_task\",\"title\":\"...\",\"desc\":\"...\",\"assign\":[\"员工名字\"]}  创建任务并指派给指定员工",
    "  {\"action\":\"report\"}  汇报当前所有任务与员工状态",
    "  {\"action\":\"none\"}  仅闲聊，不执行动作",
    "判断规则：",
    "- 老板说「招人/招程序员/招美术/招测试/招运营」→ hire（dev=程序员，art=美术，qa=测试，ops=运营）",
    "- 老板布置任务/说「安排/分配/去做/开发XX/写XX/测试XX」→ create_task，title 用简短标题，desc 用完整任务描述，assign 填写合适岗位的员工名字",
    "- 老板说「汇报/进度/情况/怎么样了」→ report",
    "- 其他闲聊 → none",
    "重要：员工 agent 会真实执行任务。create_task 时要写清任务目标与验收标准，这样员工才知道该产出什么。",
    "当前团队（JSON）：",
    JSON.stringify(team),
    "当前任务（JSON）：",
    JSON.stringify(tasks),
    "回复格式：你的说话内容，然后换行，最后一行单独输出 JSON 动作。",
  ].join("\n");
}

// ============================================================
// 服务创建
// ============================================================
export function createBridgeServer(ctx) {
  dshCtx = ctx || null;
  // 异步建立稳定的 parent agent（公司负责人）
  if (ctx) {
    ensureParentAgent(ctx).then((agent) => {
      if (agent) {
        console.log("[pixel-office-bridge] parent agent 就绪: " + agent.id);
      } else {
        console.log("[pixel-office-bridge] parent agent 建立失败（稍后请求时重试）");
      }
    }).catch((e) => {
      console.log("[pixel-office-bridge] parent agent 建立异常:", e.message);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;
    if (req.method === "OPTIONS") { send(res, 200, {}); return; }
    try {
      // ---- 公开接口 ----
      if (req.method === "GET" && pathname === "/health") {
        let llmReachable = false;
        try {
          const r = await fetch(LLM_BASE + "/models", { headers: { Authorization: "Bearer " + API_KEY }, signal: AbortSignal.timeout(5000) });
          llmReachable = r.ok;
        } catch (e) {}
        send(res, 200, { ok: true, service: "pixel-office-bridge", llm: LLM_BASE, model: LLM_MODEL, llmReachable, pairedDevices: tokens.size, dshConnected: haveDSH(), hostHints: localIPs(), time: new Date().toISOString() });
        return;
      }
      if (req.method === "POST" && pathname === "/pair/request") {
        const code = newPairCode();
        console.log("[pixel-office-bridge] 新配对码: " + code);
        send(res, 200, { ok: true, code, expiresInSec: 600, hostHints: localIPs() });
        return;
      }
      if (req.method === "POST" && pathname === "/pair/confirm") {
        const body = await readBody(req);
        const { code, deviceName } = body;
        if (!verifyCode(code)) { send(res, 401, { ok: false, error: "配对码无效或已过期" }); return; }
        const tok = newToken(deviceName || "pixel-office-app");
        send(res, 200, { ok: true, token: tok, model: LLM_MODEL, expiresInSec: Math.floor(TOKEN_TTL / 1000), dshConnected: haveDSH() });
        return;
      }
      if (req.method === "GET" && pathname === "/devices") {
        const rec = verifyToken(req.headers["authorization"]);
        if (!rec) { send(res, 401, { ok: false, error: "unauthorized" }); return; }
        send(res, 200, { ok: true, devices: [...tokens.entries()].map(([t, r]) => ({ device: r.deviceName, pairedAt: r.pairedAt, lastSeen: r.lastSeen })) });
        return;
      }
      if (req.method === "POST" && pathname === "/device/revoke") {
        const rec = verifyToken(req.headers["authorization"]);
        if (!rec) { send(res, 401, { ok: false, error: "unauthorized" }); return; }
        const body = await readBody(req);
        const target = body.device;
        for (const [t, r] of tokens.entries()) if (r.deviceName === target) tokens.delete(t);
        saveTokens();
        send(res, 200, { ok: true });
        return;
      }

      // ---- 以下接口需要配对 ----
      const rec = verifyToken(req.headers["authorization"]);
      if (!rec) { send(res, 401, { ok: false, error: "未授权，请先配对" }); return; }

      // ---- DSH 任务编排 ----
      if (req.method === "GET" && pathname === "/v1/agents") {
        if (!(await ensureParent())) { send(res, 503, dshUnavailable()); return; }
        const children = await listChildren();
        send(res, 200, { ok: true, dshConnected: true, agents: children });
        return;
      }

      if (req.method === "POST" && pathname === "/v1/agents/hire") {
        if (!(await ensureParent())) { send(res, 503, dshUnavailable()); return; }
        const body = await readBody(req);
        const emp = await hireEmployee({ name: body.name, role: body.role || "dev" });
        send(res, 200, { ok: true, employee: emp });
        return;
      }

      if (req.method === "POST" && pathname === "/v1/agents/fire") {
        if (!(await ensureParent())) { send(res, 503, dshUnavailable()); return; }
        const body = await readBody(req);
        const sub = dshCtx.get("subagents");
        if (sub && sub.drainContinuableChildren && body.id) {
          try { await sub.drainContinuableChildren(parentAgent, [body.id]); } catch (e) {}
        }
        send(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && pathname === "/v1/tasks") {
        if (!(await ensureParent())) { send(res, 503, dshUnavailable()); return; }
        const body = await readBody(req);
        const { title, desc, assign } = body;
        if (!title) { send(res, 400, { ok: false, error: "title required" }); return; }
        const children = await listChildren();
        const taskId = "task-" + Date.now() + "-" + Math.floor(Math.random() * 999);
        const results = [];
        const assignees = Array.isArray(assign) ? assign : [];
        for (const name of assignees) {
          const child = children.find(c => (c.label || "").includes(name) || (c.label || "").includes("员工"));
          if (child) {
            try {
              const r = await assignTaskToEmployee(child.id, `【新任务】${title}\n任务描述：${desc || ""}\n\n请实际执行并完成后用中文汇报结果。`);
              results.push({ name, childId: child.id, messageId: r.messageId, status: "assigned" });
            } catch (e) {
              results.push({ name, childId: child.id, error: e.message, status: "failed" });
            }
          } else {
            results.push({ name, status: "not-found", error: "未找到名为 " + name + " 的员工" });
          }
        }
        send(res, 200, { ok: true, taskId, title, desc, results });
        return;
      }

      if (req.method === "GET" && pathname === "/v1/tasks") {
        if (!(await ensureParent())) { send(res, 503, dshUnavailable()); return; }
        const children = await listChildren();
        const tasks = [];
        for (const c of children) {
          const logs = await readChildLatest(c.id, 3);
          tasks.push({ id: c.id, label: c.label, activity: c.activity, recent: logs });
        }
        send(res, 200, { ok: true, tasks });
        return;
      }

      if (req.method === "POST" && pathname === "/v1/tasks/assign") {
        if (!(await ensureParent())) { send(res, 503, dshUnavailable()); return; }
        const body = await readBody(req);
        const { childId, taskText } = body;
        if (!childId || !taskText) { send(res, 400, { ok: false, error: "childId + taskText required" }); return; }
        const r = await assignTaskToEmployee(childId, taskText);
        send(res, 200, { ok: true, messageId: r.messageId });
        return;
      }

      if (req.method === "GET" && pathname.startsWith("/v1/tasks/") && pathname.endsWith("/logs")) {
        if (!(await ensureParent())) { send(res, 503, dshUnavailable()); return; }
        const childId = pathname.slice("/v1/tasks/".length, -"/logs".length);
        const logs = await readChildLatest(childId, 8);
        send(res, 200, { ok: true, childId, logs });
        return;
      }

      if (req.method === "POST" && pathname === "/v1/pm/report") {
        if (!(await ensureParent())) { send(res, 503, dshUnavailable()); return; }
        const children = await listChildren();
        const team = [];
        for (const c of children) {
          const logs = await readChildLatest(c.id, 2);
          team.push({ id: c.id, label: c.label, activity: c.activity, recent: logs });
        }
        send(res, 200, { ok: true, report: "当前共有 " + team.length + " 名员工 agent 在岗。\n" + team.map(t => "- " + (t.label || t.id) + (t.activity === "running" ? "（工作中）" : "（空闲）")).join("\n") + "\n\n各员工最近工作：\n" + team.map(t => "【" + (t.label || t.id) + "】" + (t.recent.length ? t.recent[t.recent.length - 1] : "暂无产出")).join("\n") });
        return;
      }

      if (req.method === "POST" && pathname === "/v1/pm/chat") {
        const body = await readBody(req);
        const { messages, team, tasks } = body;
        if (!Array.isArray(messages) || !messages.length) { send(res, 400, { ok: false, error: "messages required" }); return; }
        const sys = buildPMSystemPrompt(team || [], tasks || []);
        const content = await callLLM([{ role: "system", content: sys }, ...messages], { temperature: body.temperature });
        send(res, 200, { ok: true, content, device: rec.deviceName, model: LLM_MODEL });
        return;
      }

      send(res, 404, { ok: false, error: "not found: " + pathname });
    } catch (e) {
      send(res, 500, { ok: false, error: e.message });
    }
  });
  return { server, port: PORT, listDevices, revokeDevice, getDSHState: () => ({ dshConnected: haveDSH(), parentAgentId: parentAgent ? parentAgent.id : null }) };
}

export function listDevices() {
  loadTokens();
  return [...tokens.entries()].map(([t, r]) => ({ device: r.deviceName, token: t.slice(0, 8), pairedAt: r.pairedAt, lastSeen: r.lastSeen }));
}
export function revokeDevice(name) {
  loadTokens();
  for (const [t, r] of tokens.entries()) if (r.deviceName === name) tokens.delete(t);
  saveTokens();
}

// ---- CLI 模式 ----
const arg = process.argv.slice(2)[0];
if (import.meta.url === `file://${process.argv[1]}`) {
  if (arg === "list") {
    loadTokens();
    if (!tokens.size) { console.log("尚无已配对设备。"); process.exit(0); }
    for (const [t, r] of tokens.entries()) {
      console.log(`${r.deviceName}\ttoken=${t.slice(0, 8)}…\tpaired=${new Date(r.pairedAt).toISOString()}`);
    }
    process.exit(0);
  }
  if (arg === "revoke" && process.argv[3]) {
    revokeDevice(process.argv[3]);
    console.log("已撤销:", process.argv[3]);
    process.exit(0);
  }
  // 独立启动（无 DSH 集成，用于调试配对）
  const { server, port } = createBridgeServer(null);
  server.listen(port, HOST, () => {
    console.log(`[pixel-office-bridge] 独立模式监听 http://0.0.0.0:${port}（无 DSH 集成，任务 API 不可用）`);
  });
}
