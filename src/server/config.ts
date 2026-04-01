import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { ServerConfig } from '../core/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let cachedConfig: ServerConfig | null = null

export function loadServerConfig(): ServerConfig {
  if (cachedConfig) {
    return cachedConfig
  }

  // 从配置文件加载
  const configPath = join(__dirname, '../../config', 'server.config.json')
  const configFile = JSON.parse(readFileSync(configPath, 'utf-8'))

  // 环境变量覆盖
  cachedConfig = {
    port: parseInt(process.env.PORT || String(configFile.port)),
    host: process.env.HOST || configFile.host,
    authToken: process.env.AUTH_TOKEN || configFile.authToken,
    maxSessions: parseInt(process.env.MAX_SESSIONS || String(configFile.maxSessions)),
    sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS || String(configFile.sessionTimeoutMs)),
    workspaceRoot: process.env.WORKSPACE_ROOT || configFile.workspaceRoot,
    allowedPaths: configFile.allowedPaths,
    defaultPermissionMode: configFile.defaultPermissionMode,
    forcePermissions: configFile.forcePermissions,
    maxConcurrentTools: configFile.maxConcurrentTools,
    enableFileCache: configFile.enableFileCache,
    permissionRules: configFile.permissionRules || []
  }

  return cachedConfig
}

export function getConfig(): ServerConfig {
  if (!cachedConfig) {
    throw new Error('Config not loaded. Call loadServerConfig() first.')
  }
  return cachedConfig
}
