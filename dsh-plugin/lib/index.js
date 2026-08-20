// dsh-pixel-office-bridge 的 Cordis 插件入口
// 在 DSH 启动时启动桥接 HTTP 服务（配对鉴权 + LLM 代理）
import http from "node:http";
import { createBridgeServer } from "./server.js";

export const name = "dsh-pixel-office-bridge";

export function apply(ctx) {
  ctx.on("ready", () => {
    try {
      // 先探测 8866 是否已有桥接服务在跑（systemd 或其他实例）
      const probe = http.request({
        host: "127.0.0.1",
        port: 8866,
        path: "/health",
        method: "GET",
        timeout: 1500,
      }, (res) => {
        res.resume();
        ctx.logger?.info?.("[pixel-office-bridge] 检测到已有桥接服务运行 (http://0.0.0.0:8866)，跳过启动");
      });
      probe.on("error", () => {
        // 没有现成实例，启动桥接
        try {
          const { server, port } = createBridgeServer();
          ctx.effect(() => () => { try { server.close(); } catch (e) {} });
          ctx.logger?.info?.(`[pixel-office-bridge] 桥接服务已启动: http://0.0.0.0:${port}`);
        } catch (e) {
          ctx.logger?.error?.("[pixel-office-bridge] 启动失败:", e.message);
        }
      });
      probe.on("timeout", () => { probe.destroy(); });
      probe.end();
    } catch (e) {
      ctx.logger?.error?.("[pixel-office-bridge] 初始化失败:", e.message);
    }
  });
}
