# dsh-pixel-office-bridge

DSH ↔ 像素办公室物语 APK 桥接插件。

把 DSH harness 的 LLM（opencodex provider，`http://127.0.0.1:10100/v1`）暴露为
带**配对鉴权**的 HTTP 服务，供手机端 APK 的游戏项目经理调用真实 DeepSeek。

## 安装

```bash
dsh plugin --profile web add link:/tmp/dsh-pixel-office-bridge
```

安装后把 `dsh-pixel-office-bridge` 加入 `package.json` 的
`dsh.profile.bundles`，重启 `dsh web` 生效。

插件在 DSH 启动时自动拉起桥接服务（若 8866 端口已有实例则跳过）。

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查（含 LLM 可达性、已配对设备数） |
| POST | `/pair/request` | 生成 6 位配对码（10 分钟有效） |
| POST | `/pair/confirm` | 确认配对码，换取设备 token（7 天有效，持久化） |
| POST | `/v1/chat` | 对话（需 `Authorization: Bearer <token>`），内部代理到 DSH LLM |
| GET | `/devices` | 已配对设备列表（需 token） |
| POST | `/device/revoke` | 撤销设备（需 token） |

## 鉴权

- 配对码一次性、10 分钟过期
- token 随机 48 hex、7 天有效、持久化到 `~/.dsh/pixel-office-bridge-state.json`
- 所有 `/v1/*` 接口必须带 Bearer token

## 管理

```bash
# 查看配对设备
node lib/server.js list
# 或
cd /tmp/pixel-office-game && ./bridge/pair.sh status

# 撤销设备
node lib/server.js revoke <设备名>
```

## 环境变量

- `BRIDGE_PORT` 默认 8866
- `BRIDGE_HOST` 默认 0.0.0.0
- `DSH_LLM_BASE` 默认 http://127.0.0.1:10100/v1
- `DSH_LLM_MODEL` 默认 wpsai/deepseek/deepseek-v4-flash-0731
- API key 自动读取 `~/.dsh/.credentials.yaml` 的 `OPENCODEX_API_KEY`
