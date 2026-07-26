CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  lookup_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (
    state IN (
      'pending',
      'approved_unbound',
      'authenticating',
      'active',
      'reauth_required',
      'disabled',
      'deleted'
    )
  ),
  wrapped_dek TEXT NOT NULL,
  identity_cipher TEXT NOT NULL,
  max_session_cipher TEXT,
  preferences_cipher TEXT,
  crypto_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_lookup TEXT NOT NULL,
  event_code TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_events_occurred_at_idx
  ON audit_events (occurred_at);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
