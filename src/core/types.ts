// 服务器配置类型定义
export type ServerConfig = {
  port: number
  host: string
  authToken?: string
  maxSessions: number
  sessionTimeoutMs: number
  workspaceRoot: string
  allowedPaths?: string[]
  defaultPermissionMode: 'default' | 'allow' | 'deny'
  forcePermissions: boolean
  maxConcurrentTools: number
  enableFileCache: boolean
  permissionRules: PermissionRule[]
  model?: string
}

export type PermissionRule = {
  toolPattern: string | RegExp
  inputPattern?: any
  behavior: 'allow' | 'deny'
  reason?: string
}

// 会话上下文类型
export type SessionContext = {
  id: string
  userId?: string
  cwd: string
  createdAt: number
  lastActiveAt: number
  wsConnections: Set<any>
  messages: any[]
  abortController?: AbortController
  /** 串行消息处理锁：同一会话的消息必须依次执行 */
  processingQueue: Promise<void>
}

// API 消息类型
export type UserMessage = {
  type: 'user_message'
  content: string
  uuid: string
  attachments?: any[]
}

export type ControlResponse = {
  type: 'control_response'
  request_id: string
  response: {
    behavior: 'allow' | 'deny'
    updatedInput?: any
    message?: string
  }
}

export type SDKMessage = {
  type: 'assistant' | 'tool_use' | 'tool_result' | 'result' | 'control_request' | 'error' | 'status'
  [key: string]: any
}
