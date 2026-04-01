import type { TimelineItem } from '../types'

type TimelineViewProps = {
  timeline: TimelineItem[]
  onResolveRequest: (requestId: string, behavior: 'allow' | 'deny') => void
}

function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function TimelineView({ timeline, onResolveRequest }: TimelineViewProps) {
  if (timeline.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__title">No messages yet</div>
        <div className="empty-state__text">Start a new conversation or reopen a saved session from the left.</div>
      </div>
    )
  }

  return (
    <div className="timeline">
      {timeline.map((item) => {
        if (item.type === 'user') {
          return (
            <div key={item.id} className="timeline-row timeline-row--user">
              <div className="message-bubble message-bubble--user">{item.text}</div>
            </div>
          )
        }

        if (item.type === 'assistant') {
          return (
            <div key={item.id} className="timeline-row timeline-row--assistant">
              <div className="message-bubble message-bubble--assistant">
                {item.text}
                {item.streaming ? <span className="stream-caret" /> : null}
              </div>
            </div>
          )
        }

        if (item.type === 'status') {
          return (
            <div key={item.id} className="timeline-row timeline-row--status">
              <div className={`status-pill status-pill--${item.phase}`}>{item.label}</div>
            </div>
          )
        }

        if (item.type === 'tool_use') {
          return (
            <div key={item.id} className="event-card">
              <div className="event-card__header">
                <span className="event-card__label">Tool call</span>
                <strong>{item.toolName}</strong>
              </div>
              <pre>{renderJson(item.input)}</pre>
            </div>
          )
        }

        if (item.type === 'tool_result') {
          return (
            <div key={item.id} className={`event-card${item.success ? '' : ' event-card--error'}`}>
              <div className="event-card__header">
                <span className="event-card__label">Tool result</span>
                <strong>{item.toolName}</strong>
              </div>
              <pre>{item.output}</pre>
            </div>
          )
        }

        if (item.type === 'control_request') {
          return (
            <div key={item.id} className="event-card event-card--permission">
              <div className="event-card__header">
                <span className="event-card__label">Permission request</span>
                <strong>{item.toolName}</strong>
              </div>
              {item.reason ? <p className="event-card__reason">{item.reason}</p> : null}
              <pre>{renderJson(item.input)}</pre>
              <div className="permission-actions">
                <button
                  className="secondary-button"
                  disabled={Boolean(item.resolvedBehavior)}
                  onClick={() => onResolveRequest(item.requestId, 'deny')}
                >
                  Deny
                </button>
                <button
                  className="primary-button"
                  disabled={Boolean(item.resolvedBehavior)}
                  onClick={() => onResolveRequest(item.requestId, 'allow')}
                >
                  Allow
                </button>
                {item.resolvedBehavior ? (
                  <span className="permission-status">{item.resolvedBehavior === 'allow' ? 'Allowed' : 'Denied'}</span>
                ) : null}
              </div>
            </div>
          )
        }

        return (
          <div key={item.id} className="event-card event-card--error">
            <div className="event-card__header">
              <span className="event-card__label">Error</span>
            </div>
            <p>{item.message}</p>
          </div>
        )
      })}
    </div>
  )
}
