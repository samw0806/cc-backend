# Claude Agent Server

一个把 Claude Code 风格交互封装成后端服务的实验项目。它提供 HTTP API 用于创建和管理会话，提供 WebSocket 用于实时流式收发消息，并把文件、Shell、网页抓取等工具调用统一暴露给前端。

## 项目当前能力

- HTTP API：创建、列出、删除会话
- WebSocket：实时接收 assistant 文本流、工具调用、权限请求和执行结果
- 多轮对话循环：支持 `tool_use -> tool_result -> 继续推理`
- 会话恢复：支持从磁盘恢复历史消息
- 会话持久化：消息按 JSONL 存储在 `~/.claude-server/sessions`
- 权限规则引擎：`allow` / `deny` / `ask`
- 安全限制：路径白名单、WebFetch SSRF 拦截、Bearer Token 鉴权
- 内置工具：`Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`WebFetch`

## 技术栈

- Node.js + TypeScript
- Anthropic SDK
- ws
- glob

## 目录结构

```text
.
├── config/
│   └── server.config.json
├── src/
│   ├── core/
│   │   └── types.ts
│   ├── server/
│   │   ├── config.ts
│   │   ├── gateway/
│   │   │   └── server-node.ts
│   │   ├── permissions/
│   │   │   └── RemotePermissionHandler.ts
│   │   ├── session/
│   │   │   └── SessionManager.ts
│   │   └── index.ts
│   ├── services/
│   │   ├── claude.ts
│   │   └── sessionStorage.ts
│   └── tools/
│       └── executor.ts
├── test/
│   └── client.html
└── plans/
    └── phase3-roadmap.md
```

## 运行要求

- Node.js 20+
- npm 或 bun
- 有效的 `ANTHROPIC_API_KEY`

## 快速开始

### 1. 安装依赖

```bash
cd claude-agent-server
npm install
```

如果你习惯用 bun，也可以：

```bash
bun install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

`.env.example` 内容如下：

```bash
PORT=3000
HOST=0.0.0.0
AUTH_TOKEN=dev-token-change-in-production
WORKSPACE_ROOT=/tmp/claude-workspaces
ANTHROPIC_API_KEY=your-api-key-here
```

至少需要设置：

- `ANTHROPIC_API_KEY`

鉴权相关说明：

- `AUTH_TOKEN` 不为空时，HTTP 和 WebSocket 都要求 Bearer Token
- 本地调试如果想关闭鉴权，可以把 `AUTH_TOKEN` 设为空

可选环境变量：

- `MODEL`：覆盖默认模型；未设置时，代码内默认使用 `claude-opus-4-6`
- `MAX_SESSIONS`
- `SESSION_TIMEOUT_MS`

### 3. 启动开发服务器

```bash
npm run dev
```

或：

```bash
bun run dev:bun
```

启动后默认监听：

- HTTP: `http://0.0.0.0:3000`
- WebSocket: `ws://localhost:3000/ws?session=<session_id>`

### 4. 构建生产产物

```bash
npm run build
```

### 5. 运行构建结果

```bash
npm start
```

## 配置说明

主配置文件是 [`config/server.config.json`](./config/server.config.json)。

默认配置示例：

```json
{
  "port": 3000,
  "host": "0.0.0.0",
  "authToken": "dev-token-change-in-production",
  "maxSessions": 100,
  "sessionTimeoutMs": 1800000,
  "workspaceRoot": "/tmp/claude-workspaces",
  "allowedPaths": [
    "/tmp/claude-workspaces",
    "/home"
  ],
  "defaultPermissionMode": "default",
  "forcePermissions": true,
  "maxConcurrentTools": 10,
  "enableFileCache": true,
  "permissionRules": [
    {
      "toolPattern": "^(Read|Glob|Grep)$",
      "behavior": "allow",
      "reason": "只读工具自动允许"
    }
  ]
}
```

关键字段说明：

| 字段 | 说明 |
| --- | --- |
| `workspaceRoot` | 默认工作目录根路径，服务启动时会自动创建 |
| `allowedPaths` | 工具读写允许访问的绝对路径前缀 |
| `permissionRules` | 权限规则列表，命中后直接 `allow` 或 `deny` |
| `authToken` | HTTP 和 WebSocket Upgrade 共用的 Bearer Token |
| `sessionTimeoutMs` | 会话超时时间，后台每分钟清理一次 |
| `model` | 可选，Anthropic 模型名；也可用环境变量 `MODEL` 覆盖 |

## 权限规则

权限规则在 [`src/server/permissions/RemotePermissionHandler.ts`](./src/server/permissions/RemotePermissionHandler.ts) 中执行。

行为规则如下：

- 命中 `allow`：直接执行工具
- 命中 `deny`：拒绝执行并返回错误
- 未命中任何规则：返回 `ask`，由前端决定是否放行

示例：

```json
{
  "toolPattern": "Bash",
  "inputPattern": {
    "command": "git status"
  },
  "behavior": "allow",
  "reason": "允许固定命令"
}
```

说明：

- `toolPattern` 支持普通字符串，也支持以 `^` 开头的正则字符串
- `inputPattern` 在当前 JSON 配置实现下按字段做精确匹配，不支持在配置文件里直接写正则
- 当前 `behavior` 只支持 `allow` 和 `deny`
- 未命中规则时，系统默认走远端确认流程，即 `ask`

## HTTP API

如果配置了 `AUTH_TOKEN`，所有 HTTP 请求都必须带：

```http
Authorization: Bearer <token>
```

### 健康检查

```http
GET /health
```

响应示例：

