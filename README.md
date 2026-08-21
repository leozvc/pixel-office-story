# 像素办公室物语 (Pixel Office Story)

一个 **日式像素风** 的 Android 客户端，内核是 **DeepSeek Harness 任务编排器**。
你是一家游戏公司的老板，通过项目经理佐藤美咲，指挥 AI agent 员工完成任务并汇报，形成
「安排任务 → agent 执行 → PM 汇报」的闭环。任务自动同步到 DeepSeek harness web 的任务看板。

> 本版本已去掉离线模拟玩法（金钱/声誉/升级/接单模拟等），专注打通 DeepSeek harness。

## 玩法

- **连接**：点右上角 ⚡ 打开「连接」面板，填入任务编排服务地址并配对
- **招员工**：说「招人 / 招程序员 / 招美术 / 招测试 / 招运营」
- **安排任务**：说「帮我安排一个任务：…」→ PM 把任务派给合适的员工 agent 真实执行
- **语音**：点 🎤 录音说话 → 宿主 whisper 转文字 → 发给 PM（快问快答）
- **汇报**：说「汇报进度」→ PM 汇总任务看板与员工产出
- **任务看板**：📋 多列看板（待办/执行中/已完成），任务卡含标题/描述/负责人/工作区/状态/产出
- **完成通知**：任务完成后弹出「任务完成 ✅」toast 提醒
- **音效**：程序化 chiptune 音效 + BGM（纯 WebAudio 合成）

## 员工角色

| 角色 | 说明 |
|------|------|
| 项目经理 PM | 佐藤美咲，唯一对话窗口（真实 LLM 大脑） |
| 程序员 dev | 接开发任务，产出代码/方案 |
| 美术 art | 接美术任务，产出设计/文案 |
| 测试 qa | 接测试任务，产出测试报告 |
| 运营 ops | 接运营任务，产出方案/文案 |

## 技术实现

- 纯 HTML5 Canvas + JS，零图片资源（像素画程序化生成）
- 内置 CJK 像素字体（MisekiBitmap）
- 程序化 chiptune 音频引擎
- Android 端：WebView 全屏沉浸式壳（`com.pixelboss.office`）

## 目录结构

```
game/                  # 游戏本体（纯 Web）
  index.html / css/ / js/（palette/sprites/audio/data/state/engine/pm/ui/bridge）
android/               # Android 工程（Gradle）
  app/src/main/assets/game/   # 打包的游戏本体
dsh-plugin/            # DSH 侧服务
  lib/taskboard-server.cjs    # 自包含任务编排 HTTP 服务（8867）
  lib/taskboard-core.cjs      # 任务看板/员工/工作区核心
  lib/taskboard-dsh-sync.cjs  # 同步任务到 DSH web 任务看板
test/                  # CDP 自动化测试
```

## 构建 APK

```bash
export ANDROID_HOME=/opt/android-sdk
cd android
gradle assembleDebug
# 输出: app/build/outputs/apk/debug/app-debug.apk
```

APK 已签名（debug keystore），可直接安装。

## DSH 侧服务

### 任务编排服务（8867）— 自包含，无需重启 DSH

```bash
node dsh-plugin/lib/taskboard-server.cjs --port 8867
```

- **配对鉴权**：6 位一次性配对码（10 分钟）→ 7 天 token
- **任务看板**：todo/doing/done 多列，任务卡含标题/描述/负责人/工作区/状态/产出
- **工作区管理**：默认 `~/.dsh/pixel-office-story/workspace/tasks/<taskId>/`，可指定任意目录
- **员工**：LLM 会话线程（带岗位 persona），真实执行任务并把产出写入工作区（`TASK.md`）
- **ASR**：录音 → 宿主 whisper → 文字 → PM
- **PM 快问快答**：低思考模式模型（`wps-ai/deepseek/deepseek-v4-flash-0731`）
- **完成通知**：`/v1/notifications` 供 APK 轮询

### 同步到 DSH web 任务看板

游戏任务在创建/更新时，由 `taskboard-dsh-sync.cjs` 调用 DSH web 的
`/api/task-board/action`（带 `Origin` 头通过同源鉴权）同步到「任务看板」插件，可在
DeepSeek harness web 界面查看。手动全量同步：`POST /v1/tasks/sync`。

> 说明：DSH task-board 插件的 `move` API 仅支持 backlog/todo 且 running 任务不可移动，
> 因此 DSH 看板中的游戏任务状态显示为 todo；游戏内看板显示真实状态（todo/doing/done）。

## 真机/模拟器验收测试

```bash
# 1. 构建并安装 APK
cd android && gradle assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk   # HyperOS 需在弹窗点「继续安装」

# 2. 启动游戏
adb shell am start -n com.pixelboss.office/.MainActivity

# 3. 转发 WebView CDP 调试端口（游戏 WebView 默认开启调试）
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.pixelboss.office)

# 4. 转发任务编排服务端口（USB/模拟器联机，经 127.0.0.1:8867 访问宿主）
adb reverse tcp:8867 tcp:8867

# 5. 运行 DSH 全流程验收测试
node test/device_acceptance.js
```

> **局域网配对**：手机/模拟器与宿主在同一网络时，在游戏内「⚡ 连接」面板填宿主
> 局域网 IP（如 `http://192.168.1.100:8867`）即可配对，无需 `adb reverse`。任务编排服务监听 `0.0.0.0:8867`。
