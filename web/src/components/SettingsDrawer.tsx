import { useEffect, useState } from 'react'
import type { ConnectionSettings } from '../types'

type SettingsDrawerProps = {
  open: boolean
  settings: ConnectionSettings
  onClose: () => void
  onSave: (nextSettings: ConnectionSettings) => void
}

export function SettingsDrawer({ open, settings, onClose, onSave }: SettingsDrawerProps) {
  const [draft, setDraft] = useState(settings)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  return (
    <div className={`settings-drawer${open ? ' settings-drawer--open' : ''}`}>
      <div className="settings-drawer__backdrop" onClick={onClose} />
      <div className="settings-drawer__panel">
        <div className="settings-drawer__header">
          <div>
            <div className="eyebrow">Connection</div>
            <h2>Settings</h2>
          </div>
          <button className="ghost-button" onClick={onClose}>Close</button>
        </div>

        <label className="field">
          <span>Server URL</span>
          <input
            value={draft.serverUrl}
            onChange={(event) => setDraft({ ...draft, serverUrl: event.target.value })}
            placeholder="http://127.0.0.1:3000"
          />
        </label>

        <label className="field">
          <span>Auth token</span>
          <input
            value={draft.authToken}
            onChange={(event) => setDraft({ ...draft, authToken: event.target.value })}
            placeholder="Optional bearer token"
          />
        </label>

        <label className="field">
          <span>Default workspace</span>
          <input
            value={draft.cwd}
            onChange={(event) => setDraft({ ...draft, cwd: event.target.value })}
            placeholder="/tmp/claude-workspaces/web"
          />
        </label>

        <button
          className="primary-button primary-button--block"
          onClick={() => {
            onSave(draft)
            onClose()
          }}
        >
          Save settings
        </button>
      </div>
    </div>
  )
}
