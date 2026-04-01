# 第三阶段开发路线图

> 当前状态（2026-04-01）：P0/P1 功能全部完成，Bug 审核修复完毕，代码可稳定运行。
> 本文档规划后续迭代方向，按优先级排序。

---

## 现状总结

### 已完成功能

| 功能 | 状态 |
|------|------|
| HTTP API (sessions CRUD + resume + messages) | ✅ |
| WebSocket 实时流式通信 | ✅ |
| 对话循环（MAX_TURNS=10，多轮工具执行） | ✅ |
| 工具：Read / Write / Edit / Glob / Grep / Bash / WebFetch | ✅ |
| 权限规则引擎（allow/deny/ask + 正则匹配） | ✅ |
| Bearer Token 认证（HTTP + WebSocket Upgrade） | ✅ |
| JSONL 会话持久化 + 恢复（resume） | ✅ |
| 路径安全白名单 | ✅ |
| 异步 Bash（spawn + Promise，无阻塞） | ✅ |
| SSRF 防护（内网 IP 拦截） | ✅ |
| 并发消息串行队列（processingQueue） | ✅ |

---

## P1 — 工具扩展（优先级：高）

当前 7 个工具覆盖了大部分编程场景，以下是高价值补充：

### 1.1 WebSearch 工具

**动机**：WebFetch 只能抓已知 URL，Claude 经常需要先搜索再读取。

**实现方案**：
- 调用搜索 API（优先 Brave Search API，免费额度充足；备选 Serper）
- 返回标题 + URL + 摘要列表，不直接抓取正文（由 WebFetch 二次获取）
- API Key 通过环境变量 `BRAVE_API_KEY` 注入

**涉及文件**：
- `src/tools/executor.ts` — 新增 `executeWebSearch()`
- `src/services/claude.ts` — TOOLS 数组添加 WebSearch schema
- `config/server.config.json` — 可选添加 `webSearchEnabled` 开关

---

### 1.2 SleepTool（可选）

**动机**：Claude 有时需要在循环中等待（如等待文件生成、等待服务启动）。

**实现**：约 5 行，`await new Promise(r => setTimeout(r, ms))`，最大 30s。

**涉及文件**：`src/tools/executor.ts`，`src/services/claude.ts`

---

## P2 — 系统提示词 + 模型参数配置（优先级：高）

### 2.1 System Prompt 支持

**动机**：每个会话可以有不同的人设/指令（如 "你是一个代码审核助手"）。

**实现**：
- `POST /api/sessions` body 增加可选字段 `systemPrompt: string`
- `SessionContext` 存储 `systemPrompt`
- `_runMessageLoop` 调用 `streamChat()` 时传入

**涉及文件**：
- `src/core/types.ts` — `SessionContext` 加 `systemPrompt?`
- `src/server/gateway/server-node.ts` — `routeCreateSession` 读取
- `src/server/session/SessionManager.ts` — `createSession` + `_runMessageLoop`

---

### 2.2 max_tokens 和 model 按会话配置

**动机**：不同任务对 token 上限和模型需求不同（轻量任务用 Haiku 省成本）。

**实现**：`POST /api/sessions` 增加 `model?` 和 `maxTokens?` 字段，覆盖全局配置。

**涉及文件**：同 2.1，另加 `src/services/claude.ts` 的 `streamChat` 参数。

---

## P3 — MCP 客户端集成（优先级：中）

**动机**：MCP（Model Context Protocol）是 Anthropic 的工具扩展标准，允许接入外部服务（数据库、IDE、GitHub 等）。

**实现方案**：

```
前端 → POST /api/sessions/:id/mcp/connect { serverCommand, args }
        ↓
SessionManager 启动 MCP 子进程（stdio 传输）
        ↓
MCP 工具列表合并进 Claude API 的 tools 参数
        ↓
Claude 调用 MCP 工具时 → SessionManager 转发给 MCP 服务器 → 返回结果
```

**新增接口**：
- `POST /api/sessions/:id/mcp/connect` — 连接 MCP 服务器（stdio）
- `GET /api/sessions/:id/mcp/tools` — 列出当前 MCP 工具

**涉及文件**：
- 新建 `src/services/mcp.ts` — MCP 客户端封装（基于 `@modelcontextprotocol/sdk`）
- `src/core/types.ts` — `SessionContext` 加 `mcpTools`, `mcpClient`
- `src/server/session/SessionManager.ts` — MCP 工具执行分支
- `src/server/gateway/server-node.ts` — 新路由
- `src/services/claude.ts` — `streamChat` 支持动态 tools 合并

**依赖**：`@modelcontextprotocol/sdk`（需 `npm install`）

**复杂度**：高，约 300 行，独立迭代

---

## P4 — 可观测性（优先级：中低）

### 4.1 结构化日志

**动机**：当前日志是 `console.log`，生产环境难以过滤和聚合。

**方案**：引入 `pino`，输出 JSON 格式日志，每条带 `sessionId`, `toolName`, `durationMs` 等字段。

### 4.2 Token 用量追踪

**动机**：了解 API 成本，方便后续按用户计费。

**方案**：`streamChat` 的 `complete` 事件已包含 `usage` 字段，把每轮 `input_tokens + output_tokens` 累计进 `SessionContext.tokenUsage`，并通过 `/api/sessions/:id` 返回。

---

## P5 — 生产加固（优先级：低，上线前必做）

| 项目 | 说明 |
|------|------|
| 速率限制 | 每个 IP/Token 每分钟最多 N 条消息，防止滥用 |
| 符号链接防穿越 | `checkAllowedPath` 使用 `fs.realpathSync()` 解析真实路径 |
| 默认 authToken 校验 | 启动时若 `authToken === 'dev-token-change-in-production'` 则警告 |
| 优雅停机 | `SIGTERM` 时等待所有 session `processingQueue` 完成后再关闭 |
| 健康检查扩展 | `/health` 增加 `uptime`, `memoryUsage`, `activeSessionCount` |

---

## 执行顺序建议

```
Week 1:  P2 — system prompt + 按会话配置 model/maxTokens（改动小，收益大）
         P1 — WebSearch 工具

Week 2:  P3 — MCP 客户端（独立迭代，复杂度高）

Week 3:  P4 — pino 日志 + token 用量追踪
         P5 — 生产加固清单

Week 4+: 根据实际使用反馈调整
```

---

## 关键文件索引

| 文件 | 职责 |
|------|------|
| `src/server/gateway/server-node.ts` | HTTP 路由 + WebSocket 入口 |
| `src/server/session/SessionManager.ts` | 会话生命周期 + 对话循环 |
| `src/server/permissions/RemotePermissionHandler.ts` | 权限规则匹配 |
| `src/services/claude.ts` | Anthropic SDK 流式封装，工具 schema |
| `src/tools/executor.ts` | 工具实现（Read/Write/Edit/Glob/Grep/Bash/WebFetch） |
| `src/services/sessionStorage.ts` | JSONL 持久化读写 |
| `src/core/types.ts` | 全局类型定义 |
| `config/server.config.json` | 服务器配置（端口、token、allowedPaths、permissionRules） |
