// 游戏内容数据 —— 员工、项目、对话模板
window.GD = (function () {

  // 员工角色模板
  const EMP_TYPES = [
    {
      id: "pm", name: "佐藤 美咲", role: "项目经理", roleZh: "项目经理", senior: true, hireCost: 0,
      desc: "把一切安排得井井有条的资深PM。你的唯一对话窗口。",
      shirt: "#3f6fae", pants: "#4a5560", hair: "#3a2a3a", skin: "#ffdcb4", tie: "#c33c3c", eye: "#3f6fae",
      stats: { speed: 1.0, quality: 1.1, mood: 90 },
      salary: 120,
      greeting: "欢迎回来，老板！今天有什么吩咐吗？",
    },
    {
      id: "dev", name: "田中 健太", role: "程序员", roleZh: "程序员", senior: false, hireCost: 500,
      desc: "写代码飞快，但偶尔会偷偷重构。",
      shirt: "#3d8b6f", pants: "#3a4450", hair: "#2e2a32", skin: "#f2b58a", tie: null, eye: "#2e2a32",
      stats: { speed: 1.2, quality: 0.9, mood: 80 },
      salary: 180,
      greeting: "代码是写给人看的，顺带让机器跑一下。",
    },
    {
      id: "art", name: "鈴木 千夏", role: "美术", roleZh: "美术", senior: false, hireCost: 600,
      desc: "像素画的狂热爱好者，配色强迫症。",
      shirt: "#d97a9c", pants: "#5a4a6a", hair: "#7a4a6a", skin: "#ffdcb4", tie: null, eye: "#7a5fa0",
      stats: { speed: 0.9, quality: 1.2, mood: 85 },
      salary: 200,
      greeting: "老板！新画风灵感刚冒出来～",
    },
    {
      id: "qa", name: "高橋 直人", role: "测试", roleZh: "测试", senior: false, hireCost: 400,
      desc: "找bug小能手，一天能提30个issue。",
      shirt: "#e8a33d", pants: "#4a5560", hair: "#5a3a22", skin: "#f2b58a", tie: null, eye: "#2e2a32",
      stats: { speed: 1.0, quality: 1.0, mood: 75 },
      salary: 150,
      greeting: "今天又是充满bug的一天！",
    },
    {
      id: "ops", name: "伊藤 結衣", role: "运营", roleZh: "运营", senior: false, hireCost: 500,
      desc: "深谙玩家心理，把游戏卖爆是她的使命。",
      shirt: "#7a5fa0", pants: "#4a5560", hair: "#2e2a32", skin: "#ffdcb4", tie: null, eye: "#d97a9c",
      stats: { speed: 0.95, quality: 1.0, mood: 88 },
      salary: 160,
      greeting: "老板，这波宣发我们一定大火！",
    },
  ];

  // 项目模板（合同）
  const PROJECT_TYPES = [
    {
      id: "toy", name: "像素宠物养成", client: "快乐游戏株式会社", desc: "治愈系养成手游，画风可爱。",
      size: 1, reward: 1500, difficulty: 1, required: ["dev", "art"],
      hours: { dev: 10, art: 8 }, flavor: "宠物养成",
    },
    {
      id: "puzzle", name: "方块消消乐DX", client: "三日月通信", desc: "三消休闲游戏，主打关卡设计。",
      size: 1, reward: 1200, difficulty: 1, required: ["dev", "qa"],
      hours: { dev: 12, qa: 6 }, flavor: "休闲解谜",
    },
    {
      id: "rpg", name: "勇者大冒险", client: "星火娱乐", desc: "经典JRPG，回合制战斗+像素世界。",
      size: 2, reward: 4000, difficulty: 2, required: ["dev", "art", "qa"],
      hours: { dev: 20, art: 16, qa: 10 }, flavor: "角色扮演",
    },
    {
      id: "sim", name: "温泉经营物语", client: "云间游戏", desc: "经营模拟，日式温泉旅馆。",
      size: 2, reward: 3500, difficulty: 2, required: ["dev", "art"],
      hours: { dev: 18, art: 14 }, flavor: "模拟经营",
    },
    {
      id: "arcade", name: "弹幕飞行机", client: "超新星互动", desc: "爽快弹幕射击，满屏特效。",
      size: 1, reward: 1800, difficulty: 2, required: ["dev", "art", "qa"],
      hours: { dev: 12, art: 10, qa: 8 }, flavor: "街机射击",
    },
    {
      id: "mmo", name: "幻想大陆OL", client: "天穹科技", desc: "大型多人在线RPG，社畜的浪漫。",
      size: 3, reward: 9000, difficulty: 3, required: ["dev", "art", "qa", "ops"],
      hours: { dev: 30, art: 22, qa: 14, ops: 8 }, flavor: "大型网游",
    },
    {
      id: "vns", name: "夏日物语", client: "青空文库", desc: "恋爱文字冒险，像素风日常。",
      size: 1, reward: 1600, difficulty: 1, required: ["dev", "art"],
      hours: { dev: 8, art: 12 }, flavor: "文字冒险",
    },
    {
      id: "sports", name: "运动会Fever!", client: "元气体育", desc: "像素体育竞技合集。",
      size: 2, reward: 3000, difficulty: 2, required: ["dev", "art", "qa"],
      hours: { dev: 16, art: 14, qa: 8 }, flavor: "体育竞技",
    },
    {
      id: "music", name: "节奏大师Jr.", client: "音符音乐", desc: "音游，配合原创chiptune曲目。",
      size: 2, reward: 3200, difficulty: 2, required: ["dev", "art"],
      hours: { dev: 14, art: 12 }, flavor: "音乐节奏",
    },
    {
      id: "horror", name: "深夜办公室", client: "鬼影工作室", desc: "恐怖解谜，像素风惊悚。",
      size: 1, reward: 2000, difficulty: 2, required: ["dev", "art"],
      hours: { dev: 12, art: 10 }, flavor: "恐怖解谜",
    },
  ];

  // 员工可以执行的动作（决定他们在做什么动画）
  const WORK_STYLES = {
    dev: "coding",
    art: "drawing",
    qa: "testing",
    ops: "marketing",
    pm: "managing",
  };

  // 聊天对话（与PM）—— 按关键词/意图匹配的模板
  const DIALOGUE = {
    greeting: [
      "欢迎回来，老板！今天有什么吩咐吗？",
      "老板辛苦了！办公室一切正常，需要我安排什么吗？",
    ],
    idle: [
      "目前手头的工作都在推进中，老板放心。",
      "我正盯着各条任务线，有进展马上向您汇报。",
      "要不我们去接个新项目？大家干劲正足呢。",
      "今天天气不错，是个干活的好日子。",
    ],
    money: [
      "好的老板，我会把预算用到刀刃上。",
      "收到，开源节流我来把关。",
    ],
    hire: [
      "收到！我这就去招聘合适的伙伴，等消息。",
      "好主意，扩充人手后我们就能接更大的单了。",
    ],
    report: [
      "好的，我把各项目的最新进展整理给您。",
      "请稍等，我把工作汇报调出来。",
    ],
    mood: [
      "大家最近状态还行，不过偶尔点杯咖啡犒劳一下，士气会更高哦。",
      "员工心情会影响效率，老板有空可以去看看大家。",
    ],
    thanks: [
      "能为您效力是我的荣幸，老板。",
      "不客气！这些都是我分内的事。",
    ],
    fallback: [
      "明白，我这就去安排。有结果第一时间向您汇报。",
      "收到老板！交给我吧。",
      "好的，我记下了。还有其他吩咐吗？",
    ],
  };

  // 员工工作台词（气泡）
  const WORK_LINES = {
    dev: ["写代码中…", "重构…重构…", "Bug快出来！", "今天也要优雅的代码"],
    art: ["上色中…", "像素点满！", "配色纠结…", "草稿完成！"],
    qa: ["测试中…", "发现bug！", "复现中…", "回归测试"],
    ops: ["宣发中…", "写推文…", "联系渠道…", "数据复盘"],
    pm: ["排期中…", "协调进度…", "写周报…", "盯进度…"],
  };

  // 随机人名（用于新员工）
  const NAMES = ["佐藤", "鈴木", "高橋", "田中", "渡辺", "伊藤", "山本", "中村", "小林", "加藤", "吉田", "山田", "佐々木", "山口", "松本"];
  const GIVEN = ["健太", "美咲", "千夏", "直人", "結衣", "拓海", "陽菜", "大輔", "由紀", "隆", "花子", "翔太", "美月", "悠真", "栞"];

  return { EMP_TYPES, PROJECT_TYPES, WORK_STYLES, DIALOGUE, WORK_LINES, NAMES, GIVEN };
})();
