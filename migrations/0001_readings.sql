-- Mackerel のメトリックと同じ縦持ちにし、種類や場所が増えてもマイグレーションを要らなくする。
-- Mackerel のメトリック名は `${kind}.${location}` になる。
CREATE TABLE readings (
  location TEXT NOT NULL,
  kind TEXT NOT NULL,
  -- unix 秒。同じ Cron の発火で読んだ値は、すべて発火の予定時刻にそろえる
  measured_at INTEGER NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (location, kind, measured_at)
) WITHOUT ROWID;
