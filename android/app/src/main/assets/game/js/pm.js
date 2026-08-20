// PM 大脑 —— 理解老板意图并执行游戏动作
// 规则式 NLU：关键词+意图槽位匹配，管理招聘/接单/汇报/心情
window.PM = (function () {
  const S = GState;
  const D = GD.DIALOGUE;
  const rand = a => a[Math.floor(Math.random() * a.length)];

  // ---------- 意图识别 ----------
  const INTENTS = [
    { id: "greet",  kw: ["你好", "早安", "早上好", "下午好", "晚上好", "hi", "hello", "在吗", "在不在", "开始", "开始工作", "今天"] },
    { id: "report", kw: ["汇报", "进展", "进度", "情况", "怎么样", "状态", "结果", "看看", "怎么样了", "如何"] },
    { id: "hire",   kw: ["招人", "招聘", "雇人", "招个", "招一个", "招", "人手", "人不够", "扩充", "新员工", "加人", "入职", "雇"] },
    { id: "money",  kw: ["钱", "资金", "收入", "盈利", "利润", "预算", "赚钱", "穷", "没钱", "缺钱", "经济"] },
    { id: "mood",   kw: ["心情", "士气", "咖啡", "福利", "累", "状态", "员工怎么样"] },
    { id: "thanks", kw: ["谢谢", "感谢", "辛苦了", "不错", "好", "厉害", "棒"] },
    { id: "upgrade",kw: ["升级", "装修", "买", "设备", "电脑", "咖啡机", "家具", "装饰", "办公室"] },
    { id: "project",kw: ["项目", "接单", "单子", "生意", "合同", "任务", "活", "外包"] },
    { id: "night",  kw: ["下班", "回家", "休息", "睡觉", "晚安", "睡觉了"] },
  ];

  function detectIntent(text) {
    for (const it of INTENTS) {
      for (const kw of it.kw) {
        if (text.includes(kw)) return it.id;
      }
    }
    return "fallback";
  }

  // ---------- 动作执行 ----------
  const hireQueue = []; // 待办招聘请求

  function doAction(intent, text) {
    const Ss = S.get();
    switch (intent) {
      case "greet": return rand(D.greeting);
      case "thanks": return rand(D.thanks);
      case "night": {
        S.endDay();
        return "好的老板，我去安排大家下班！明天见～";
      }
      case "money": {
        Ss.money -= 0; // 触发保存
        return rand(D.money) + "（当前资金 ¥" + Ss.money + "，已完成 " + Ss.stats.projectsDone + " 个项目）";
      }
      case "report": {
        return buildReport();
      }
      case "hire": {
        if (Ss.employees.length >= 5) return "办公室已经满员了，老板！先把工位升级一下吧。";
        const type = pickHireType(text);
        const cost = type.hireCost;
        if (Ss.money < cost) return "老板，招聘需要 ¥" + cost + "，目前资金不足（¥" + Ss.money + "）… 先接几个项目赚点钱吧！";
        // 执行招聘
        Ss.money -= cost;
        const emp = makeEmp(type);
        Ss.employees.push(emp);
        Ss.hiredOnce = true;
        S.save(); S.emit();
        SFX.play("levelup");
        S.notify("新员工入职！", emp.name + "（" + type.roleZh + "）加入公司！", { icon: "users", type: "hire" });
        return "搞定！" + emp.name + " 已经入职啦，担任" + type.roleZh + "。我会尽快给他安排工作！";
      }
      case "upgrade": {
        return "办公室升级的事我已经记下了，等资金充裕就能动手。目前资金 ¥" + Ss.money;
      }
      case "project": {
        return offerProject();
      }
      case "mood": {
        return rand(D.mood);
      }
      default: return rand(D.fallback);
    }
  }

  function pickHireType(text) {
    const Ss = S.get();
    // 优先用户点名
    const want = {
      "程序": "dev", "开发": "dev", "码农": "dev",
      "美术": "art", "画师": "art", "原画": "art",
      "测试": "qa", "测": "qa",
      "运营": "ops", "市场": "ops",
    };
    for (const k in want) if (text.includes(k)) return GD.EMP_TYPES.find(t => t.id === want[k]);
    // 否则根据缺的角色选
    const have = Ss.employees.map(e => e.typeId);
    const missing = GD.EMP_TYPES.filter(t => !t.id.includes("pm") && !have.includes(t.id));
    if (missing.length) return missing[Math.floor(Math.random() * missing.length)];
    return GD.EMP_TYPES[1];
  }

  function makeEmp(type) {
    const gn = GD.GIVEN[Math.floor(Math.random() * GD.GIVEN.length)];
    const sn = GD.NAMES[Math.floor(Math.random() * GD.NAMES.length)];
    const name = sn + " " + gn;
    return {
      id: "e" + Date.now() + Math.floor(Math.random() * 999),
      typeId: type.id,
      name,
      salary: type.salary,
      mood: type.stats.mood || 80,
      level: 1,
      exp: 0,
      stats: Object.assign({}, type.stats),
      hair: type.hair, skin: type.skin, shirt: type.shirt, pants: type.pants, tie: type.tie, eye: type.eye,
      hiredAt: S.get().day,
    };
  }

  function buildReport() {
    const Ss = S.get();
    const lines = ["好的，这是当前工作汇报："];
    if (!Ss.projects.length && !Ss.tasks.length) {
      lines.push("· 目前没有进行中的项目。");
      if (Ss.employees.length <= 1) {
        lines.push("· 建议先招一些员工，或告诉我「接个项目」！");
      } else {
        lines.push("· 告诉我「接项目」，我马上安排开工！");
      }
    }
    for (const p of Ss.projects) {
      const parts = [];
      for (const t of p.required) {
        const total = p.hours[t];
        const done = p.progress[t] || 0;
        const pct = Math.round(done / total * 100);
        parts.push(t + " " + pct + "%");
      }
      lines.push("· 《" + p.name + "》 [" + parts.join(" | ") + "]");
    }
    lines.push("· 员工 " + Ss.employees.length + " 人，资金 ¥" + Ss.money + "，声誉 " + Ss.reputation);
    return lines.join("\n");
  }

  function buildProjectList() {
    const Ss = S.get();
    if (Ss.projects.length >= 3) return "老板，手头项目已经够多了（" + Ss.projects.length + "个），先做完再谈新的吧！";
    // 从模板里随机挑一个未接过的
    const taken = Ss.projects.map(p => p.typeId).concat(Ss.archive.map(a => a._typeId).filter(Boolean));
    const avail = GD.PROJECT_TYPES.filter(t => !taken.includes(t.id));
    const pool = avail.length ? avail : GD.PROJECT_TYPES;
    const pj = pool[Math.floor(Math.random() * pool.length)];
    return "刚好有个新机会！「" + pj.name + "」\n客户：" + pj.client + "\n" + pj.desc + "\n报酬：¥" + pj.reward + "\n\n回复「接下」，我就安排开工！";
  }

  // 尝试接单
  function tryAcceptProject() {
    const Ss = S.get();
    // 找最近推荐过的项目
    const lastProj = Ss._lastOffer;
    if (lastProj) {
      return acceptProject(lastProj);
    }
    return "老板，我们还没有具体的项目在手。回复「接项目」让我先找个机会？";
  }

  function offerProject() {
    const Ss = S.get();
    const taken = Ss.projects.map(p => p.typeId).concat(Ss.archive.map(a => a._typeId).filter(Boolean));
    const avail = GD.PROJECT_TYPES.filter(t => !taken.includes(t.id));
    const pool = avail.length ? avail : GD.PROJECT_TYPES;
    // 优先推荐当前团队能完成的项目（所需岗位都有）
    const have = new Set(Ss.employees.map(e => e.typeId));
    const doable = pool.filter(t => t.required.every(r => have.has(r)));
    const pj = (doable.length ? doable : pool)[Math.floor(Math.random() * (doable.length ? doable : pool).length)];
    Ss._lastOffer = pj;
    return "我找到个好机会！「" + pj.name + "」\n客户：" + pj.client + "\n" + pj.desc + "\n报酬 ¥" + pj.reward + "，难度 " + "★".repeat(pj.difficulty) + "，需要 " + pj.required.join("、") + "。\n\n老板，要接下吗？回复「接下」即可。";
  }

  function acceptProject(pj) {
    const Ss = S.get();
    // 检查人员是否足够
    const have = new Set(Ss.employees.map(e => e.typeId));
    for (const t of pj.required) {
      if (!have.has(t)) {
        return "接单需要" + t + "岗位的同事，目前还缺人手。回复「招人」先补充队伍吧！";
      }
    }
    const proj = {
      id: "p" + Date.now(),
      typeId: pj.id,
      name: pj.name,
      client: pj.client,
      desc: pj.desc,
      reward: pj.reward,
      difficulty: pj.difficulty,
      required: pj.required,
      hours: pj.hours,
      flavor: pj.flavor,
      progress: {},
      status: "active",
      assigned: {},
    };
    for (const t of pj.required) proj.progress[t] = 0;
    Ss.projects.push(proj);
    // 自动分配任务
    assignTasks(proj);
    S.save(); S.emit();
    SFX.play("stamp");
    S.notify("新项目开工！", "《" + pj.name + "》已接下，正在安排开发。", { icon: "flag", type: "project", important: true, projectId: proj.id });
    return "成交！《" + pj.name + "》开工！我已经把任务分配下去了，完成进度会实时更新。";
  }

  function assignTasks(proj) {
    const Ss = S.get();
    for (const t of proj.required) {
      // 找该类型，若有多个平均分
      const cands = Ss.employees.filter(e => e.typeId === t);
      if (!cands.length) continue;
      const emp = cands[Math.floor(Math.random() * cands.length)];
      const total = proj.hours[t];
      // 拆成 1-3 个任务块
      const chunks = Math.min(3, Math.max(1, Math.ceil(total / 8)));
      for (let i = 0; i < chunks; i++) {
        const t0 = Math.floor(total / chunks);
        const rem = total - t0 * (chunks - 1);
        const amt = i === chunks - 1 ? rem : t0;
        Ss.tasks.push({
          uid: "t" + Date.now() + Math.floor(Math.random() * 999),
          empId: emp.id, typeId: t, projectId: proj.id,
          total: amt, done: 0, desc: t,
        });
      }
      proj.assigned[t] = emp.id;
    }
  }

  // ---------- 对外接口 ----------
  function respond(text) {
    SFX.play("type");
    const t = text.trim().toLowerCase();
    // 联机模式：走真实 LLM（含快捷意图，让 LLM 全面接管）
    if (window.Bridge && Bridge.isConfigured()) {
      return respondLLM(text);
    }
    // 离线回退：规则引擎
    if (/接下|接了|同意|接单|ok|好的|要/.test(t) && (S.get()._lastOffer)) {
      return Promise.resolve(acceptProject(S.get()._lastOffer));
    }
    if (/再接|再来|新项目/.test(t)) {
      return Promise.resolve(offerProject());
    }
    const intent = detectIntent(t);
    return Promise.resolve(doAction(intent, t));
  }

  // LLM 模式：调用桥接服务，解析回复+动作
  async function respondLLM(text) {
    const Ss = S.get();
    const history = lastMessages(6);
    const gameState = Bridge.buildGameState();
    try {
      const d = await Bridge.chat([
        { role: "user", content: "老板：" + text },
      ], gameState);
      const content = d.content || "";
      // 尝试解析末尾的 JSON 动作
      const action = parseAction(content);
      const reply = stripAction(content);
      // 执行动作（异步，不影响回复展示）
      if (action && action.action && action.action !== "none") {
        executeAction(action).catch(e => console.error("[PM action]", e));
      }
      // 记住最近几条（供上下文）
      pushHistory("boss", text);
      pushHistory("pm", reply);
      return reply;
    } catch (e) {
      // 网络失败 -> 回退规则引擎
      console.warn("[PM] LLM 不可用，回退规则引擎:", e.message);
      const intent = detectIntent(text.toLowerCase());
      return doAction(intent, text);
    }
  }

  function parseAction(content) {
    // 找最后一行或最后的 JSON 块
    const m = content.match(/\{[\s\S]*"action"[\s\S]*?\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (e) { return null; }
  }
  function stripAction(content) {
    return content.replace(/\{[\s\S]*"action"[\s\S]*?\}\s*$/, "").trim();
  }

  // 动作执行：hire / offer_project / accept_project / report / end_day / upgrade
  async function executeAction(a) {
    const Ss = S.get();
    switch (a.action) {
      case "hire": {
        const typeId = a.type;
        const type = GD.EMP_TYPES.find(t => t.id === typeId);
        if (!type) return;
        if (Ss.employees.length >= 5) { S.notify("招聘失败", "办公室已满员，请先升级。", { icon: "excl", type: "error" }); return; }
        const cost = type.hireCost;
        if (Ss.money < cost) { S.notify("招聘失败", "资金不足，需要 ¥" + cost, { icon: "excl", type: "error" }); return; }
        Ss.money -= cost;
        const emp = makeEmp(type);
        Ss.employees.push(emp);
        Ss.hiredOnce = true;
        S.save(); S.emit();
        SFX.play("levelup");
        S.notify("新员工入职！", emp.name + "（" + type.roleZh + "）加入公司！", { icon: "users", type: "hire" });
        break;
      }
      case "offer_project": {
        const text = offerProject();
        // 通过 UI 显示 PM 消息
        if (window.UI) setTimeout(() => UI.addPM(text), 100);
        break;
      }
      case "accept_project": {
        if (!Ss._lastOffer) return;
        const text = acceptProject(Ss._lastOffer);
        if (window.UI) setTimeout(() => UI.addPM(text), 100);
        break;
      }
      case "report": {
        const text = buildReport();
        if (window.UI) setTimeout(() => UI.addPM(text), 100);
        break;
      }
      case "end_day": {
        S.endDay();
        if (window.UI) setTimeout(() => UI.addPM("（按老板吩咐，安排大家下班啦）"), 100);
        break;
      }
      case "upgrade": {
        const item = a.item;
        const costMap = { desk: 2000, coffee: 800, decor: 1200, network: 1500 };
        if (Ss.money < (costMap[item] || 1000)) { S.notify("升级失败", "资金不足", { icon: "excl", type: "error" }); return; }
        Ss.money -= (costMap[item] || 1000);
        Ss.upg[item] = (Ss.upg[item] || 0) + 1;
        if (item === "coffee") Ss.employees.forEach(e => e.mood = Math.min(100, e.mood + 10));
        S.save(); S.emit();
        SFX.play("levelup");
        S.notify("办公室升级", item + " 升级到 Lv." + Ss.upg[item], { icon: "gear", type: "upgrade" });
        break;
      }
    }
  }

  // 最近消息记忆（LLM 上下文用，仅内存）
  let memory = [];
  function pushHistory(who, text) {
    memory.push({ who, text, at: Date.now() });
    if (memory.length > 12) memory = memory.slice(-12);
  }
  function lastMessages(n) {
    return memory.slice(-n).map(m => ({
      role: m.who === "boss" ? "user" : "assistant",
      content: m.who === "boss" ? "老板：" + m.text : m.text,
    }));
  }

  // 定时：PM 主动汇报（游戏推进）
  function pmIdle() {
    const Ss = S.get();
    const r = Math.random();
    if (r < 0.3 && Ss.projects.length) {
      // 汇报某个进行中的项目
      const p = Ss.projects[0];
      let total = 0, done = 0;
      for (const t of p.required) { total += p.hours[t]; done += (p.progress[t] || 0); }
      const pct = Math.round(done / total * 100);
      return "老板，《" + p.name + "》进度 " + pct + "% 了，一切顺利！";
    }
    if (r < 0.5 && !Ss.projects.length && Ss.employees.length > 1) {
      return "老板，手头没活了，要不要我「找项目」？";
    }
    return rand(D.idle);
  }

  return { respond, offerProject, tryAcceptProject, makeEmp, doAction, pmIdle, respondLLM, executeAction };
})();
