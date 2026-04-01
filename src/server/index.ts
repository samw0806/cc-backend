import { loadEnvFile } from './env.js'

async function main() {
  const envPath = loadEnvFile()
  const { AgentServer } = await import('./gateway/server-node.js')

  console.log('🚀 Claude Agent Server')
  console.log('======================')
  if (envPath) {
    console.log(`[Main] Loaded environment from ${envPath}`)
  }

  const server = new AgentServer()

  // 优雅关闭
  process.on('SIGINT', async () => {
    console.log('\n[Main] Received SIGINT, shutting down...')
    await server.stop()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.log('\n[Main] Received SIGTERM, shutting down...')
    await server.stop()
    process.exit(0)
  })

  try {
    await server.start()
  } catch (error) {
    console.error('[Main] Failed to start server:', error)
    process.exit(1)
  }
}

main()
