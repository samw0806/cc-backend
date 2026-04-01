import { useEffect, useMemo, useRef, useState } from 'react'
import { SessionSidebar } from './components/SessionSidebar'
import { SettingsDrawer } from './components/SettingsDrawer'
import { TimelineView } from './components/TimelineView'
import { buildWebSocketUrl, createSession, deleteSession, fetchSessionMessages, fetchSessions, resumeSession } from './lib/api'
import {
  addUserMessage,
  applyServerEvent,
  deriveTitleFromTimeline,
  hydrateTimeline,
  markControlRequestResolved,
  mergeSessionGroups,
} from './lib/chat-state'
import type { ChatViewState, ConnectionSettings, ServerEvent, SessionSummary } from './types'

const SETTINGS_KEY = 'claude-agent-console-settings'

const defaultSettings: ConnectionSettings = {
  serverUrl: 'http://127.0.0.1:3000',
  authToken: 'dev-token-change-in-production',
  cwd: '/tmp/claude-workspaces/web',
}

function loadInitialSettings(): ConnectionSettings {
  const stored = localStorage.getItem(SETTINGS_KEY)
  if (!stored) return defaultSettings

  try {
    return { ...defaultSettings, ...JSON.parse(stored) }
  } catch {
    return defaultSettings
  }
}

function createEmptyChatState(): ChatViewState {
  return {
    timeline: [],
    streamingAssistantId: null,
    transientStatusId: null,
    connectionStatus: 'disconnected',
  }
}

export default function App() {
  const [settings, setSettings] = useState<ConnectionSettings>(() => loadInitialSettings())
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [chatState, setChatState] = useState<ChatViewState>(createEmptyChatState())
  const [composerValue, setComposerValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeSessionStatus, setActiveSessionStatus] = useState<'active' | 'persisted' | null>(null)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const activeSession = useMemo(
    () => sessions.find((session) => session.session_id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  )

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    void refreshSessions()
  }, [settings.serverUrl, settings.authToken])

  useEffect(() => {
    timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight })
  }, [chatState.timeline])

  useEffect(() => {
    return () => {
      wsRef.current?.close()
    }
  }, [])

  async function refreshSessions() {
    try {
      const response = await fetchSessions(settings)
      setSessions(mergeSessionGroups(response.sessions, response.persisted_sessions, response.persisted_session_ids))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
    }
  }

  function connectSocket(sessionId: string) {
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
    }
    setChatState((current) => ({ ...current, connectionStatus: 'connecting' }))

    const ws = new WebSocket(buildWebSocketUrl(settings, sessionId))
    wsRef.current = ws

    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data) as ServerEvent
      setChatState((current) => applyServerEvent(current, payload))
    }

    ws.onerror = () => {
      if (wsRef.current !== ws) return
      setError('WebSocket connection failed')
    }

    ws.onclose = () => {
      if (wsRef.current !== ws) return
      setChatState((current) => ({ ...current, connectionStatus: 'disconnected', streamingAssistantId: null, transientStatusId: null }))
    }
  }

  async function openSession(session: SessionSummary) {
    setLoading(true)
    setError(null)

    try {
      if (session.status === 'persisted') {
        await resumeSession(settings, session.session_id)
      }

      const messages = await fetchSessionMessages(settings, session.session_id)
      setActiveSessionId(session.session_id)
      setActiveSessionStatus('active')
      setChatState({
        ...createEmptyChatState(),
        timeline: hydrateTimeline(messages.messages),
      })
      connectSocket(session.session_id)
      await refreshSessions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open session')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateSession() {
    setLoading(true)
    setError(null)

    try {
      const created = await createSession(settings)
      const session: SessionSummary = {
        session_id: created.session_id,
        title: `Session ${created.session_id}`,
        status: 'active',
        message_count: 0,
        last_active_at: created.created_at ?? Date.now(),
        cwd: created.cwd,
      }

      setActiveSessionId(session.session_id)
      setActiveSessionStatus('active')
      setChatState(createEmptyChatState())
      connectSocket(session.session_id)
      setSessions((current) => mergeSessionGroups([session, ...current.filter((entry) => entry.session_id !== session.session_id)], []))
      await refreshSessions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteSession(session: SessionSummary) {
    try {
      await deleteSession(settings, session.session_id)
      if (activeSessionId === session.session_id) {
        wsRef.current?.close()
        setActiveSessionId(null)
        setActiveSessionStatus(null)
        setChatState(createEmptyChatState())
      }

      await refreshSessions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete session')
    }
  }

  function handleSendMessage() {
    const value = composerValue.trim()
    if (!value || !activeSessionId || wsRef.current?.readyState !== WebSocket.OPEN) return

    wsRef.current.send(JSON.stringify({
      type: 'user_message',
      content: value,
      uuid: crypto.randomUUID(),
    }))

    setChatState((current) => addUserMessage(current, value))
    setComposerValue('')

    setSessions((current) => current.map((session) => {
      if (session.session_id !== activeSessionId) return session

      const nextTitle = session.message_count === 0 ? deriveTitleFromTimeline(activeSessionId, [...chatState.timeline, { id: 'pending-user', type: 'user', text: value }]) : session.title
      return {
        ...session,
        title: nextTitle,
        message_count: session.message_count + 1,
        last_active_at: Date.now(),
        status: 'active',
      }
    }))
  }

  function handleResolveRequest(requestId: string, behavior: 'allow' | 'deny') {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return

    wsRef.current.send(JSON.stringify({
      type: 'control_response',
      request_id: requestId,
      response: { behavior },
    }))

    setChatState((current) => ({
      ...current,
      timeline: markControlRequestResolved(current.timeline, requestId, behavior),
    }))
  }

  return (
    <div className="app-shell">
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        loading={loading}
        onCreateSession={handleCreateSession}
        onSelectSession={openSession}
        onDeleteSession={handleDeleteSession}
      />

      <main className="main-panel">
        <header className="main-panel__header">
          <div>
            <div className="eyebrow">Conversation</div>
            <h2>{activeSession?.title ?? 'Claude Agent'}</h2>
          </div>
          <div className="header-actions">
            <span className={`connection-indicator connection-indicator--${chatState.connectionStatus}`}>
              {chatState.connectionStatus}
            </span>
            {activeSessionStatus ? <span className="session-badge session-badge--active">{activeSessionStatus}</span> : null}
            <button className="ghost-button" onClick={() => setSettingsOpen(true)}>Settings</button>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="main-panel__timeline" ref={timelineRef}>
          <TimelineView timeline={chatState.timeline} onResolveRequest={handleResolveRequest} />
        </div>

        <div className="composer">
          <textarea
            value={composerValue}
            onChange={(event) => setComposerValue(event.target.value)}
            placeholder={activeSessionId ? 'Message Claude Agent...' : 'Create or open a session to start chatting'}
            disabled={!activeSessionId || chatState.connectionStatus !== 'connected'}
            rows={1}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handleSendMessage()
              }
            }}
          />
          <button className="primary-button" disabled={!activeSessionId || chatState.connectionStatus !== 'connected'} onClick={handleSendMessage}>
            Send
          </button>
        </div>
      </main>

      <SettingsDrawer
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={(nextSettings) => {
          setSettings(nextSettings)
          void refreshSessions()
        }}
      />
    </div>
  )
}
