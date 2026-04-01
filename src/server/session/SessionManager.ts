import { randomUUID } from 'crypto'
import type Anthropic from '@anthropic-ai/sdk'
import type { SessionContext, SDKMessage } from '../../core/types.js'
import { streamChat } from '../../services/claude.js'
import { executeTool } from '../../tools/executor.js'
import { RemotePermissionHandler } from '../permissions/RemotePermissionHandler.js'
import { loadServerConfig } from '../config.js'

export class SessionManager {
  private sessions: Map<string, SessionContext> = new Map()

  async createSession(options: {
    cwd: string
    userId?: string
  }): Promise<SessionContext> {
    const sessionId = randomUUID()

    const context: SessionContext = {
      id: sessionId,
      userId: options.userId,
      cwd: options.cwd,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      wsConnections: new Set(),
      messages: []
    }

    this.sessions.set(sessionId, context)
    console.log(`[SessionManager] Created session ${sessionId} cwd=${options.cwd}`)
    return context
  }

  getSession(sessionId: string): SessionContext | undefined {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.lastActiveAt = Date.now()
    }
    return session
  }

  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    for (const ws of session.wsConnections) {
      try { ws.close() } catch {}
    }
    if (session.abortController) {
      session.abortController.abort()
    }

    this.sessions.delete(sessionId)
    console.log(`[SessionManager] Destroyed session ${sessionId}`)
  }

  /**
   * 处理用户消息：运行 Claude 对话循环（含工具执行）
   * 通过 broadcast 回调流式推送 SDKMessage
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

    const config = loadServerConfig()

    // 添加用户消息到历史
    session.messages.push({ role: 'user', content: userMessage })

    const MAX_TURNS = 10
    let turn = 0

    while (turn < MAX_TURNS) {
      turn++
      broadcast({ type: 'status', status: 'thinking' })

      const currentAssistantContent: Anthropic.ContentBlock[] = []
      let stopReason = 'end_turn'

      for await (const chunk of streamChat(session.messages as Anthropic.MessageParam[])) {
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
          } as Anthropic.ToolUseBlock)

          broadcast({
            type: 'tool_use',
            tool_name: chunk.toolName,
            tool_use_id: chunk.toolUseId,
            tool_input: chunk.toolInput
          })
        }

        if (chunk.type === 'complete') {
          stopReason = chunk.stopReason
        }

        if (chunk.type === 'error') {
          broadcast({ type: 'error', error: chunk.error })
          return
        }
      }

      if (currentAssistantContent.length > 0) {
        session.messages.push({ role: 'assistant', content: currentAssistantContent })
      }

      if (stopReason !== 'tool_use') {
        broadcast({ type: 'status', status: 'complete' })
        return
      }

      // 执行所有工具
      const toolResultContent: Anthropic.ToolResultBlockParam[] = []

      for (const block of currentAssistantContent) {
        if (block.type !== 'tool_use') continue

        const toolName = block.name
        const toolInput = block.input as any

        // 权限检查
        if (permissionHandler) {
          const decision = permissionHandler.checkPermission(toolName, toolInput)
          if (decision.behavior === 'deny') {
            const denied = `Permission denied: ${decision.reason || 'Tool not allowed'}`
            broadcast({ type: 'tool_result', tool_use_id: block.id, tool_name: toolName, success: false, output: denied })
            toolResultContent.push({ type: 'tool_result', tool_use_id: block.id, content: denied, is_error: true })
            continue
          }
        }

        broadcast({ type: 'status', status: `executing:${toolName}` })
        const result = await executeTool(toolName, toolInput, session.cwd, config.allowedPaths)

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
          content: result.success ? result.output : (result.error || 'error'),
          is_error: !result.success
        })
      }

      session.messages.push({ role: 'user', content: toolResultContent })
    }

    broadcast({ type: 'error', error: `Reached max turns (${MAX_TURNS})` })
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
