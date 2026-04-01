import { appendFileSync, existsSync, readFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

function getSessionDir(): string {
  const dir = join(homedir(), '.claude-server', 'sessions')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function getSessionFile(sessionId: string): string {
  return join(getSessionDir(), `${sessionId}.jsonl`)
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
