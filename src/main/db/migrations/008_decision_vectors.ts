// Modelo local do Pipo: guarda o vetor de cada exemplo (o texto "lido" pelo modelo de leitura),
// para não ler de novo a cada treino.
export default `
ALTER TABLE decisions ADD COLUMN embedding BLOB;
`;
