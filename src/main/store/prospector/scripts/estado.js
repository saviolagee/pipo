'use strict';
// Passo 1: confere a configuração e conta o que já existe na base (empresas conhecidas, variantes
// em teste, quanto ainda dá para enviar hoje). Não muda nada.
const L = require('./lib.js');

L.main(() => {
  const c = L.config();
  const miss = L.missing(c);
  if (miss.length) throw new Error(`Falta configurar o Prospector: ${miss.join(', ')}. Abra Equipe → Prospector → Configurar.`);
  const base = L.loadBase();
  const stats = L.variantStats(L.loadVariants(), base.leads);
  const active = stats.filter((v) => v.ativa !== false);
  // Sempre pelo menos duas apostas em teste; uma desafiante entra quando as atuais já têm amostra.
  let pedirVariantes = Math.max(0, 2 - active.length);
  if (!pedirVariantes && active.length < 3 && active.every((v) => v.enviados >= 25)) pedirVariantes = 1;
  const view = (v) => ({ id: v.id, angulo: v.angulo, assunto: v.assunto, enviados: v.enviados, respostas: v.respostas, interessados: v.interessados, taxa: v.taxa });
  return {
    config: { busca: c.busca, decisores: c.decisores, oferta: c.oferta, remetente: c.remetente, leadsPorRodada: c.leadsPorRodada },
    conta: !!L.account(),
    podeEnviarHoje: Math.max(0, c.limiteDia - L.sentToday(base)),
    empresasConhecidas: Object.values(base.empresas).map((e) => e.nome).filter(Boolean).slice(-250),
    variantes: active.map(view),
    aposentadas: stats.filter((v) => v.ativa === false).slice(-6).map(view),
    pedirVariantes,
    totais: L.totals(base.leads),
  };
});
