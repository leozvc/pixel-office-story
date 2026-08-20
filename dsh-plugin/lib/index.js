// dsh-pixel-office-bridge 的 Cordis 插件入口
// 在 DSH 启动时启动桥接 HTTP 服务（配对鉴权 + DSH 任务编排）
import http from "node:http";
import { createBridgeServer } from "./server.js";

export const name = "dsh-pixel-office-bridge";

// agents / subagents / sessionQuery 是硬依赖：声明 inject，Cordis 会在服务就绪后挂起本插件
export const inject = ["agents", "subagents", "sessionQuery"];

let started = false;

function startBridge(ctx) {
  if (started) return;
  started = true;
  try {
    const { server, getDSHState } = createBridgeServer(ctx);
    ctx.effect(() => () => { try { server.close(); } catch (e) {} });
    server.on("error", (e) => {
      ctx.logger?.error?.("[pixel-office-bridge] 监听 8866 失败:", e.message);
    });
    server.listen(8866, "0.0.0.0", () => {
      const st = getDSHState();
      ctx.logger?.info?.("[pixel-office-bridge] DSH 任务编排桥接已启动: http://0.0.0.0:8866 | DSH: " + (st.dshConnected ? "已连接 parent=" + st.parentAgentId : "未连接(将保持配对+LLM 能力，agent 编排将在有 parent 后可用)"));
    });
  } catch (e) {
    ctx.logger?.error?.("[pixel-office-bridge] 启动失败:", e.message);
  }
}

export function apply(ctx) {
  // 为每个 continuable 员工子代理注入"工作台"能力：
  // 绑定到标准会话的完整组合（继承 code 预设的 bash/fs 等工具），并注入工作区说明
  const registerChildSetup = () => {
    const sub = ctx.get("subagents");
    if (!sub || typeof sub.registerContinuableSetup !== "function") return;
    try {
      ctx.effect(sub.registerContinuableSetup((childCtx) => {
        const disposers = [];
        try {
          // 绑定父会话组合（工具/提示段），让员工继承 bash/fs 等真实工具
          const presets = childCtx.get("agentPresets");
          if (presets && typeof presets.composeFrom === "function") {
            const p = ctx.get("agentPresets");
            if (p) {
              const disp = presets.composeFrom(childCtx, ctx);
              if (typeof disp === "function") disposers.push(disp);
            }
          }
        } catch (e) {
          ctx.logger?.warn?.("[pixel-office-bridge] 员工组合注入失败:", e.message);
        }
        return () => { for (const d of disposers) { try { d(); } catch (e) {} } };
      }));
      ctx.logger?.info?.("[pixel-office-bridge] 已注册员工子代理工作台组合注入");
    } catch (e) {
      ctx.logger?.error?.("[pixel-office-bridge] 注册员工组合失败:", e.message);
    }
  };

  // 启动时机：ready 事件（若已过则直接启动）
  const tryStart = () => {
    const agents = ctx.get("agents");
    const sub = ctx.get("subagents");
    if (agents && sub) {
      registerChildSetup();
      startBridge(ctx);
      return true;
    }
    return false;
  };

  ctx.on("ready", () => {
    if (!tryStart()) {
      // 服务尚未就绪，轮询等待
      const iv = setInterval(() => {
        if (tryStart()) clearInterval(iv);
      }, 1500);
      ctx.effect(() => () => { try { clearInterval(iv); } catch (e) {} });
    }
  });

  // 兜底：若 ready 已触发过（插件后加载），轮询直到服务可用
  setTimeout(() => {
    if (!started) tryStart();
  }, 3000);
  const iv2 = setInterval(() => {
    if (!started && tryStart()) clearInterval(iv2);
  }, 3000);
  ctx.effect(() => () => { try { clearInterval(iv2); } catch (e) {} });
}
