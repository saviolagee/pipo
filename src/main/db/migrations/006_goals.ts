// V3 — trilha de objetivos: o plano e as ações por dia (a data final escorrega quando uma atrasa).
export default `
CREATE TABLE goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT '',
  target_date TEXT,
  weekdays_json TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE goal_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  day TEXT NOT NULL,
  planned_day TEXT NOT NULL,
  done_at TEXT
);
CREATE INDEX idx_goal_actions_goal ON goal_actions(goal_id, position);
`;
