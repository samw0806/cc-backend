import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

type LoadEnvOptions = {
  cwd?: string
  fileName?: string
  override?: boolean
}

function normalizeValue(rawValue: string): string {
  const trimmed = rawValue.trim()

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

export function parseEnvFile(content: string): Record<string, string> {
  const entries: Record<string, string> = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const normalizedLine = line.startsWith('export ') ? line.slice(7).trim() : line
    const separatorIndex = normalizedLine.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = normalizedLine.slice(0, separatorIndex).trim()
    const value = normalizedLine.slice(separatorIndex + 1)
    if (!key) continue

    entries[key] = normalizeValue(value)
  }

  return entries
}

export function loadEnvFile(options: LoadEnvOptions = {}): string | null {
  const envPath = join(options.cwd ?? process.cwd(), options.fileName ?? '.env')
  if (!existsSync(envPath)) return null

  const parsed = parseEnvFile(readFileSync(envPath, 'utf-8'))
  for (const [key, value] of Object.entries(parsed)) {
    if (options.override || process.env[key] === undefined) {
      process.env[key] = value
    }
  }

  return envPath
}
