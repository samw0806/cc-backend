import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname, resolve, isAbsolute } from 'path'
import { spawnSync } from 'child_process'
import { glob } from 'glob'

// 检查路径是否在允许范围内
function checkAllowedPath(filePath: string, cwd: string, allowedPaths?: string[]): string {
  const absPath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
  if (!allowedPaths || allowedPaths.length === 0) {
    return absPath
  }
  const allowed = allowedPaths.some(p => absPath.startsWith(p))
  if (!allowed) {
    throw new Error(`Path "${absPath}" is outside allowed directories`)
  }
  return absPath
}

export type ToolResult = {
  success: boolean
  output: string
  error?: string
}

export async function executeTool(
  toolName: string,
  toolInput: any,
  cwd: string,
  allowedPaths?: string[]
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'Read':
        return executeRead(toolInput, cwd, allowedPaths)
      case 'Write':
        return executeWrite(toolInput, cwd, allowedPaths)
      case 'Glob':
        return await executeGlob(toolInput, cwd, allowedPaths)
      case 'Bash':
        return executeBash(toolInput, cwd)
      default:
        return { success: false, output: '', error: `Unknown tool: ${toolName}` }
    }
  } catch (error: any) {
    return { success: false, output: '', error: error.message }
  }
}

function executeRead(input: any, cwd: string, allowedPaths?: string[]): ToolResult {
  const absPath = checkAllowedPath(input.file_path, cwd, allowedPaths)
  if (!existsSync(absPath)) {
    return { success: false, output: '', error: `File not found: ${absPath}` }
  }
  const content = readFileSync(absPath, 'utf-8')
  // 带行号输出（最多 2000 行）
  const lines = content.split('\n')
  const limited = lines.slice(0, 2000)
  const numbered = limited.map((line, i) => `${String(i + 1).padStart(4)}\t${line}`).join('\n')
  const truncated = lines.length > 2000 ? `\n... (truncated, ${lines.length} total lines)` : ''
  return { success: true, output: numbered + truncated }
}

function executeWrite(input: any, cwd: string, allowedPaths?: string[]): ToolResult {
  const absPath = checkAllowedPath(input.file_path, cwd, allowedPaths)
  const dir = dirname(absPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(absPath, input.content, 'utf-8')
  return { success: true, output: `File written: ${absPath}` }
}

async function executeGlob(input: any, cwd: string, allowedPaths?: string[]): Promise<ToolResult> {
  const searchDir = input.path
    ? checkAllowedPath(input.path, cwd, allowedPaths)
    : cwd

  const matches = await glob(input.pattern, {
    cwd: searchDir,
    nodir: false,
    dot: false
  })

  if (matches.length === 0) {
    return { success: true, output: 'No files found matching pattern' }
  }

  // 按修改时间排序（简化版：直接返回）
  const output = matches.slice(0, 100).join('\n')
  const truncated = matches.length > 100 ? `\n... (${matches.length} total matches, showing first 100)` : ''
  return { success: true, output: output + truncated }
}

function executeBash(input: any, cwd: string): ToolResult {
  const timeout = input.timeout ?? 30000
  const result = spawnSync('bash', ['-c', input.command], {
    cwd,
    encoding: 'utf-8',
    timeout,
    maxBuffer: 1024 * 1024 // 1MB
  })

  if (result.error) {
    return { success: false, output: '', error: result.error.message }
  }

  const stdout = result.stdout || ''
  const stderr = result.stderr || ''
  const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '')

  if (result.status !== 0) {
    return {
      success: false,
      output,
      error: `Command exited with code ${result.status}`
    }
  }

  return { success: true, output: output || '(no output)' }
}
