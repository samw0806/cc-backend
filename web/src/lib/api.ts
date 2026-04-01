import type {
  ConnectionSettings,
  SessionCreateResponse,
  SessionListResponse,
  SessionMessagesResponse,
} from '../types'

function normalizeBaseUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '')
}

function buildHeaders(settings: ConnectionSettings): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (settings.authToken) {
    headers.Authorization = `Bearer ${settings.authToken}`
  }

  return headers
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `HTTP ${response.status}`)
  }

  return response.json() as Promise<T>
}

export async function fetchSessions(settings: ConnectionSettings): Promise<SessionListResponse> {
  const response = await fetch(`${normalizeBaseUrl(settings.serverUrl)}/api/sessions`, {
    headers: buildHeaders(settings),
  })

  return parseJson<SessionListResponse>(response)
}

export async function createSession(settings: ConnectionSettings): Promise<SessionCreateResponse> {
  const response = await fetch(`${normalizeBaseUrl(settings.serverUrl)}/api/sessions`, {
    method: 'POST',
    headers: buildHeaders(settings),
    body: JSON.stringify({ cwd: settings.cwd }),
  })

  return parseJson<SessionCreateResponse>(response)
}

export async function resumeSession(settings: ConnectionSettings, sessionId: string): Promise<SessionCreateResponse> {
  const response = await fetch(`${normalizeBaseUrl(settings.serverUrl)}/api/sessions/${sessionId}/resume`, {
    method: 'POST',
    headers: buildHeaders(settings),
    body: JSON.stringify({ cwd: settings.cwd }),
  })

  return parseJson<SessionCreateResponse>(response)
}

export async function fetchSessionMessages(settings: ConnectionSettings, sessionId: string): Promise<SessionMessagesResponse> {
  const response = await fetch(`${normalizeBaseUrl(settings.serverUrl)}/api/sessions/${sessionId}/messages`, {
    headers: buildHeaders(settings),
  })

  return parseJson<SessionMessagesResponse>(response)
}

export async function deleteSession(settings: ConnectionSettings, sessionId: string): Promise<void> {
  const response = await fetch(`${normalizeBaseUrl(settings.serverUrl)}/api/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: buildHeaders(settings),
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `HTTP ${response.status}`)
  }
}

export function buildWebSocketUrl(settings: ConnectionSettings, sessionId: string): string {
  const base = normalizeBaseUrl(settings.serverUrl)
  const url = new URL(base.replace(/^http/, 'ws'))
  url.pathname = '/ws'
  url.searchParams.set('session', sessionId)

  if (settings.authToken) {
    url.searchParams.set('auth_token', settings.authToken)
  }

  return url.toString()
}
