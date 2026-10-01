// V2 — Fase 23: modelos próprios e .pipo levam os arquivos do Pipo (scripts/, templates/, mcp.json).
export default `
ALTER TABLE pipo_models ADD COLUMN files_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE pipo_models ADD COLUMN triggers_json TEXT NOT NULL DEFAULT '{}';
`;
