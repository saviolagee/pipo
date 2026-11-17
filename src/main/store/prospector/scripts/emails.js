'use strict';
// Contas puras do Prospector: formatos de e-mail de uma pessoa e a escolha da variante a testar.
const L = require('./lib.js');

const PARTICLES = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'del', 'la', 'van', 'von', 'di']);

/** Formatos de e-mail mais comuns em empresas, do mais para o menos provável. */
function forms(nome) {
  const parts = L.plain(nome).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((p) => p && !PARTICLES.has(p));
  if (!parts.length) return {};
  const f = parts[0];
  const l = parts[parts.length - 1];
  if (parts.length === 1) return { nome: f };
  return { 'nome.sobrenome': `${f}.${l}`, nome: f, nsobrenome: `${f[0]}${l}`, nomesobrenome: `${f}${l}`, nome_sobrenome: `${f}_${l}`, 'n.sobrenome': `${f[0]}.${l}`, sobrenome: l, nomes: `${f}${l[0]}` };
}

/** Endereços candidatos para a pessoa naquele domínio; o formato já visto na empresa vem primeiro. */
function candidates(nome, dominio, padrao) {
  const all = forms(nome);
  const first = all[L.lower(padrao).replace(/\s/g, '')];
  return [...new Set([first, ...Object.values(all)].filter(Boolean))].map((local) => `${local}@${dominio}`);
}

/** A variante com mais chance de ensinar algo: boa taxa de resposta ou ainda pouco testada (UCB). */
function pickVariant(stats, extra) {
  const active = stats.filter((v) => v.ativa !== false);
  if (!active.length) return null;
  const total = active.reduce((n, v) => n + v.enviados + (extra[v.id] || 0), 0) + 1;
  let best = null;
  for (const v of active) {
    const n = v.enviados + (extra[v.id] || 0);
    const score = (v.respostas + 1) / (n - v.bounces + 2) + Math.sqrt((2 * Math.log(total + 1)) / (n + 1));
    if (!best || score > best.score) best = { v, score };
  }
  extra[best.v.id] = (extra[best.v.id] || 0) + 1;
  return best.v;
}

const nextId = (variants) => {
  const used = new Set(variants.map((v) => v.id));
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(c)) return c;
  return `V${variants.length + 1}`;
};

module.exports = { forms, candidates, pickVariant, nextId };
