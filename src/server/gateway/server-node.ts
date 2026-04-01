import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { parse } from 'url'
import { SessionManager } from '../session/SessionManager.js'
import { RemotePermissionHandler } from '../permissions/RemotePermissionHandler.js'
import { loadServerConfig, getConfig } from '../config.js'
import { mkdirSync, existsSync } from 'fs'

export class AgentServer {
  private httpServer?: ReturnType<typeof createServer>
  private wss?: WebSocketServer
  private sessionManager: SessionManager
  private cleanupInterval?: NodeJS.Timeout
  private connections: Map<string, Set<WebSocket>> = new Map()
  private permHandlers: Map<string, RemotePermissionHandler> = new Map()

  constructor() {
    this.sessionManager = new SessionManager()
  }

  async start() {
    const config = loadServerConfig()
    console.log(`[Server] Starting on ${config.host}:${config.port}`)

    if (!existsSync(config.workspaceRoot)) {
      mkdirSync(config.workspaceRoot, { recursive: true })
      console.log(`[Server] Created workspace: ${config.workspaceRoot}`)
    }

    this.httpServer = createServer(async (req, res) => {
      await this.handleRequest(req, res)
    })

    this.wss = new WebSocketServer({ noServer: true })

    this.httpServer.on('upgrade', (req, socket, head) => {
      const { pathname, query } = parse(req.url!, true)
      if (pathname === '/ws') {
        const sessionId = query.session as string
        if (!sessionId || !this.sessionManager.getSession(sessionId)) {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
          socket.destroy()
          return
        }
        this.wss!.handleUpgrade(req, socket, head, (ws) => {
          this.onWsConnect(ws, sessionId)
        })
      } else {
        socket.destroy()
      }
    })

    this.httpServer.listen(config.port, config.host, () => {
      console.log(`\n✅ Server running at http://${config.host}:${config.port}`)
      console.log(`   WebSocket : ws://localhost:${config.port}/ws?session=<id>`)
      console.log(`   Auth token: ${config.authToken ?? '(none)'}`)
      console.log(`   Workspace : ${config.workspaceRoot}\n`)
    })

    this.cleanupInterval = setInterval(() => {
      this.sessionManager.cleanupExpiredSessions(config.sessionTimeoutMs)
    }, 60_000)
  }

  async stop() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval)
    this.wss?.close()
    this.httpServer?.close()
    console.log('[Server] Stopped')
  }

  // ─── WebSocket ────────────────────────────────────────────────────────────

  private onWsConnect(ws: WebSocket, sessionId: string) {
    console.log(`[WS] connected  session=${sessionId}`)

    if (!this.connections.has(sessionId)) this.connections.set(sessionId, new Set())
    this.connections.get(sessionId)!.add(ws)

    if (!this.permHandlers.has(sessionId)) {
      this.permHandlers.set(sessionId, new RemotePermissionHandler(getConfig().permissionRules))
    }

    ws.send(JSON.stringify({ type: 'status', status: 'connected', session_id: sessionId }))

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'user_message') {
          await this.handleUserMessage(sessionId, msg.content)
        } else {
          ws.send(JSON.stringify({ type: 'error', error: `Unknown message type: ${msg.type}` }))
        }
      } catch (e: any) {
        ws.send(JSON.stringify({ type: 'error', error: e.message }))
      }
    })

    ws.on('close', () => {
      console.log(`[WS] disconnected  session=${sessionId}`)
      this.connections.get(sessionId)?.delete(ws)
    })

    ws.on('error', (e) => console.error('[WS] error:', e.message))
  }

  private async handleUserMessage(sessionId: string, content: string) {
    await this.sessionManager.processMessage(
      sessionId,
      content,
      (msg) => this.broadcast(sessionId, msg),
      this.permHandlers.get(sessionId)
    )
  }

  private broadcast(sessionId: string, msg: any) {
    const conns = this.connections.get(sessionId)
    if (!conns?.size) return
    const payload = JSON.stringify(msg)
    for (const ws of conns) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload)
    }
  }

  // ─── HTTP ─────────────────────────────────────────────────────────────────

  private async handleRequest(req: any, res: any) {
    const config = getConfig()
    const { pathname } = parse(req.url!)

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return }

    // 认证
    if (config.authToken) {
      const auth = req.headers['authorization']
      if (!auth || auth !== `Bearer ${config.authToken}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' })); return
      }
    }

    if (pathname === '/api/sessions' && req.method === 'POST') return this.routeCreateSession(req, res)
    if (pathname === '/api/sessions' && req.method === 'GET')  return this.routeListSessions(res)
    if (pathname?.match(/^\/api\/sessions\/[^/]+$/) && req.method === 'DELETE') return this.routeDeleteSession(pathname, res)
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', sessions: this.sessionManager.getAllSessions().length }))
      return
    }

    res.writeHead(404); res.end('Not Found')
  }

  private async routeCreateSession(req: any, res: any) {
    try {
      let body = ''
      for await (const chunk of req) body += chunk
      const { cwd, userId } = JSON.parse(body)

      if (!cwd) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'cwd is required' })); return
      }

      const session = await this.sessionManager.createSession({ cwd, userId })
      const config = getConfig()

      res.writeHead(201, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        session_id: session.id,
        ws_url: `ws://localhost:${config.port}/ws?session=${session.id}`,
        cwd: session.cwd,
        created_at: session.createdAt
      }))
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
  }

  private routeListSessions(res: any) {
    const sessions = this.sessionManager.getAllSessions()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      sessions: sessions.map(s => ({
        session_id: s.id,
        cwd: s.cwd,
        created_at: s.createdAt,
        last_active_at: s.lastActiveAt,
        connected_clients: this.connections.get(s.id)?.size ?? 0
      }))
    }))
  }

  private async routeDeleteSession(pathname: string, res: any) {
    const sessionId = pathname.split('/').pop()!
    await this.sessionManager.destroySession(sessionId)
    const conns = this.connections.get(sessionId)
    if (conns) {
      for (const ws of conns) try { ws.close() } catch {}
      this.connections.delete(sessionId)
    }
    this.permHandlers.delete(sessionId)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'deleted' }))
  }
}
