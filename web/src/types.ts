export type SessionStatus = 'active' | 'persisted'

export type SessionSummary = {
  session_id: string
  title: string
  status: SessionStatus
  message_count: number
  last_active_at: number
  cwd?: string
  connected_clients?: number
}

export type SessionListResponse = {
  sessions: SessionSummary[]
  persisted_sessions?: SessionSummary[]
  persisted_session_ids?: string[]
}

export type StoredMessage = {
  role: 'user' | 'assistant'
  content: string | Array<{ type?: string; text?: string }>
}

export type SessionMessagesResponse = {
  session_id: string
  messages: StoredMessage[]
  count: number
}

export type SessionCreateResponse = {
  session_id: string
  ws_url: string
  cwd?: string
  created_at?: number
  message_count?: number
  status?: string
}

export type ServerEvent =
  | { type: 'status'; status: string; session_id?: string }
  | { type: 'assistant'; content: string }
  | { type: 'tool_use'; tool_name: string; tool_use_id: string; tool_input: unknown }
  | { type: 'tool_result'; tool_use_id: string; tool_name: string; success: boolean; output: string }
  | { type: 'control_request'; request_id: string; tool_name: string; tool_input: unknown; reason?: string }
  | { type: 'error'; error: string }

export type TimelineItem =
  | { id: string; type: 'user'; text: string }
  | { id: string; type: 'assistant'; text: string; streaming?: boolean }
  | { id: string; type: 'status'; label: string; phase: 'thinking' | 'executing' | 'complete' }
  | { id: string; type: 'tool_use'; toolName: string; toolUseId: string; input: unknown }
  | { id: string; type: 'tool_result'; toolName: string; toolUseId: string; output: string; success: boolean }
  | { id: string; type: 'control_request'; requestId: string; toolName: string; input: unknown; reason?: string; resolvedBehavior?: 'allow' | 'deny' }
  | { id: string; type: 'error'; message: string }

export type ChatViewState = {
  timeline: TimelineItem[]
  streamingAssistantId: string | null
  transientStatusId: string | null
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
}

export type ConnectionSettings = {
  serverUrl: string
  authToken: string
  cwd: string
}