```json
{
  "status": "ok",
  "sessions": 0
}
```

### 创建会话

```http
POST /api/sessions
Content-Type: application/json
Authorization: Bearer <token>
```

请求体：

```json
{
  "cwd": "/tmp/claude-workspaces/demo",
  "userId": "optional-user-id"
}
```

响应示例：

```json
{
  "session_id": "a3b7f8d2-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "ws_url": "ws://localhost:3000/ws?session=a3b7f8d2-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "cwd": "/tmp/claude-workspaces/demo",
  "created_at": 1710000000000
}
```

### 获取会话列表

```http
GET /api/sessions
Authorization: Bearer <token>
```

响应中包含：

- 当前内存中的活跃会话
- 已持久化但尚未恢复到内存的 `persisted_session_ids`

### 恢复历史会话

```http
POST /api/sessions/{session_id}/resume
Authorization: Bearer <token>
Content-Type: application/json
```

请求体可选：

```json
{
  "cwd": "/tmp/claude-workspaces/demo"
}
```

如果该会话已在内存中，会返回 `already_active`；否则会从 `~/.claude-server/sessions/<session_id>.jsonl` 加载历史消息并返回 `resumed`。

### 获取会话消息

```http
GET /api/sessions/{session_id}/messages
Authorization: Bearer <token>
```

该接口优先返回内存中的消息；若当前进程中没有该会话，则回退到磁盘 JSONL 读取。

### 删除会话

```http
DELETE /api/sessions/{session_id}
Authorization: Bearer <token>
```

删除会话会：

- 停止该会话后续处理
- 关闭对应 WebSocket 连接
- 清空待决权限请求

## WebSocket 协议

连接地址：

```text
ws://localhost:3000/ws?session=<session_id>
```

如果启用了 `AUTH_TOKEN`，WebSocket Upgrade 请求同样要求：

```http
Authorization: Bearer <token>
```

### 客户端发送

用户消息：

```json
{
  "type": "user_message",
  "content": "请帮我读取 package.json",
  "uuid": "9d0d4a3e-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

权限响应：

```json
{
  "type": "control_response",
  "request_id": "e1c0f8cc-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "response": {
    "behavior": "allow"
  }
}
```

### 服务端推送

连接状态：

```json
{
  "type": "status",
  "status": "connected",
  "session_id": "session-id"
}
```

思考和执行状态：

```json
{
  "type": "status",
  "status": "thinking"
}
```

```json
{
  "type": "status",
  "status": "executing:Bash"
}
```

助手文本流：

```json
{
  "type": "assistant",
  "content": "我先检查一下项目结构。"
}
```

工具调用：

```json
{
  "type": "tool_use",
  "tool_name": "Read",
  "tool_use_id": "toolu_123",
  "tool_input": {
    "file_path": "/tmp/claude-workspaces/demo/package.json"
  }
}
```

工具结果：

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_123",
  "tool_name": "Read",
  "success": true,
  "output": "1\t{..."
}
```

权限请求：

```json
{
  "type": "control_request",
  "request_id": "req_123",
  "tool_name": "Bash",
  "tool_input": {
    "command": "git status"
  },
  "reason": "需要用户确认"
}
```

错误：

```json
{
  "type": "error",
  "error": "Session not found"
}
```

完成：

```json
{
  "type": "status",
  "status": "complete"
}
```

## 内置工具

内置工具 schema 定义位于 [`src/services/claude.ts`](./src/services/claude.ts)，执行逻辑位于 [`src/tools/executor.ts`](./src/tools/executor.ts)。

| 工具 | 说明 |
| --- | --- |
| `Read` | 读取文件内容，返回带行号文本 |
| `Write` | 写入或覆盖文件 |
| `Edit` | 基于精确字符串替换修改文件 |
| `Glob` | 查找匹配 glob 的文件 |
| `Grep` | 使用 ripgrep 或 grep 搜索内容 |
| `Bash` | 执行 shell 命令 |
| `WebFetch` | 拉取 HTTP/HTTPS 页面，自动做基础 HTML 转文本 |

## 存储与恢复

- 会话消息使用 JSONL 存储
- 默认目录：`~/.claude-server/sessions`
- 每个会话一个文件：`<session_id>.jsonl`
- 恢复时会重新加载历史消息，再继续后续对话

相关实现见 [`src/services/sessionStorage.ts`](./src/services/sessionStorage.ts)。

## 本地测试

项目附带一个简单的浏览器测试页：

- [`test/client.html`](./test/client.html)

但需要注意一个现实限制：

- 浏览器原生 `WebSocket` API 不能像 `fetch` 一样方便地设置 `Authorization: Bearer ...` 头
- 当前服务端在启用 `AUTH_TOKEN` 时，会要求 WebSocket Upgrade 带 `Authorization` 头

因此直接打开 `test/client.html` 做本地联调时，建议二选一：

1. 本地开发时把 `AUTH_TOKEN` 设为空，临时关闭鉴权
2. 使用能自定义 Upgrade 头的代理或非浏览器 WebSocket 客户端

## 开发建议

- 优先把工作目录限制在 `workspaceRoot` 下
- 生产环境不要使用默认 `authToken`
- 适当缩小 `allowedPaths` 范围，避免过度开放
- 对 `Bash` 工具配置细粒度权限规则

## 路线图

后续计划已整理在：

- [`plans/phase3-roadmap.md`](./plans/phase3-roadmap.md)

当前路线图包括：

- 新工具扩展，例如 WebSearch
- 会话级 system prompt / model 配置
- MCP 客户端集成
- 可观测性与生产加固

## License

MIT
