// DSH task-board 同步客户端
// 把游戏任务同步到 DeepSeek harness web 的「任务看板」(dsh-task-board)
// 通过 DSH web 的 /api/task-board/action 接口（带 Origin header 通过同源鉴权）
"use strict";

const DSH_WEB = process.env.PIXB_DSH_WEB || "http://127.0.0.1:3080";
const ACTION_URL = DSH_WEB + "/api/task-board/action";
const ORIGIN = DSH_WEB;

// 调 DSH task-board action
async function action(kind, payload) {
  const body = {
    requestId: "pixb-" + Date.now() + "-" + Math.floor(Math.random() * 9999),
    action: Object.assign({ kind }, payload),
  };
  const resp = await fetch(ACTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": ORIGIN },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error("DSH task-board " + resp.status + ": " + t.slice(0, 200));
  }
  return resp.json();
}

// 游戏任务 -> DSH 任务 id（稳定映射）
function dshTaskId(gameId) {
  return "pixb-" + gameId;
}

// 同步单个游戏任务到 DSH 看板
// 策略：优先 create（新任务），id 已存在则 update 标题/描述
// DSH 看板状态由插件自身管理；游戏状态以游戏内看板为准
async function syncTaskToDsh(task) {
  const id = dshTaskId(task.id);
  const desc = (task.desc || "") + (task.workspace ? "\n\n工作区: " + task.workspace : "") + (task.output ? "\n\n产出预览: " + task.output.slice(0, 200) : "");
  const input = {
    title: task.title,
    description: desc,
    prompt: task.desc || "",
  };
  try {
    // 先 create
    await action("create", { id, input });
  } catch (e) {
    // id 已存在 -> update
    try {
      await action("update", { taskId: id, patch: { title: task.title, description: desc, prompt: task.desc || "" } });
    } catch (e2) {
      // update 失败（如只读/不存在），忽略
    }
  }
}

// 同步全部游戏任务到 DSH 看板
async function syncAllToDsh(tasks) {
  const results = [];
  for (const t of tasks) {
    try {
      await syncTaskToDsh(t);
      results.push({ id: t.id, ok: true });
    } catch (e) {
      results.push({ id: t.id, ok: false, error: e.message });
    }
  }
  return results;
}

module.exports = { syncTaskToDsh, syncAllToDsh, dshTaskId, action };
