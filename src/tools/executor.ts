import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname, resolve, isAbsolute } from 'path'
import { spawn } from 'child_process'
import { glob } from 'glob'

// ─── 路径安全 ──────────────────────────────────────────────────────────────

function checkAllowedPath(filePath: string, cwd: string, allowedPaths?: string[]): string {
  const absPath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
  if (!allowedPaths || allowedPaths.length === 0) return absPath
  if (!allowedPaths.some(p => absPath.startsWith(p))) {
    throw new Error(`Path "${absPath}" is outside allowed directories`)
  }
  return absPath
}

export type ToolResult = {
  success: boolean
  output: string
  error?: string
}

// ─── 分发 ──────────────────────────────────────────────────────────────────

export async function executeTool(
  toolName: string,
  toolInput: any,
  cwd: string,
  allowedPaths?: string[]
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'Read':     return executeRead(toolInput, cwd, allowedPaths)
      case 'Write':    return executeWrite(toolInput, cwd, allowedPaths)
      case 'Edit':     return executeFileEdit(toolInput, cwd, allowedPaths)
      case 'Glob':     return await executeGlob(toolInput, cwd, allowedPaths)
      case 'Grep':     return await executeGrep(toolInput, cwd, allowedPaths)
      case 'Bash':     return await executeBash(toolInput, cwd)
      case 'WebFetch': return await executeWebFetch(toolInput)
      default:         return { success: false, output: '', error: `Unknown tool: ${toolName}` }
    }
  } catch (error: any) {
    return { success: false, output: '', error: error.message }
  }
}

// ─── Read ──────────────────────────────────────────────────────────────────

function executeRead(input: any, cwd: string, allowedPaths?: string[]): ToolResult {
  const absPath = checkAllowedPath(input.file_path, cwd, allowedPaths)
  if (!existsSync(absPath)) {
    return { success: false, output: '', error: `File not found: ${absPath}` }
  }
  const content = readFileSync(absPath, 'utf-8')
  const lines = content.split('\n')
  const offset = (input.offset ?? 1) - 1   // 1-based → 0-based
  const limit = input.limit ?? 2000
  const slice = lines.slice(offset, offset + limit)
  const numbered = slice.map((line, i) => `${String(offset + i + 1).padStart(4)}\t${line}`).join('\n')
  const note = lines.length > offset + limit
    ? `\n... (showing lines ${offset + 1}-${offset + limit} of ${lines.length})`
    : ''
  return { success: true, output: numbered + note }
}

// ─── Write ─────────────────────────────────────────────────────────────────

function executeWrite(input: any, cwd: string, allowedPaths?: string[]): ToolResult {
  const absPath = checkAllowedPath(input.file_path, cwd, allowedPaths)
  const dir = dirname(absPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(absPath, input.content, 'utf-8')
  return { success: true, output: `File written: ${absPath}` }
}

// ─── Edit (old_string → new_string) ────────────────────────────────────────

function executeFileEdit(input: any, cwd: string, allowedPaths?: string[]): ToolResult {
  const absPath = checkAllowedPath(input.file_path, cwd, allowedPaths)
  if (!existsSync(absPath)) {
    return { success: false, output: '', error: `File not found: ${absPath}` }
  }

  const { old_string, new_string } = input
  if (old_string === undefined || new_string === undefined) {
    return { success: false, output: '', error: 'old_string and new_string are required' }
  }

  const content = readFileSync(absPath, 'utf-8')

  // 精确匹配检查
  const occurrences = content.split(old_string).length - 1
  if (occurrences === 0) {
    return { success: false, output: '', error: `old_string not found in file: ${absPath}` }
  }
  if (occurrences > 1) {
    return {
      success: false, output: '',
      error: `old_string matches ${occurrences} times — provide more context to make it unique`
    }
  }

  writeFileSync(absPath, content.split(old_string).join(new_string), 'utf-8')
  return { success: true, output: `File edited: ${absPath}` }
}

// ─── Glob ──────────────────────────────────────────────────────────────────

async function executeGlob(input: any, cwd: string, allowedPaths?: string[]): Promise<ToolResult> {
  const searchDir = input.path
    ? checkAllowedPath(input.path, cwd, allowedPaths)
    : cwd

  const matches = await glob(input.pattern, { cwd: searchDir, nodir: false, dot: false })
  if (matches.length === 0) return { success: true, output: 'No files found matching pattern' }

  const output = matches.slice(0, 100).join('\n')
  const note = matches.length > 100 ? `\n... (${matches.length} total, showing first 100)` : ''
  return { success: true, output: output + note }
}

// ─── Grep ──────────────────────────────────────────────────────────────────

async function executeGrep(input: any, cwd: string, allowedPaths?: string[]): Promise<ToolResult> {
  const searchDir = input.path
    ? checkAllowedPath(input.path, cwd, allowedPaths)
    : cwd

  // 优先用 ripgrep，fallback 到 grep
  const hasRg = await commandExists('rg')
  const cmd = hasRg ? 'rg' : 'grep'

  const args: string[] = []
  if (hasRg) {
    args.push('--no-heading', '--line-number')
    if (input['-i'] || input.case_insensitive) args.push('-i')
    if (input.glob) args.push('--glob', input.glob)
    if (input.output_mode === 'files_with_matches' || input.files_with_matches) args.push('-l')
    if (input['-A']) args.push('-A', String(input['-A']))
    if (input['-B']) args.push('-B', String(input['-B']))
    if (input['-C']) args.push('-C', String(input['-C']))
    args.push('--', input.pattern, searchDir)
  } else {
    args.push('-r', '-n')
    if (input['-i'] || input.case_insensitive) args.push('-i')
    if (input.output_mode === 'files_with_matches' || input.files_with_matches) args.push('-l')
    if (input['-A']) args.push(`-A${input['-A']}`)
    if (input['-B']) args.push(`-B${input['-B']}`)
    args.push('--', input.pattern, searchDir)
  }

  const result = await runCommand(cmd, args, cwd, 15000)
  if (!result.success && result.exitCode === 1 && result.stdout === '') {
    // exit 1 with no output = no matches (grep convention)
    return { success: true, output: 'No matches found' }
  }

  // 截断输出
  const lines = result.stdout.split('\n')
  const limited = lines.slice(0, 250)
  const note = lines.length > 250 ? `\n... (${lines.length} lines, showing first 250)` : ''
  return {
    success: result.success || result.exitCode === 1,
    output: limited.join('\n') + note,
    ...(result.stderr ? { error: result.stderr } : {})
  }
}

// ─── Bash（异步非阻塞）────────────────────────────────────────────────────

async function executeBash(input: any, cwd: string): Promise<ToolResult> {
  const timeout = input.timeout ?? 30000
  const result = await runCommand('bash', ['-c', input.command], cwd, timeout)

  const output = result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : '')

  if (!result.success) {
    return {
      success: false,
      output,
      error: result.error ?? `Command exited with code ${result.exitCode}`
    }
  }
  return { success: true, output: output || '(no output)' }
}

