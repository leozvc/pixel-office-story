// dsh-pixel-office-bridge 服务模块（ESM）
// 功能同 bridge/server.js，但作为模块导出，由 DSH 插件在启动时加载
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const PORT = parseInt(process.env.BRIDGE_PORT || "8866", 10);
export const HOST = process.env.BRIDGE_HOST || "0.0.0.0";
const LLM_BASE = process.env.DSH_LLM_BASE || "http://127.0.0.1:10100/v1";
const LLM_MODEL = process.env.DSH_LLM_MODEL || "wpsai/deepseek/deepseek-v4-flash-0731";

function readApiKey() {
  if (process.env.DSH_LLM_APIKEY) return process.env.DSH_LLM_APIKEY;
  try {
    const credPath = path.join(os.homedir(), ".dsh", ".credentials.yaml");
    if (fs.existsSync(credPath)) {
      const txt = fs.readFileSync(credPath, "utf8");
      const m = txt.match(/OPENCODEX_API_KEY:\s*(\S+)/);
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

function buildSystemPrompt(gameState) {
  const hasOffer = gameState && gameState.lastOffer;
  return [
    "你是《像素办公室物语》游戏里的项目经理「佐藤美咲」，一位干练、体贴、带点日式语气的游戏项目经理。",
    "老板（用户）会通过聊天跟你交流，你要：",
    "1. 理解老板意图，给出自然、有人情味的中文回复（简短，1-4句）。",
    "2. 在回复的末尾用一行 JSON 输出你想执行的动作（没有动作就输出 {\"action\":\"none\"}）。",
    "可执行动作：",
    "  {\"action\":\"hire\",\"type\":\"dev|art|qa|ops\"}  招聘对应岗位员工",
    "  {\"action\":\"offer_project\"}  给老板提供一个新项目机会",
    "  {\"action\":\"accept_project\"}  接受上一个推荐的项目并开工",
    "  {\"action\":\"report\"}  汇报当前所有项目进度",
    "  {\"action\":\"end_day\"}  下班/进入下一天",
    "  {\"action\":\"upgrade\",\"item\":\"desk|coffee|decor|network\"}  升级办公室",
    "  {\"action\":\"none\"}  仅闲聊，不执行动作",
    "判断规则：",
    "- 老板说「招人/招个XX/招聘」→ hire，type 对应岗位（程序员=dev，美术=art，测试=qa，运营=ops）",
    "- 老板说「接项目/找项目/找活/接单」→ offer_project",
    "- 老板说「接下/接了/同意/成交/就这么办」且已有推荐项目 → accept_project",
    "- 老板说「汇报/进度/情况/怎么样了」→ report",
    "- 老板说「下班/休息/睡觉」→ end_day",
    "- 其他闲聊 → none",
    "重要：动作必须基于老板明确的意图才输出。",
    "项目推荐建议：优先推荐当前团队能完成的项目（所需岗位 gameState.employees 里有）。如果老板要求接项目但当前人手不足，可以先建议招聘。",
    "游戏当前状态（JSON）：",
    JSON.stringify(gameState),
    (hasOffer ? "注意：当前已有一个推荐项目《" + gameState.lastOffer.name + "》（报酬 ¥" + gameState.lastOffer.reward + "，需要 " + gameState.lastOffer.required.join("、") + "），老板如果说接下，就输出 accept_project。" : ""),
    "回复格式：你的说话内容，然后换行，最后一行单独输出 JSON 动作。",
  ].join("\n");
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

export function createBridgeServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;
    if (req.method === "OPTIONS") { send(res, 200, {}); return; }
    try {
      if (req.method === "GET" && pathname === "/health") {
        let llmReachable = false;
        try {
          const r = await fetch(LLM_BASE + "/models", { headers: { Authorization: "Bearer " + API_KEY }, signal: AbortSignal.timeout(5000) });
          llmReachable = r.ok;
        } catch (e) {}
        send(res, 200, { ok: true, service: "pixel-office-bridge", llm: LLM_BASE, model: LLM_MODEL, llmReachable, pairedDevices: tokens.size, hostHints: localIPs(), time: new Date().toISOString() });
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
        send(res, 200, { ok: true, token: tok, model: LLM_MODEL, expiresInSec: Math.floor(TOKEN_TTL / 1000) });
        return;
      }
      if (req.method === "POST" && pathname === "/v1/chat") {
        const rec = verifyToken(req.headers["authorization"]);
        if (!rec) { send(res, 401, { ok: false, error: "未授权，请先配对" }); return; }
        const body = await readBody(req);
        const { messages, gameState, temperature } = body;
        if (!Array.isArray(messages) || !messages.length) { send(res, 400, { ok: false, error: "messages required" }); return; }
        const sys = buildSystemPrompt(gameState);
        const content = await callLLM([{ role: "system", content: sys }, ...messages], { temperature });
        send(res, 200, { ok: true, content, device: rec.deviceName, model: LLM_MODEL });
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
      send(res, 404, { ok: false, error: "not found: " + pathname });
    } catch (e) {
      send(res, 500, { ok: false, error: e.message });
    }
  });
  return { server, port: PORT, listDevices, revokeDevice };
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
