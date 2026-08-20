// PM 大脑 —— DSH 任务编排版
// 只通过桥接服务与真实 DeepSeek LLM 交互：理解老板意图 → 调度真实员工 agent → 汇报
// 无桥接时明确提示需要连接，不再有离线模拟玩法
window.PM = (function () {
  const S = GState;

  // 同步员工/任务状态（从桥接服务拉取真实数据）
  async function syncFromBridge() {
    if (!window.Bridge || !Bridge.isConfigured()) return null;
    try {
      const agents = await Bridge.listAgents();
      const tasks = await Bridge.listTasks();
      const Ss = S.get();
      // 员工：把桥接返回的子代理映射为游戏内员工
      const empMap = {};
      for (const e of Ss.employees) empMap[e.id] = e;
      const newEmps = [];
      for (const a of (agents && agents.agents) || []) {
        const role = inferRole(a.label || "");
        if (empMap[a.id]) {
          const ex = empMap[a.id];
          ex.status = a.activity === "running" ? "working" : (a.activity === "inactive" ? "idle" : "working");
          ex.label = a.label;
          newEmps.push(ex);
        } else {
          newEmps.push({
            id: a.id, name: a.name || a.label || "员工", role,
            roleName: roleNameOf(role), emoji: emojiOf(role),
            status: a.activity === "running" ? "working" : "idle",
            label: a.label,
          });
        }
      }
      Ss.employees = newEmps;
      // 任务：每个员工最近的产出作为任务
      Ss.tasks = (tasks && tasks.tasks || []).map(t => ({
        id: t.id, label: t.label || t.id, activity: t.activity,
        recent: t.recent || [],
      }));
      Ss.connected = true;
      Ss.lastSync = Date.now();
      S.save(); S.emit();
      return Ss;
    } catch (e) {
      S.get().connected = false;
      S.save(); S.emit();
      throw e;
    }
  }

  function inferRole(label) {
    if (/程序员|dev/.test(label)) return "dev";
    if (/美术|art/.test(label)) return "art";
    if (/测试|qa/.test(label)) return "qa";
    if (/运营|ops/.test(label)) return "ops";
    return "dev";
  }
  function roleNameOf(role) { return { dev: "程序员", art: "美术", qa: "测试", ops: "运营" }[role] || role; }
  function emojiOf(role) { return { dev: "👨‍💻", art: "🎨", qa: "🧪", ops: "📣" }[role] || "👤"; }

  // 主入口：老板发消息 → PM（LLM）理解并调度
  async function respond(text) {
    if (!window.Bridge || !Bridge.isConfigured()) {
      // 未连接 DSH，明确引导
      return Promise.resolve("老板，本版本需要连接 DeepSeek harness 才能工作。请点右上角 ⚡ 打开「连接」面板，填入 DSH 桥接地址并配对。配对成功后，我才能调度真实的员工 agent 为你工作。");
    }
    // 同步最新状态给 LLM 上下文
    let team = [], tasks = [];
    try { const s = await syncFromBridge(); team = (s && s.employees) || []; tasks = (s && s.tasks) || []; } catch (e) {}

    // 对话历史（最近几条）
    const history = lastMessages(6);
    try {
      const d = await Bridge.pmChat([...history, { role: "user", content: "老板：" + text }], team, tasks);
      const content = d.content || "";
      const action = parseAction(content);
      const reply = stripAction(content);
      // 执行 PM 动作（hire / create_task / report）
      if (action && action.action && action.action !== "none") {
        executeAction(action).catch(e => console.error("[PM action]", e));
      }
      // 若动作是 create_task / hire / report，刷新同步
      if (action && action.action && action.action !== "none") {
        setTimeout(() => syncFromBridge().catch(() => {}), 300);
      }
      pushHistory("boss", text);
      pushHistory("pm", reply);
      return reply;
    } catch (e) {
      return "（DSH 连接出现问题：" + (e.message || "未知错误") + "）";
    }
  }

  // 解析 LLM 回复末尾的动作 JSON
  function parseAction(content) {
    const m = content.match(/\{[\s\S]*"action"[\s\S]*?\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (e) { return null; }
  }
  function stripAction(content) {
    return content.replace(/\{[\s\S]*"action"[\s\S]*?\}\s*$/, "").trim();
  }

  // 执行 PM 动作：hire / create_task / report
  async function executeAction(a) {
    const Ss = S.get();
    switch (a.action) {
      case "hire": {
        const role = a.role || "dev";
        const name = a.name || (roleNameOf(role) + "-" + Math.floor(Math.random() * 900 + 100));
        S.notify("正在雇佣 " + roleNameOf(role), "「" + name + "」正在加入…真实 DSH agent 创建中", { icon: "users", type: "hire" });
        try {
          const d = await Bridge.hireAgent(name, role);
          S.notify("新员工入职！", (d.employee && (d.employee.name || d.employee.id)) + " 已作为真实 agent 加入公司", { icon: "users", type: "hire" });
          await syncFromBridge().catch(() => {});
        } catch (e) {
          S.notify("招聘失败", e.message, { icon: "excl", type: "error" });
        }
        break;
      }
      case "create_task": {
        const title = a.title || "任务";
        const desc = a.desc || "";
        const assign = Array.isArray(a.assign) ? a.assign : [];
        S.notify("派发任务", "「" + title + "」分配给 " + (assign.join("、") || "待定") + "，员工 agent 开始工作", { icon: "flag", type: "task", important: true });
        try {
          const d = await Bridge.createTask(title, desc, assign);
          S.notify("任务已派发", "任务「" + title + "」已下发给 " + (d.results || []).length + " 名员工 agent", { icon: "flag", type: "task" });
          await syncFromBridge().catch(() => {});
        } catch (e) {
          S.notify("派发失败", e.message, { icon: "excl", type: "error" });
        }
        break;
      }
      case "report": {
        try {
          const d = await Bridge.pmReport();
          const report = d.report || "暂无汇报";
          // 汇报以 PM 口吻追加
          pushHistory("pm", "【汇报】" + report);
          UI.addPM("【汇报】" + report);
        } catch (e) {
          S.notify("汇报失败", e.message, { icon: "excl", type: "error" });
        }
        break;
      }
      default: break;
    }
  }

  // 历史
  let history = [];
  function pushHistory(who, text) {
    history.push({ role: who === "boss" ? "user" : "assistant", content: text });
    if (history.length > 10) history = history.slice(-10);
  }
  function lastMessages(n) { return history.slice(-(n || 6)); }

  return { respond, syncFromBridge, executeAction, pushHistory, lastMessages };
})();
