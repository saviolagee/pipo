// V3 — painel por Pipo: tokens gastos pelos passos `agent` de cada execução (custo no painel).
export default `
ALTER TABLE pipo_runs ADD COLUMN tokens_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pipo_runs ADD COLUMN tokens_out INTEGER NOT NULL DEFAULT 0;
`;
