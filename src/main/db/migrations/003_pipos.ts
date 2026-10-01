// V2 — Fases 16 a 23: Pipos coloridos (criados pelo usuário), versões do plano, gatilhos, execuções,
// memória, permissões, rascunhos, modelos próprios, conexões e caixa de entrada.
export default `
CREATE TABLE pipos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  accessory TEXT NOT NULL DEFAULT 'none',
  personality_json TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'sonnet',
  effort TEXT NOT NULL DEFAULT 'medium',
  paused INTEGER NOT NULL DEFAULT 0,
  run_on_days_off INTEGER NOT NULL DEFAULT 0,
  active_version INTEGER,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE pipo_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipo_id INTEGER NOT NULL REFERENCES pipos(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  playbook_json TEXT NOT NULL,
  changelog TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  approved_at TEXT,
  UNIQUE (pipo_id, version)
);

CREATE TABLE pipo_triggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipo_id INTEGER NOT NULL REFERENCES pipos(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_fired_at TEXT
);

CREATE TABLE pipo_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipo_id INTEGER NOT NULL REFERENCES pipos(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  summary TEXT,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  from_run_id INTEGER,
  error TEXT
);
CREATE INDEX idx_pipo_runs ON pipo_runs(pipo_id, started_at);

CREATE TABLE pipo_run_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES pipo_runs(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  preview TEXT,
  error TEXT
);

CREATE TABLE pipo_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipo_id INTEGER NOT NULL REFERENCES pipos(id) ON DELETE CASCADE,
  rule TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE pipo_permissions (
  pipo_id INTEGER NOT NULL REFERENCES pipos(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  always_allow INTEGER NOT NULL DEFAULT 0,
  limit_n INTEGER,
  PRIMARY KEY (pipo_id, step_key)
);

CREATE TABLE pipo_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_model_id INTEGER,
  stage TEXT NOT NULL,
  conversation_id INTEGER,
  draft_json TEXT NOT NULL,
  pipo_id INTEGER,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE pipo_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  personality_json TEXT NOT NULL,
  playbook_json TEXT NOT NULL,
  color TEXT NOT NULL,
  accessory TEXT NOT NULL,
  secrets_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE pipo_links (
  from_pipo_id INTEGER NOT NULL REFERENCES pipos(id) ON DELETE CASCADE,
  to_pipo_id INTEGER NOT NULL REFERENCES pipos(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  delay_min INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (from_pipo_id, to_pipo_id, kind)
);

CREATE TABLE pipo_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_pipo_id INTEGER NOT NULL REFERENCES pipos(id) ON DELETE CASCADE,
  from_run_id INTEGER NOT NULL,
  payload_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  run_after TEXT,
  created_at TEXT NOT NULL
);
`;
