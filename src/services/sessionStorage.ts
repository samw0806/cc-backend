import { appendFileSync, existsSync, readFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export type PersistedSessionSummary = {
  session_id: string
  status: 'persisted'
  title: string
  message_count: number
  last_active_at: number
}

function getSessionDir(): string {
  const dir = join(homedir(), '.claude-server', 'sessions')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function getSessionFile(sessionId: string): string {
  return join(getSessionDir(), `${sessionId}.jsonl`)
}

function parseMessagesFile(filePath: string): any[] {
  if (!existsSync(filePath)) return []

  const lines = readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim())
  const messages: any[] = []

  for (const line of lines) {
    try {
      messages.push(JSON.parse(line))
    } catch {
      // 忽略损坏的行
    }
  }

  return messages
}

function normalizeTitle(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  return compact.length > 72 ? `${compact.slice(0, 69)}...` : compact
}

function extractTextContent(content: any): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join(' ')
}

export function deriveSessionTitle(messages: any[], sessionId: string): string {
  for (const message of messages) {
    if (message?.role !== 'user') continue

    const title = normalizeTitle(extractTextContent(message.content))
    if (title) return title
  }

  return `Session ${sessionId.slice(0, 8)}`
}

/**
 * 追加一条消息到会话文件（JSONL 格式）
 */
export async function appendMessage(sessionId: string, message: any): Promise<void> {
  try {
    appendFileSync(getSessionFile(sessionId), JSON.stringify(message) + '\n', 'utf-8')
  } catch (e) {
    console.error(`[sessionStorage] Failed to append message for session ${sessionId}:`, e)
  }
}

/**
 * 从磁盘加载会话历史（用于 resume）
 */
export async function loadMessages(sessionId: string): Promise<any[]> {
  const filePath = getSessionFile(sessionId)
  return parseMessagesFile(filePath)
}

/**
 * 列出所有持久化的会话 ID
 */
export function listPersistedSessions(): string[] {
  const dir = getSessionDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f: string) => f.endsWith('.jsonl'))
    .map((f: string) => f.replace('.jsonl', ''))
}

export function listPersistedSessionSummaries(activeSessionIds: string[] = []): PersistedSessionSummary[] {
  const activeSet = new Set(activeSessionIds)

  return listPersistedSessions()
    .filter(sessionId => !activeSet.has(sessionId))
    .map((sessionId) => {
      const filePath = getSessionFile(sessionId)
      const messages = parseMessagesFile(filePath)
      const stats = statSync(filePath)

      return {
        session_id: sessionId,
        status: 'persisted' as const,
        title: deriveSessionTitle(messages, sessionId),
        message_count: messages.length,
        last_active_at: Math.round(stats.mtimeMs),
      }
    })
    .sort((a, b) => b.last_active_at - a.last_active_at)
}
