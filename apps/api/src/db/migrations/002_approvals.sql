CREATE TABLE IF NOT EXISTS approval_requests (
  handle_hash TEXT PRIMARY KEY,
  user_lookup TEXT NOT NULL UNIQUE
    REFERENCES users (lookup_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'decided')),
  decision TEXT CHECK (decision IN ('allow', 'reject')),
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE INDEX IF NOT EXISTS approval_requests_status_idx
  ON approval_requests (status);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
