# 像素办公室物语 (Pixel Office Story)

一个 **日式像素风** 的 Android 客户端，但内核是 **DeepSeek Harness 任务编排器**。
你是一家游戏公司的老板，通过唯一的对话窗口——项目经理佐藤美咲——指挥**真实运行的 DSH AI agent 员工**
完成工作任务并汇报，形成"安排任务 → agent 执行 → PM 汇报"的闭环。

> 本版本已**去掉离线模拟玩法**（金钱/声誉/升级/接单模拟等），专注打通 DeepSeek harness：
> 员工都是真实创建的 DSH 子代理（`subagents.startContinuable`），任务都真实派发给它们执行。

## 玩法

- **连接 DSH**：点右上角 ⚡ 打开「连接」面板，填入 DSH 桥接地址并配对
- **招员工**：说「招人 / 招程序员 / 招美术 / 招测试 / 招运营」→ PM 创建真实 DSH agent 员工
- **安排任务**：说「帮我安排一个任务：…」→ PM 理解后把任务派给合适的员工 agent 真实执行
- **汇报**：说「汇报进度」→ PM 读取各员工 agent 的真实工作产出并汇总汇报
- **任务工作台**：📋 面板实时查看各员工 agent 的工作状态与最近产出
- **消息通知**：新员工入职 / 任务派发 等弹出像素风 toast
- **音效**：程序化 chiptune 音效 + BGM（纯 WebAudio 合成，无外部音频文件）

## 员工角色

| 角色 | 说明 |
|------|------|
| 项目经理 PM | 佐藤美咲，你的唯一对话窗口（真实 LLM 大脑） |
| 程序员 dev | 真实 DSH agent，接开发任务产出代码/方案 |
| 美术 art | 真实 DSH agent，接美术任务产出设计/文案 |
| 测试 qa | 真实 DSH agent，接测试任务产出测试报告 |
| 运营 ops | 真实 DSH agent，接运营任务产出方案/文案 |

## 技术实现

- 纯 HTML5 Canvas + JS，零图片资源（所有像素画程序化生成）
- 内置 CJK 像素字体（MisekiBitmap，15622 字符全覆盖）
- 游戏状态 localStorage 持久化
- 程序化 chiptune 音频引擎
- Android 端：WebView 全屏沉浸式壳（`com.pixelboss.office`）

## 目录结构

```
game/                  # 游戏本体（纯 Web）
  index.html
  css/style.css
  js/
    palette.js         # 调色板
    sprites.js         # 程序化像素画
    audio.js           # 音效/BGM 引擎
    data.js            # 内容数据
    state.js           # 存档状态
    engine.js          # 核心模拟+场景渲染
    pm.js              # PM 对话大脑
    ui.js              # HUD/聊天/通知/面板
  assets/fonts/        # 像素字体
android/               # Android 工程（Gradle + AGP 8.2.2）
  app/src/main/
    java/com/pixelboss/office/MainActivity.java
    assets/game/       # 打包的游戏本体
test/                  # CDP 浏览器自动化测试
```

## 构建 APK

```bash
export ANDROID_HOME=/opt/android-sdk
cd android
/opt/gradle/gradle-8.5/bin/gradle assembleRelease
# 输出: app/build/outputs/apk/release/app-release.apk
```

APK 已签名（debug keystore），可直接安装。

---

# 对接 DeepSeek Harness（DSH 任务编排）

游戏 PM 接入真实 DeepSeek harness，并把任务编排给**真实运行的 DSH agent 员工**执行。

## 架构

```
┌────────────┐   HTTP(配对token)   ┌─────────────────────────────┐
│ APK 游戏    │ ──────────────────► │ DSH 桥接插件（dsh-plugin）    │
│ (手机/模拟器) │ ◄────────────────── │ dsh-plugin/lib/server.js    │
└────────────┘   /v1/*             │ 监听 0.0.0.0:8866            │
                                    │  · 配对鉴权 + LLM 代理       │
                                    │  · 员工 agent 编排：          │
                                    │     subagents.startContinuable│
                                    │     （每个员工=真实 DSH 子代理）│
                                    │  · 任务派发：subagents.followup│
                                    │  · PM 汇报：sessionQuery 读日志│
                                    └──────────────┬──────────────┘
                                                   │
                                    ┌──────────────▼──────────────┐
                                    │ DeepSeek Harness 宿主          │
                                    │ (agents / subagents /          │
                                    │  sessionQuery 服务)            │
                                    └──────────────────────────────┘
```

- **DSH 端**：`dsh-plugin/` 作为 DSH profile bundle 插件常驻，`ctx.on('ready')` 时启动桥接 HTTP 服务
  - 建立稳定 parent agent（公司负责人），用 `subagents.startContinuable` 创建员工 agent
  - 用 `subagents.followup` 派发任务，用 `sessionQuery.readSession` 读取员工产出供 PM 汇报
- **APK 端**：游戏内「⚡ 连接」面板进行配对

## 配对流程（鉴权）

1. 打开游戏 → 点右上角 ⚡ → 填 DSH 桥接地址（局域网 IP `http://<宿主>:8866`，USB 可用 `http://127.0.0.1:8866` + `adb reverse`）
2. 点「获取配对码」→ 桥接生成 6 位配对码（10 分钟有效，一次性）
3. 填配对码 → 「确认配对」→ 换取设备 token（7 天有效，持久化）
4. 配对成功后 PM 接入真实 DeepSeek，可同步/雇佣真实 agent 员工

## DSH 任务编排能力

PM 通过系统提示词理解老板意图并输出动作 JSON，由桥接服务执行：
- 招聘（`hire`：dev/art/qa/ops）→ 创建真实 continuable DSH 子代理员工
- 安排任务（`create_task`：title/desc/assign）→ `followup` 派发给员工 agent 真实执行
- 汇报（`report`）→ 读各员工 agent 会话日志汇总真实产出
- 闲聊（`none`）

> 本版本已移除离线规则引擎与接单/升级等模拟玩法；未配对时游戏只提示连接 DSH，不进行模拟。

## 测试

`test/` 目录下 CDP 自动化测试：
- `smoke.js` 基础加载
- `device_acceptance.js` 真机/模拟器 DSH 全流程验收（配对→雇佣真实 agent→派发任务→查看产出）

```bash
node test/device_acceptance.js
```

### 真机/模拟器验收测试

```bash
# 1. 构建并安装 APK
cd android && gradle assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk   # 模拟器直接安装，HyperOS 需在弹窗点「继续安装」

# 2. 启动游戏
adb shell am start -n com.pixelboss.office/.MainActivity

# 3. 转发 WebView CDP 调试端口（游戏 WebView 默认开启调试）
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.pixelboss.office)

# 4. 转发桥接端口（USB/模拟器联机配对，经 127.0.0.1:8866 访问宿主 DSH 桥接）
adb reverse tcp:8866 tcp:8866

# 5. 运行 DSH 全流程验收测试
node test/device_acceptance.js
```

> **Wi-Fi 局域网配对（推荐）**：手机与宿主在同一局域网时，直接在游戏内「⚡ 连接」面板填宿主
> 局域网 IP（如 `http://192.168.1.100:8866`）即可配对，无需 `adb reverse`。桥接服务监听
> `0.0.0.0:8866`，员工为真实 DSH 子代理。
