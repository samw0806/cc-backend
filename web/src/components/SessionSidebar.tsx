import type { SessionSummary } from '../types'

type SessionSidebarProps = {
  sessions: SessionSummary[]
  activeSessionId: string | null
  loading: boolean
  onCreateSession: () => void
  onSelectSession: (session: SessionSummary) => void
  onDeleteSession: (session: SessionSummary) => void
}

function formatTimestamp(timestamp: number): string {
  if (!timestamp) return 'No activity yet'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  loading,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
}: SessionSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Agent Console</h1>
        </div>
        <button className="primary-button" onClick={onCreateSession} disabled={loading}>
          New chat
        </button>
      </div>

      <div className="sidebar__list">
        {sessions.length === 0 ? (
          <div className="sidebar__empty">No sessions yet. Start a new conversation to begin.</div>
        ) : null}

        {sessions.map((session) => {
          const active = session.session_id === activeSessionId

          return (
            <div
              key={session.session_id}
              className={`session-card${active ? ' session-card--active' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelectSession(session)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelectSession(session)
                }
              }}
            >
              <div className="session-card__row">
                <span className={`session-badge session-badge--${session.status}`}>{session.status}</span>
                <span className="session-card__time">{formatTimestamp(session.last_active_at)}</span>
              </div>
              <div className="session-card__title">{session.title}</div>
              <div className="session-card__meta">
                <span>{session.message_count} msgs</span>
                <span>{session.session_id.slice(0, 8)}</span>
              </div>
              <button
                type="button"
                className="session-card__delete"
                onClick={(event) => {
                  event.stopPropagation()
                  onDeleteSession(session)
                }}
              >
                Delete
              </button>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
