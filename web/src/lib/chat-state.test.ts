import { describe, expect, it } from 'vitest'
import { applyServerEvent, mergeSessionGroups } from './chat-state'

describe('mergeSessionGroups', () => {
  it('sorts active and persisted sessions by last activity and preserves titles', () => {
    const sessions = mergeSessionGroups(
      [
        { session_id: 'active-1', title: 'Active conversation', status: 'active', message_count: 3, last_active_at: 10 },
      ],
      [
        { session_id: 'persisted-1', title: 'Older thread', status: 'persisted', message_count: 12, last_active_at: 5 },
      ],
      ['persisted-2']
    )

    expect(sessions.map((entry) => entry.session_id)).toEqual(['active-1', 'persisted-1', 'persisted-2'])
    expect(sessions[2].title).toBe('Session persisted-2')
  })
})

describe('applyServerEvent', () => {
  it('merges assistant text chunks into one streaming message and tracks execution status', () => {
    let state = applyServerEvent(undefined, { type: 'status', status: 'thinking' })
    state = applyServerEvent(state, { type: 'assistant', content: 'API' })
    state = applyServerEvent(state, { type: 'assistant', content: '_OK' })
    state = applyServerEvent(state, { type: 'status', status: 'executing:Read' })
    state = applyServerEvent(state, { type: 'status', status: 'complete' })

    expect(state.timeline.at(-3)?.type).toBe('assistant')
    expect(state.timeline.at(-3)).toMatchObject({ text: 'API_OK' })
    expect(state.timeline.at(-2)).toMatchObject({ type: 'status', label: 'Running Read' })
    expect(state.timeline.at(-1)).toMatchObject({ type: 'status', label: 'Complete' })
    expect(state.streamingAssistantId).toBeNull()
  })
})
