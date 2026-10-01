// V2 — Fase 15: dias não trabalhados (folga, férias, doente, meio período, trabalho fora do PC).
export default `
CREATE TABLE day_status (
  date TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  minutes INTEGER,
  note TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;
