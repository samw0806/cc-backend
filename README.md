# Claude Agent Server

将 Claude Code 改造为 agent 服务后端，支持通过 HTTP/WebSocket API 与前端交互。

## 功能特性

- ✅ HTTP REST API（会话管理）
- ✅ WebSocket 实时通信
- ✅ 多会话并发支持
- ✅ 自定义权限规则引擎
- ✅ 会话超时自动清理
- ✅ CORS 支持

## 快速开始

### 1. 安装依赖

```bash
cd /home/sam/code/claude-agent-server
bun install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，设置 ANTHROPIC_API_KEY
```

### 3. 启动服务器

```bash
bun run dev
```

服务器将在 `http://localhost:3000` 启动。

### 4. 测试

在浏览器中打开 `test/client.html`，点击"连接"按钮开始测试。

## API 文档

### 创建会话

```http
POST /api/sessions
Authorization: Bearer <token>
Content-Type: application/json

{
  "cwd": "/tmp/claude-workspaces/test",
  "userId": "optional-user-id"
}
```

响应：

```json
{
  "session_id": "uuid",
  "ws_url": "ws://localhost:3000/ws?session=uuid",
  "cwd": "/tmp/claude-workspaces/test",
  "created_at": 1234567890
}
```

### 获取所有会话

```http
GET /api/sessions
Authorization: Bearer <token>
```

### 删除会话

```http
DELETE /api/sessions/{session_id}
Authorization: Bearer <token>
```

### WebSocket 连接

```
ws://localhost:3000/ws?session={session_id}
```

#### 发送消息

```json
{
  "type": "user_message",
  "content": "你好，帮我创建一个文件",
  "uuid": "uuid"
}
```

#### 接收消息

```json
{
  "type": "assistant",
  "content": "好的，我来帮你创建文件"
}
```

```json
{
  "type": "tool_use",
  "tool_name": "Write",
  "tool_use_id": "uuid",
  "tool_input": {...}
}
```

```json
{
  "type": "status",
  "status": "complete"
}
```

## 配置

编辑 `config/server.config.json`：

```json
{
  "port": 3000,
  "host": "0.0.0.0",
  "authToken": "your-secret-token",
  "maxSessions": 100,
  "sessionTimeoutMs": 1800000,
  "workspaceRoot": "/tmp/claude-workspaces",
  "permissionRules": [
    {
      "toolPattern": "^(Read|Glob|Grep)$",
      "behavior": "allow",
      "reason": "只读工具自动允许"
    }
  ]
}
```

## 权限规则

支持自定义权限规则，减少权限弹窗：

```json
{
  "toolPattern": "Bash",
  "inputPattern": { "command": "^git " },
  "behavior": "allow",
  "reason": "Git命令自动允许"
}
```

- `toolPattern`: 工具名称（字符串或正则表达式）
- `inputPattern`: 输入参数匹配（可选）
- `behavior`: `allow` 或 `deny`
- `reason`: 规则说明

## 项目结构

```
src/
├── core/
│   └── types.ts              # 核心类型定义
├── server/
│   ├── gateway/
│   │   └── server.ts         # HTTP + WebSocket 服务器
│   ├── session/
│   │   └── SessionManager.ts # 会话管理
│   ├── websocket/
│   │   └── WebSocketManager.ts # WebSocket 管理
│   ├── permissions/
│   │   └── RemotePermissionHandler.ts # 权限处理
│   ├── config.ts             # 配置加载
│   └── index.ts              # 启动入口
├── services/
│   └── claude.ts             # Claude API 集成
└── tools/                    # 工具实现（待扩展）
```

## 开发计划

### 第一阶段 ✅（已完成）

- [x] 基础 HTTP 服务器
- [x] WebSocket 实时通信
- [x] 会话管理
- [x] Claude API 集成
- [x] 权限规则引擎
- [x] 测试前端

### 第二阶段（计划中）

- [ ] 工具系统集成（44个工具）
- [ ] Skills 系统支持
- [ ] 历史会话持久化
- [ ] MCP 服务器集成
- [ ] 用户认证系统
- [ ] 监控与日志

## License

MIT
