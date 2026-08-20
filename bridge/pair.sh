#!/usr/bin/env bash
# DSH 侧配对管理工具 —— 查看待确认配对码 / 已配对设备 / 撤销设备
# 用法:
#   ./pair.sh status     查看配对状态（最新配对码 + 已配对设备）
#   ./pair.sh revoke <name>  撤销设备
#   ./pair.sh pair        主动生成一个配对码（并打印）

PORT="${BRIDGE_PORT:-8866}"
HOST="${BRIDGE_HOST:-127.0.0.1}"
BASE="http://${HOST}:${PORT}"

case "${1:-status}" in
  status)
    echo "=== 桥接服务状态 ==="
    curl -s "${BASE}/health" | python3 -m json.tool 2>/dev/null || echo "(桥接服务未运行？用 node bridge/server.js 启动)"
    echo
    echo "=== 已配对设备 ==="
    node "$(dirname "$0")/server.js" list
    ;;
  pair)
    echo "=== 生成配对码 ==="
    CODE=$(curl -s -X POST "${BASE}/pair/request" | python3 -c "import sys,json; print(json.load(sys.stdin)['code'])")
    echo "配对码: ${CODE}  (10 分钟内有效)"
    echo "请在 APK 游戏中填入此配对码完成配对"
    ;;
  revoke)
    node "$(dirname "$0")/server.js" revoke "${2}"
    ;;
  *)
    echo "用法: $0 [status|pair|revoke <name>]"
    ;;
esac