// ─── WebFetch ──────────────────────────────────────────────────────────────

async function executeWebFetch(input: any): Promise<ToolResult> {
  const { url } = input
  if (!url) return { success: false, output: '', error: 'url is required' }

  // 只允许 HTTP/HTTPS
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { success: false, output: '', error: 'Only http/https URLs are supported' }
  }

  // 拒绝内网 / loopback 地址（防止 SSRF）
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return { success: false, output: '', error: 'Invalid URL' }
  }
  const hostname = parsedUrl.hostname.toLowerCase()
  const ssrfBlockPatterns = [
    /^localhost$/,
    /^127\./,
    /^0\.0\.0\.0$/,
    /^::1$/,
    /^\[::1\]$/,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,  // link-local (AWS metadata等)
    /^fc00:/,       // IPv6 ULA
    /^fe80:/        // IPv6 link-local
  ]
  if (ssrfBlockPatterns.some(p => p.test(hostname))) {
    return { success: false, output: '', error: `Blocked: requests to private/loopback addresses are not allowed` }
  }

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClaudeAgent/1.0)' },
    signal: AbortSignal.timeout(15000)
  })

  if (!response.ok) {
    return { success: false, output: '', error: `HTTP ${response.status}: ${response.statusText}` }
  }

  const contentType = response.headers.get('content-type') ?? ''
  const text = await response.text()

  let output: string
  if (contentType.includes('text/html')) {
    output = htmlToText(text)
  } else {
    output = text
  }

  // 截断到 20000 字符
  const MAX = 20000
  const truncated = output.length > MAX
    ? output.slice(0, MAX) + `\n... (truncated, ${output.length} total chars)`
    : output

  return { success: true, output: truncated }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

type RunResult = {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  error?: string
}

function runCommand(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const MAX_BUFFER = 1024 * 1024 // 1MB

    let proc: ReturnType<typeof spawn>
    try {
      proc = spawn(cmd, args, { cwd, shell: false })
    } catch (e: any) {
      resolve({ success: false, stdout: '', stderr: '', exitCode: null, error: e.message })
      return
    }

    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      resolve({
        success: false, stdout, stderr,
        exitCode: null, error: `Command timed out after ${timeoutMs}ms`
      })
    }, timeoutMs)

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_BUFFER) stdout += chunk.toString()
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_BUFFER) stderr += chunk.toString()
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({ success: false, stdout, stderr, exitCode: null, error: err.message })
    })

    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ success: code === 0, stdout, stderr, exitCode: code, })
    })
  })
}

async function commandExists(cmd: string): Promise<boolean> {
  const result = await runCommand('which', [cmd], '/', 3000)
  return result.success
}
