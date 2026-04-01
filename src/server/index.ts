import { AgentServer } from './gateway/server-node.js'

async function main() {
  console.log('🚀 Claude Agent Server')
  console.log('======================')

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
