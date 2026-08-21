// PM 大脑 —— DSH 任务编排版
// 只通过任务编排服务与真实 DeepSeek LLM 交互：理解老板意图 → 调度员工 → 看板/汇报
window.PM = (function () {
  const S = GState;

  // 同步员工/任务看板（从任务编排服务拉取真实数据）
  async function syncFromBridge() {
    if (!window.Bridge || !Bridge.isConfigured()) return null;
    try {
      const empRes = await Bridge.listEmployees();
      const taskRes = await Bridge.listTasks();
      const Ss = S.get();
      Ss.employees = (empRes && empRes.employees || []).map(e => ({
        id: e.id, name: e.name, role: e.role, roleName: e.roleName,
        emoji: e.emoji, status: e.status, label: e.roleName, skill: e.skill || {},
      }));
      Ss.tasks = (taskRes && taskRes.tasks || []).map(t => ({
        id: t.id, title: t.title, desc: t.desc, assign: t.assign || [],
        status: t.status, stage: t.stage || "", priority: t.priority || "medium", workspace: t.workspace, output: t.output || "",
        outputFiles: t.outputFiles || [], createdAt: t.createdAt,
        subtasks: t.subtasks || [], currentSubtask: t.currentSubtask || "",
        feedback: t.feedback || [], revising: t.stage === "revising",
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

  function roleNameOf(role) { return { dev: "程序员", art: "美术", qa: "测试", ops: "运营" }[role] || role; }
  function emojiOf(role) { return { dev: "👨‍💻", art: "🎨", qa: "🧪", ops: "📣" }[role] || "👤"; }

  // 主入口：老板发消息 → PM（LLM）理解并调度
  async function respond(text, opts) {
    const flow = (opts && opts.flow) || null; // 可选流程可视化回调 flow(stepName, label)
    if (!window.Bridge || !Bridge.isConfigured()) {
      return Promise.resolve("老板，本版本需要连接 DeepSeek harness 才能工作。请点右上角 ⚡ 打开「连接」面板，填入 DSH 任务编排服务地址并配对。配对成功后，我才能调度员工 agent 为你工作。");
    }
    let team = [], tasks = [];
    try { const s = await syncFromBridge(); team = (s && s.employees) || []; tasks = (s && s.tasks) || []; } catch (e) {}

    const history = lastMessages(6);
    try {
      const d = await Bridge.pmChat([...history, { role: "user", content: "老板：" + text }], team, tasks);
      const content = d.content || "";
      const action = parseAction(content);
      const reply = stripAction(content);
      if (action && action.action && action.action !== "none") {
        executeAction(action, flow).catch(e => console.error("[PM action]", e));
        setTimeout(() => syncFromBridge().catch(() => {}), 300);
      }
      pushHistory("boss", text);
      pushHistory("pm", reply);
      if (flow) flow("done", "完成");
      return reply;
    } catch (e) {
      if (flow) flowResetSafe();
      return "（连接出现问题：" + (e.message || "未知错误") + "）";
    }
  }
  function flowResetSafe() { try { UI.flowReset(); } catch (e) {} }

  function parseAction(content) {
    const m = content.match(/\{[\s\S]*"action"[\s\S]*?\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (e) { return null; }
  }
  function stripAction(content) {
    return content.replace(/\{[\s\S]*"action"[\s\S]*?\}\s*$/, "").trim();
  }

  // 执行 PM 动作：hire / create_task / report
  async function executeAction(a, flow) {
    switch (a.action) {
      case "hire": {
        const role = a.role || "dev";
        const name = a.name || (roleNameOf(role) + "-" + Math.floor(Math.random() * 900 + 100));
        if (flow) flow("dispatch", "招聘中");
        S.notify("正在雇佣 " + roleNameOf(role), "「" + name + "」正在加入…", { icon: "users", type: "hire" });
        try {
          const d = await Bridge.hireEmployee(name, role);
          S.notify("新员工入职！", (d.employee && d.employee.name) + " 已加入公司", { icon: "users", type: "hire" });
          if (flow) flow("exec", "入职办理");
          await syncFromBridge().catch(() => {});
          if (flow) flow("done", "入职完成");
        } catch (e) { S.notify("招聘失败", e.message, { icon: "excl", type: "error" }); }
        break;
      }
      case "create_task": {
        const title = a.title || "任务";
        const desc = a.desc || "";
        const assign = Array.isArray(a.assign) ? a.assign : [];
        const workspace = a.workspace || ""; // 可选，默认服务端分配
        if (flow) flow("dispatch", "派发中");
        S.notify("派发任务", "「" + title + "」分配给 " + (assign.join("、") || "待定") + "，已加入任务看板", { icon: "flag", type: "task", important: true });
        try {
          const d = await Bridge.createTask(title, desc, assign, workspace);
          if (d.task) {
            // 自动派发执行
            if (flow) flow("exec", "员工执行中");
            await Bridge.dispatchTask(d.task.id).catch(() => {});
            S.notify("任务已派发", "「" + title + "」已交员工执行，产出将写入工作区", { icon: "flag", type: "task" });
            // 让对应员工在办公室场景冒泡
            sceneEmpBubble(assign, "收到！开工！💪");
          }
          await syncFromBridge().catch(() => {});
        } catch (e) { S.notify("派发失败", e.message, { icon: "excl", type: "error" }); }
        break;
      }
      case "report": {
        try {
          const s = await syncFromBridge();
          const tasks = (s && s.tasks) || [];
          let report = "当前任务看板（" + tasks.length + " 项）：\n";
          if (!tasks.length) report += "· 暂无任务。跟我说「帮我安排一个任务：…」即可。";
          for (const t of tasks) {
            const st = { todo: "待办", doing: "执行中", done: "已完成" }[t.status] || t.status;
            report += "· 【" + st + "】" + t.title + (t.assign.length ? "（负责人：" + t.assign.join("、") + "）" : "");
            if (t.status === "done" && t.output) report += "\n   产出预览：" + t.output.slice(0, 120);
          }
          const emps = (s && s.employees) || [];
          report += "\n\n团队 " + emps.length + " 人：" + emps.map(e => e.name + "(" + e.roleName + ")").join("、");
          pushHistory("pm", "【汇报】" + report);
          UI.addPM("【汇报】" + report);
        } catch (e) { S.notify("汇报失败", e.message, { icon: "excl", type: "error" }); }
        break;
      }
      default: break;
    }
  }

  // 让指定名字的员工在办公室场景冒气泡
  function sceneEmpBubble(names, text) {
    try {
      if (!window.Game || !window.Game._showBubble) return;
      const Ss = S.get();
      for (const nm of (names || [])) {
        const emp = Ss.employees.find(e => e.name === nm);
        if (emp) window.Game._showBubble(emp, text);
      }
    } catch (e) {}
  }

  let history = [];
  function pushHistory(who, text) {
    history.push({ role: who === "boss" ? "user" : "assistant", content: text });
    if (history.length > 10) history = history.slice(-10);
  }
  function lastMessages(n) { return history.slice(-(n || 6)); }

  return { respond, syncFromBridge, executeAction, pushHistory, lastMessages };
})();
