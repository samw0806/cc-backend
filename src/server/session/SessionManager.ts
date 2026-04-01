import { randomUUID } from 'crypto'
import type Anthropic from '@anthropic-ai/sdk'
import type { ContentBlock, MessageParam, ToolResultBlockParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'
import type { SessionContext, SDKMessage } from '../../core/types.js'
import { streamChat } from '../../services/claude.js'
import { executeTool } from '../../tools/executor.js'
import { RemotePermissionHandler } from '../permissions/RemotePermissionHandler.js'
import { loadServerConfig } from '../config.js'
import { appendMessage, loadMessages } from '../../services/sessionStorage.js'

// 待决权限请求池：tool_use_id → { resolve, reject }
type PendingPermission = {
  resolve: (behavior: 'allow' | 'deny') => void
  reject: (err: Error) => void
}

export class SessionManager {
  private sessions: Map<string, SessionContext> = new Map()
  // sessionId → Map<requestId, PendingPermission>
  private pendingPermissions: Map<string, Map<string, PendingPermission>> = new Map()

  async createSession(options: {
    cwd: string
    userId?: string
    resumeSessionId?: string
  }): Promise<SessionContext> {
    const sessionId = options.resumeSessionId ?? randomUUID()

    // 如果是恢复会话，从磁盘加载历史
    let messages: any[] = []
    if (options.resumeSessionId) {
      messages = await loadMessages(sessionId)
      console.log(`[SessionManager] Resumed session ${sessionId}, loaded ${messages.length} messages`)
    }

    const context: SessionContext = {
      id: sessionId,
      userId: options.userId,
      cwd: options.cwd,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      wsConnections: new Set(),
      messages,
      processingQueue: Promise.resolve()
    }

    this.sessions.set(sessionId, context)
    this.pendingPermissions.set(sessionId, new Map())
    console.log(`[SessionManager] Created session ${sessionId} cwd=${options.cwd}`)
    return context
  }

  getSession(sessionId: string): SessionContext | undefined {
    const session = this.sessions.get(sessionId)
    if (session) session.lastActiveAt = Date.now()
    return session
  }

  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    // 拒绝所有待决权限请求
    const pending = this.pendingPermissions.get(sessionId)
    if (pending) {
      for (const { reject } of pending.values()) {
        reject(new Error('Session destroyed'))
      }
      this.pendingPermissions.delete(sessionId)
    }

    for (const ws of session.wsConnections) {
      try { ws.close() } catch {}
    }
    if (session.abortController) session.abortController.abort()

    this.sessions.delete(sessionId)
    console.log(`[SessionManager] Destroyed session ${sessionId}`)
  }

  /**
   * 前端发来 control_response 后调用此方法
   */
  resolvePermission(sessionId: string, requestId: string, behavior: 'allow' | 'deny') {
    const pending = this.pendingPermissions.get(sessionId)?.get(requestId)
    if (!pending) {
      console.warn(`[SessionManager] No pending permission for requestId=${requestId}`)
      return
    }
    this.pendingPermissions.get(sessionId)!.delete(requestId)
    pending.resolve(behavior)
  }

  /**
   * 处理用户消息：串行入队，防止同 session 并发
   */
  async processMessage(
    sessionId: string,
    userMessage: string,
    broadcast: (msg: SDKMessage) => void,
    permissionHandler?: RemotePermissionHandler
  ): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) {
      broadcast({ type: 'error', error: 'Session not found' })
      return
    }

    // 串行队列：等待上一条消息处理完成后再处理本条
    session.processingQueue = session.processingQueue
      .then(() => this._runMessageLoop(session, userMessage, broadcast, permissionHandler))
      .catch(() => {})
    return session.processingQueue
  }

  /**
   * 实际的对话循环（在队列中串行执行）
   */
  private async _runMessageLoop(
    session: SessionContext,
    userMessage: string,
    broadcast: (msg: SDKMessage) => void,
    permissionHandler?: RemotePermissionHandler
  ): Promise<void> {

    const config = loadServerConfig()

    // 添加用户消息到历史 + 写盘
    const userMsg = { role: 'user', content: userMessage }
    session.messages.push(userMsg)
    await appendMessage(session.id, userMsg)

    const MAX_TURNS = 10
    let turn = 0

    while (turn < MAX_TURNS) {
      turn++
      broadcast({ type: 'status', status: 'thinking' })

      const currentAssistantContent: ContentBlock[] = []
      let stopReason = 'end_turn'

      for await (const chunk of streamChat(session.messages as MessageParam[], undefined, config.model)) {
        if (chunk.type === 'text') {
          const last = currentAssistantContent[currentAssistantContent.length - 1]
          if (last && last.type === 'text') {
            last.text += chunk.content
          } else {
            currentAssistantContent.push({ type: 'text', text: chunk.content })
          }
          broadcast({ type: 'assistant', content: chunk.content })
        }

        if (chunk.type === 'tool_use') {
          currentAssistantContent.push({
            type: 'tool_use',
            id: chunk.toolUseId,
            name: chunk.toolName,
            input: chunk.toolInput
          } as ToolUseBlock)
          broadcast({
            type: 'tool_use',
            tool_name: chunk.toolName,
            tool_use_id: chunk.toolUseId,
            tool_input: chunk.toolInput
          })
        }

        if (chunk.type === 'complete') stopReason = chunk.stopReason
        if (chunk.type === 'error') {
          broadcast({ type: 'error', error: chunk.error })
          return
        }
      }

      if (currentAssistantContent.length > 0) {
        const assistantMsg = { role: 'assistant', content: currentAssistantContent }
        session.messages.push(assistantMsg)
        await appendMessage(session.id, assistantMsg)
      }

      if (stopReason !== 'tool_use') {
        broadcast({ type: 'status', status: 'complete' })
        return
      }

      // ── 执行所有工具 ────────────────────────────────────────────────────
      const toolResultContent: ToolResultBlockParam[] = []

      for (const block of currentAssistantContent) {
        if (block.type !== 'tool_use') continue

        const toolName = block.name
        const toolInput = block.input as any
        let toolOutput: string
        let isError = false

        // 权限检查
        if (permissionHandler) {
          const decision = permissionHandler.checkPermission(toolName, toolInput)

          if (decision.behavior === 'deny') {
            toolOutput = `Permission denied: ${decision.reason ?? 'Tool not allowed'}`
            isError = true
            broadcast({ type: 'tool_result', tool_use_id: block.id, tool_name: toolName, success: false, output: toolOutput })
            toolResultContent.push({ type: 'tool_result', tool_use_id: block.id, content: toolOutput, is_error: true })
            continue
          }

          if (decision.behavior === 'ask') {
            // 发送权限请求给前端，等待响应
            const requestId = randomUUID()
            broadcast({
              type: 'control_request',
              request_id: requestId,
              tool_name: toolName,
              tool_input: toolInput,
              reason: decision.reason
            })

            let behavior: 'allow' | 'deny'
            try {
            behavior = await this.waitForPermission(session.id, requestId, 60000)
            } catch {
              // session 被销毁时 reject，直接终止本轮循环
              return
            }

            if (behavior === 'deny') {
              toolOutput = 'Permission denied by user'
              isError = true
              broadcast({ type: 'tool_result', tool_use_id: block.id, tool_name: toolName, success: false, output: toolOutput })
              toolResultContent.push({ type: 'tool_result', tool_use_id: block.id, content: toolOutput, is_error: true })
              continue
            }
            // behavior === 'allow'，继续执行
          }
        }

        broadcast({ type: 'status', status: `executing:${toolName}` })
        const result = await executeTool(toolName, toolInput, session.cwd, config.allowedPaths)

        toolOutput = result.success ? result.output : (result.error ?? 'error')
        isError = !result.success

        broadcast({
          type: 'tool_result',
          tool_use_id: block.id,
          tool_name: toolName,
          success: result.success,
          output: result.output,
          ...(result.error ? { error: result.error } : {})
        })

        toolResultContent.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: toolOutput,
          is_error: isError
        })
      }

      const toolResultMsg = { role: 'user', content: toolResultContent }
      session.messages.push(toolResultMsg)
      await appendMessage(session.id, toolResultMsg)
    }

    broadcast({ type: 'error', error: `Reached max turns (${MAX_TURNS})` })
  }

  private waitForPermission(
    sessionId: string,
    requestId: string,
    timeoutMs: number
  ): Promise<'allow' | 'deny'> {
    return new Promise((resolve, reject) => {
      const pending = this.pendingPermissions.get(sessionId)
      if (!pending) {
        resolve('deny')
        return
      }

      const timer = setTimeout(() => {
        pending.delete(requestId)
        console.warn(`[SessionManager] Permission request timed out  requestId=${requestId}`)
        resolve('deny')  // 超时自动拒绝
      }, timeoutMs)

      pending.set(requestId, {
        resolve: (behavior) => {
          clearTimeout(timer)
          resolve(behavior)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        }
      })
    })
  }

  getAllSessions(): SessionContext[] {
    return Array.from(this.sessions.values())
  }

  async cleanupExpiredSessions(timeoutMs: number): Promise<void> {
    const now = Date.now()
    const expired: string[] = []
    for (const [id, session] of this.sessions) {
      if (now - session.lastActiveAt > timeoutMs) expired.push(id)
    }
    for (const id of expired) await this.destroySession(id)
    if (expired.length > 0) {
      console.log(`[SessionManager] Cleaned up ${expired.length} expired sessions`)
    }
  }
}
