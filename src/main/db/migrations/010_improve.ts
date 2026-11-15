// Pipo que se aprimora: sugestões de nova versão (com a evidência de cada mudança) e a biblioteca de
// lições que deram certo, usada por todos os Pipos e pelo construtor.
export default `
CREATE TABLE pipo_improvements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipo_id INTEGER NOT NULL REFERENCES pipos(id) ON DELETE CASCADE,
  base_version INTEGER NOT NULL,
  run_id INTEGER,
  status TEXT NOT NULL,
  playbook_json TEXT,
  changes_json TEXT NOT NULL DEFAULT '[]',
  rules_json TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX idx_pipo_improvements_pipo ON pipo_improvements(pipo_id, id);
CREATE TABLE pipo_lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipo_id INTEGER,
  cue TEXT NOT NULL,
  lesson TEXT NOT NULL,
  evidence TEXT NOT NULL,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;
