-- Preserve the original memo, including its version, as tab 1.
CREATE TABLE memo_tabs (
  id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 5),
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
INSERT INTO memo_tabs (id, content, version, updated_at)
SELECT id, content, version, updated_at FROM memo;
INSERT INTO memo_tabs (id, content, version, updated_at)
VALUES
  (2, '', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (3, '', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (4, '', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (5, '', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
DROP TABLE memo;
ALTER TABLE memo_tabs RENAME TO memo;
