CREATE TABLE IF NOT EXISTS memo (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO memo (id, content, version, updated_at)
VALUES (1, '', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
