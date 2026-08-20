# 像素办公室物语 (Pixel Office Story)

一个 **日式像素风** 的 Android 经营类游戏客户端。你是一家游戏公司的老板，
通过唯一的对话窗口——项目经理佐藤美咲——指挥员工开发游戏、赚取利润、扩张公司。

## 玩法

- **接项目**：向 PM 说「接项目」获取外包合同，说「接下」开工
- **招员工**：说「招人 / 招程序员 / 招美术 / 招测试 / 招运营」
- **汇报**：说「汇报进度」查看所有项目与员工状态
- **升级办公室**：HUD 或「升级」面板购买咖啡机、新办公桌等
- **消息通知**：任务完成 / 新员工入职 / 新的一天 都会弹出像素风 toast 通知
- **音效**：程序化 chiptune 音效 + BGM（纯 WebAudio 合成，无外部音频文件）

## 员工角色

| 角色 | 说明 |
|------|------|
| 项目经理 PM | 佐藤美咲，你的唯一对话窗口（开局自带） |
| 程序员 dev | 写代码 |
| 美术 art | 画画 |
| 测试 qa | 找 bug |
| 运营 ops | 宣发 |

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

# 对接 DeepSeek Harness（真实 LLM 项目经理）

游戏内 PM 支持两种模式：
- **离线模式**（默认）：本地规则引擎，无需网络
- **联机模式**：通过 DSH 桥接服务接入真实 DeepSeek LLM，PM 真正理解你的话并执行游戏动作

## 架构

```
┌────────────┐    HTTP(配对token)   ┌─────────────────┐    OpenAI 兼容   ┌──────────────┐
│ APK 游戏    │ ──────────────────► │ DSH 桥接服务     │ ───────────────► │ DeepSeek LLM │
│ (手机)      │ ◄────────────────── │ bridge/server.js │ ◄─────────────── │ (opencodex)  │
└────────────┘    /v1/chat          │ 127.0.0.1:8866   │   内部代理        └──────────────┘
                                    └─────────────────┘
```

- **DSH 端**：`bridge/server.js` 常驻服务（systemd: `pixel-office-bridge`），监听 `0.0.0.0:8866`
  - 内部代理到 DSH 的 LLM provider（`http://127.0.0.1:10100/v1`，读取 `~/.dsh/.credentials.yaml` 的 OCX_API_KEY）
  - 默认模型 `wps-ai/deepseek/deepseek-v4-flash-0731`
- **APK 端**：游戏内「🔌 连接」面板进行配对

## 配对流程（鉴权）

1. 手机安装 APK，打开游戏 → 点 HUD 上的连接图标（🔌）
2. 填写 DSH 桥接服务地址（局域网 IP，如 `http://192.168.1.100:8866`；DSH 端可用 `bridge/pair.sh status` 查看本机 IP）
3. 点「获取配对码」→ 桥接服务生成 6 位配对码（10 分钟有效，一次性）
4. 在 APK 填入配对码 → 点「确认配对」→ 换取设备 token（持久化，7 天有效）
5. 配对成功后 PM 自动切换到真实 DeepSeek

DSH 端管理：
```bash
cd bridge
./pair.sh status            # 查看桥接状态 + 已配对设备
./pair.sh pair              # 主动生成配对码
./pair.sh revoke <设备名>    # 撤销设备
```

## 联机对话能力

PM 通过系统提示词理解老板意图并输出动作 JSON，由游戏本地执行：
- 招聘（`hire`：dev/art/qa/ops）
- 接项目（`offer_project`）/ 接下（`accept_project`）
- 汇报（`report`）/ 下班（`end_day`）/ 升级办公室（`upgrade`）
- 闲聊（`none`）

LLM 不可用或未配对时自动回退到离线规则引擎，游戏不中断。

## 测试

`test/` 目录下 CDP 自动化测试：
- `smoke.js` 基础加载
- `gameplay.js` 离线玩法循环
- `llm_test.js` 联机配对 + LLM 对话
- `llm_full.js` 完整 LLM 游戏循环（招聘→接单→完成）
- `llm_fileview.js` file:// 协议（模拟 WebView/APK）下 LLM 全流程
- `apk_extract_verify.js` 从最终 APK 提取文件的完整联调
- `device_acceptance.js` 真机验收测试（通过 `adb forward` 连接手机 WebView CDP）

```bash
node test/llm_full.js
```

### 真机验收测试

```bash
# 1. 构建并安装 APK
cd android && gradle assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk   # HyperOS 需在弹窗点「继续安装」

# 2. 启动游戏
adb shell am start -n com.pixelboss.office/.MainActivity

# 3. 转发 WebView CDP 调试端口（游戏 WebView 默认开启调试）
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.pixelboss.office)

# 4. 转发桥接端口（USB 联机配对，手机经 127.0.0.1:8866 访问宿主 DSH 桥接）
adb reverse tcp:8866 tcp:8866

# 5. 运行真机验收测试
node test/device_acceptance.js
```

> **Wi-Fi 局域网配对（推荐）**：手机与宿主在同一局域网时，直接在游戏内「🔌 连接」面板填宿主
> 局域网 IP（如 `http://192.168.1.100:8866`）即可配对，无需 `adb reverse`。桥接服务监听
> `0.0.0.0:8866`。已验证：手机 Wi-Fi（10.13.242.240）→ 宿主（10.13.242.161:8866）→ DeepSeek LLM，
> 配对与对话均正常。
