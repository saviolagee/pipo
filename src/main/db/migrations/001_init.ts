// Esquema inicial (seção 14).
export default `
CREATE TABLE profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  work_days_json TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  lunch_start TEXT NOT NULL,
  lunch_min INTEGER NOT NULL,
  daily_goal_min INTEGER NOT NULL,
  goal_per_day_json TEXT,
  energy_peak TEXT NOT NULL,
  focus_preset_json TEXT NOT NULL,
  presence_level TEXT NOT NULL,
  interrupt_budget INTEGER NOT NULL,
  tone TEXT NOT NULL,
  autostart INTEGER NOT NULL DEFAULT 0,
  onboarded_at TEXT
);

CREATE TABLE rituals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  color TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  due_at TEXT,
  estimate_min INTEGER,
  priority INTEGER NOT NULL DEFAULT 2,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  snooze_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  is_today INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_tasks_status ON tasks(status);

CREATE TABLE subtasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_subtasks_task ON subtasks(task_id);

CREATE TABLE focus_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  preset_json TEXT NOT NULL,
  cycles_done INTEGER NOT NULL DEFAULT 0,
  focused_sec INTEGER NOT NULL DEFAULT 0,
  distracted_sec INTEGER NOT NULL DEFAULT 0,
  micro_step TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX idx_focus_started ON focus_sessions(started_at);

CREATE TABLE activity_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  app TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  url TEXT,
  category TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  idle INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_activity_started ON activity_blocks(started_at);

CREATE TABLE interruptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  outcome TEXT NOT NULL
);
CREATE INDEX idx_interruptions_at ON interruptions(at);

CREATE TABLE mood_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  mood INTEGER NOT NULL,
  components_json TEXT NOT NULL
);

CREATE TABLE streaks (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_days INTEGER NOT NULL DEFAULT 0,
  best_days INTEGER NOT NULL DEFAULT 0,
  unlocked_json TEXT NOT NULL DEFAULT '[]',
  equipped_json TEXT NOT NULL DEFAULT '[]',
  last_day TEXT
);

CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  claude_session_id TEXT
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  tokens_encrypted BLOB,
  meta_json TEXT NOT NULL DEFAULT '{}',
  connected_at TEXT
);

CREATE TABLE tool_permissions (
  tool_name TEXT PRIMARY KEY,
  always_allow INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
`;
