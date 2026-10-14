// V3 — passo `decide`: cada decisão vira um exemplo da atividade (base do ajuste fino do modelo local).
export default `
CREATE TABLE decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity TEXT NOT NULL,
  pipo_id INTEGER,
  run_id INTEGER,
  state TEXT NOT NULL,
  question TEXT NOT NULL,
  options_json TEXT NOT NULL,
  choice TEXT NOT NULL,
  confidence REAL,
  source TEXT NOT NULL,
  corrected TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_decisions_activity ON decisions(activity, id);
`;
