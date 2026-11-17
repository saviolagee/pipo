// Memória da equipe: fatos sobre o usuário e o negócio, lidos pelo Pipo branco e por todos os coloridos.
export default `
CREATE TABLE team_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'chat',
  created_at TEXT NOT NULL
);
`;
