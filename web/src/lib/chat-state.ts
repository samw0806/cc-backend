import type { ChatViewState, ServerEvent, SessionSummary, StoredMessage, TimelineItem } from '../types'

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function createEmptyState(): ChatViewState {
  return {
    timeline: [],
    streamingAssistantId: null,
    transientStatusId: null,
    connectionStatus: 'disconnected',
  }
}

function removeTimelineItem(timeline: TimelineItem[], itemId: string | null): TimelineItem[] {
  if (!itemId) return timeline
  return timeline.filter((entry) => entry.id !== itemId)
}

function getTextContent(content: StoredMessage['content']): string {
  if (typeof content === 'string') return content

  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ')
    .trim()
}

export function deriveTitleFromText(sessionId: string, text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return `Session ${sessionId}`
  return normalized.length > 48 ? `${normalized.slice(0, 45)}...` : normalized
}

export function deriveTitleFromTimeline(sessionId: string, timeline: TimelineItem[]): string {
  const firstUser = timeline.find((item) => item.type === 'user')
  return firstUser ? deriveTitleFromText(sessionId, firstUser.text) : `Session ${sessionId}`
}

export function hydrateTimeline(messages: StoredMessage[]): TimelineItem[] {
  return messages.flatMap((message) => {
    const text = getTextContent(message.content)
    if (!text) return []

    return [{
      id: makeId(message.role),
      type: message.role,
      text,
    } satisfies TimelineItem]
  })
}

export function mergeSessionGroups(
  activeSessions: SessionSummary[],
  persistedSessions: SessionSummary[] = [],
  persistedSessionIds: string[] = []
): SessionSummary[] {
  const merged = new Map<string, SessionSummary>()

  for (const session of [...activeSessions, ...persistedSessions]) {
    merged.set(session.session_id, session)
  }

  for (const sessionId of persistedSessionIds) {
    if (merged.has(sessionId)) continue

    merged.set(sessionId, {
      session_id: sessionId,
      title: `Session ${sessionId}`,
      status: 'persisted',
      message_count: 0,
      last_active_at: 0,
    })
  }

  return [...merged.values()].sort((a, b) => b.last_active_at - a.last_active_at)
}

export function applyServerEvent(
  currentState: ChatViewState | undefined,
  event: ServerEvent
): ChatViewState {
  const state = currentState ?? createEmptyState()

  if (event.type === 'status' && event.status === 'connected') {
    return { ...state, connectionStatus: 'connected' }
  }

  if (event.type === 'status' && event.status === 'thinking') {
    const nextTimeline = removeTimelineItem(state.timeline, state.transientStatusId)
    const nextStatusId = makeId('status')

    return {
      ...state,
      timeline: [...nextTimeline, { id: nextStatusId, type: 'status', label: 'Thinking', phase: 'thinking' }],
      transientStatusId: nextStatusId,
    }
  }

  if (event.type === 'assistant') {
    let nextTimeline = state.timeline
    let nextTransientStatusId = state.transientStatusId

    const transientStatus = nextTransientStatusId
      ? state.timeline.find((item) => item.id === nextTransientStatusId)
      : null

    if (transientStatus?.type === 'status' && transientStatus.phase === 'thinking') {
      nextTimeline = removeTimelineItem(nextTimeline, nextTransientStatusId)
      nextTransientStatusId = null
    }

    if (state.streamingAssistantId) {
      return {
        ...state,
        timeline: nextTimeline.map((item) => {
          if (item.id !== state.streamingAssistantId || item.type !== 'assistant') return item
          return { ...item, text: item.text + event.content }
        }),
        transientStatusId: nextTransientStatusId,
      }
    }

    const nextAssistantId = makeId('assistant')
    return {
      ...state,
      timeline: [...nextTimeline, { id: nextAssistantId, type: 'assistant', text: event.content, streaming: true }],
      streamingAssistantId: nextAssistantId,
      transientStatusId: nextTransientStatusId,
    }
  }

  if (event.type === 'status' && event.status.startsWith('executing:')) {
    const toolName = event.status.slice('executing:'.length)
    const nextTimeline = removeTimelineItem(state.timeline, state.transientStatusId)
    const nextStatusId = makeId('status')

    return {
      ...state,
      timeline: [...nextTimeline, { id: nextStatusId, type: 'status', label: `Running ${toolName}`, phase: 'executing' }],
      transientStatusId: nextStatusId,
    }
  }

  if (event.type === 'status' && event.status === 'complete') {
    const nextTimeline = state.timeline.map((item) => {
      if (item.id !== state.streamingAssistantId || item.type !== 'assistant') return item
      return { ...item, streaming: false }
    })

    return {
      ...state,
      timeline: [...nextTimeline, { id: makeId('status'), type: 'status', label: 'Complete', phase: 'complete' }],
      streamingAssistantId: null,
      transientStatusId: null,
    }
  }

  if (event.type === 'tool_use') {
    return {
      ...state,
      timeline: [
        ...state.timeline,
        {
          id: makeId('tool-use'),
          type: 'tool_use',
          toolName: event.tool_name,
          toolUseId: event.tool_use_id,
          input: event.tool_input,
        },
      ],
    }
  }

  if (event.type === 'tool_result') {
    return {
      ...state,
      timeline: [
        ...state.timeline,
        {
          id: makeId('tool-result'),
          type: 'tool_result',
          toolName: event.tool_name,
          toolUseId: event.tool_use_id,
          output: event.output,
          success: event.success,
        },
      ],
    }
  }

  if (event.type === 'control_request') {
    return {
      ...state,
      timeline: [
        ...state.timeline,
        {
          id: makeId('permission'),
          type: 'control_request',
          requestId: event.request_id,
          toolName: event.tool_name,
          input: event.tool_input,
          reason: event.reason,
        },
      ],
    }
  }

  if (event.type === 'error') {
    return {
      ...state,
      timeline: [...state.timeline, { id: makeId('error'), type: 'error', message: event.error }],
    }
  }

  return state
}

export function addUserMessage(state: ChatViewState, text: string): ChatViewState {
  return {
    ...state,
    timeline: [...state.timeline, { id: makeId('user'), type: 'user', text }],
  }
}

export function markControlRequestResolved(
  timeline: TimelineItem[],
  requestId: string,
  behavior: 'allow' | 'deny'
): TimelineItem[] {
  return timeline.map((item) => {
    if (item.type !== 'control_request' || item.requestId !== requestId) return item
    return { ...item, resolvedBehavior: behavior }
  })
}
