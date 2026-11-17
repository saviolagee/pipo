'use strict';
// Fecha a rodada: recalcula os números de cada variante (assunto e abordagem em teste), aposenta a
// que está perdendo com amostra suficiente e escreve o relatório (HTML) e o resumo do aviso.
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');

const MIN_SAMPLE = 20;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Aposenta quem, com amostra, responde menos da metade da melhor (e a melhor tem vantagem real). */
function retire(stats, now) {
  const active = stats.filter((v) => v.ativa !== false);
  const mature = active.filter((v) => v.enviados - v.bounces >= MIN_SAMPLE);
  if (active.length < 2 || mature.length < 2) return [];
  const best = mature.reduce((a, b) => (b.taxa > a.taxa ? b : a));
  const out = [];
  for (const v of mature) {
    if (v.id === best.id || active.length - out.length <= 1) continue;
    if (v.taxa < best.taxa * 0.5 && best.respostas - v.respostas >= 2) out.push({ id: v.id, motivo: `${v.taxa}% de resposta contra ${best.taxa}% da variante ${best.id}`, em: now });
  }
  return out;
}

function html(c, t, stats, leads) {
  const rows = stats
    .map((v) => `<tr class="${v.ativa === false ? 'off' : ''}"><td><b>${esc(v.id)}</b></td><td>${esc(v.angulo)}</td><td>${esc(v.assunto)}</td><td>${v.enviados}</td><td>${v.respostas}</td><td>${v.interessados}</td><td>${v.bounces}</td><td><b>${v.taxa}%</b></td><td>${v.ativa === false ? `aposentada${v.motivo ? ` (${esc(v.motivo)})` : ''}` : 'em teste'}</td></tr>`)
    .join('');
  const hot = leads
    .filter((l) => ['interessado', 'depois', 'respondeu'].includes(l.status))
    .slice(-40)
    .reverse()
    .map((l) => `<tr><td>${esc(l.nome || '—')}</td><td>${esc(l.cargo)}</td><td>${esc(l.empresa)}</td><td>${esc(l.email)}</td><td>${esc(l.status)}</td><td>${esc(l.respostaResumo || l.respostaTrecho || '')}</td></tr>`)
    .join('');
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Prospector · relatório</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:32px;color:#18181b;background:#fafafa}h1{font-size:20px}h2{font-size:15px;margin-top:28px}table{border-collapse:collapse;width:100%;background:#fff}td,th{border:1px solid #e4e4e7;padding:6px 9px;text-align:left;vertical-align:top}th{background:#f4f4f5;font-weight:600}.off td{color:#a1a1aa}.k{display:inline-block;margin-right:22px}.k b{font-size:22px;display:block}</style>
<h1>Prospector · ${esc(new Date().toLocaleString('pt-BR'))}</h1>
<p>Busca: ${esc(c.busca)}</p>
<p><span class="k"><b>${t.leads}</b>leads na base</span><span class="k"><b>${t.enviados}</b>e-mails enviados</span><span class="k"><b>${t.respostas}</b>respostas</span><span class="k"><b>${t.interessados}</b>interessados</span><span class="k"><b>${t.taxaResposta}%</b>taxa de resposta</span><span class="k"><b>${t.bounces}</b>e-mails que voltaram</span></p>
<h2>Testes de assunto e abordagem</h2>
<table><tr><th></th><th>Aposta</th><th>Assunto</th><th>Enviados</th><th>Respostas</th><th>Interessados</th><th>Voltaram</th><th>Taxa</th><th>Situação</th></tr>${rows || '<tr><td colspan="9">Ainda sem envios.</td></tr>'}</table>
<h2>Quem respondeu</h2>
<table><tr><th>Nome</th><th>Cargo</th><th>Empresa</th><th>E-mail</th><th>Situação</th><th>O que disse</th></tr>${hot || '<tr><td colspan="6">Ninguém ainda.</td></tr>'}</table></html>`;
}

L.main(() => {
  const c = L.config();
  const ctx = L.context();
  const base = L.loadBase();
  const variants = L.loadVariants();
  const now = new Date().toISOString();
  let stats = L.variantStats(variants, base.leads);
  const aposentadas = retire(stats, now);
  for (const r of aposentadas) {
    const v = variants.find((x) => x.id === r.id);
    if (v) Object.assign(v, { ativa: false, motivo: r.motivo, aposentadaEm: r.em });
  }
  if (aposentadas.length) {
    L.saveVariants(variants);
    stats = L.variantStats(variants, base.leads);
  }
  const t = L.totals(base.leads);
  const send = L.stepOut(ctx, 'enviar') || {};
  const val = L.stepOut(ctx, 'validar') || {};
  const rep = L.stepOut(ctx, 'respostas') || {};
  const enviadosAgora = Number(send.enviados || 0);
  const respostasNovas = (rep.novas || []).length;
  const interessadosNovos = Number(val.interessados || 0);
  const tested = stats.filter((v) => v.enviados - v.bounces >= 5);
  const melhor = tested.length ? tested.reduce((a, b) => (b.taxa > a.taxa ? b : a)) : null;

  let arquivo = null;
  if (!L.DRY) {
    const page = html(c, t, stats, base.leads);
    arquivo = L.file('relatorio.html');
    fs.mkdirSync(L.DATA, { recursive: true });
    fs.writeFileSync(arquivo, page);
    if (process.env.PIPO_RUN_DIR) fs.writeFileSync(path.join(process.env.PIPO_RUN_DIR, 'relatorio.html'), page);
  }

  const parts = [];
  if (L.DRY) parts.push(`Ensaio: encontrei ${plural(Number(val.novos || 0), 'decisor', 'decisores')} e enviaria ${plural(Number(send.enviaria || 0), 'e-mail', 'e-mails')}.`);
  else {
    parts.push(enviadosAgora ? `Enviei ${plural(enviadosAgora, 'e-mail', 'e-mails')}${send.lembretes ? ` (${plural(send.lembretes, 'lembrete', 'lembretes')})` : ''}.` : 'Nenhum e-mail enviado nesta rodada.');
    if (respostasNovas) parts.push(`${plural(respostasNovas, 'resposta nova', 'respostas novas')}${interessadosNovos ? `, ${plural(interessadosNovos, 'interessado', 'interessados')}` : ''}.`);
    if ((rep.bounces || []).length) parts.push(`${plural(rep.bounces.length, 'e-mail voltou', 'e-mails voltaram')}.`);
  }
  const detalhe = [
    melhor && melhor.respostas ? `Melhor assunto até agora: "${melhor.assunto}" (${melhor.taxa}% de resposta em ${melhor.enviados} envios).` : null,
    aposentadas.length ? `Aposentei ${plural(aposentadas.length, 'variante', 'variantes')} que ${aposentadas.length === 1 ? 'estava' : 'estavam'} perdendo: ${aposentadas.map((a) => a.id).join(', ')}.` : null,
    val.sondagem === 'indisponivel' ? 'Não consegui sondar os endereços (a porta 25 está fechada nesta internet): usei o formato mais comum de cada empresa.' : null,
    send.ficaramParaAmanha ? `${plural(send.ficaramParaAmanha, 'e-mail ficou', 'e-mails ficaram')} para amanhã (limite do dia).` : null,
    (send.falhas || []).length ? `${plural(send.falhas.length, 'envio falhou', 'envios falharam')}: ${send.falhas[0].erro}` : null,
    rep.erro || null,
    `Na base: ${plural(t.leads, 'lead', 'leads')}, ${plural(t.enviados, 'enviado', 'enviados')}, ${plural(t.respostas, 'resposta', 'respostas')} (${t.taxaResposta}%), ${plural(t.interessados, 'interessado', 'interessados')}.`,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    frase: parts.join(' '),
    detalhe,
    empresasNovas: ((L.stepOut(ctx, 'empresas') || {}).empresas || []).length,
    decisoresNovos: Number(val.novos || 0),
    enviadosAgora,
    respostasNovas,
    interessadosNovos,
    totais: t,
    variantes: stats.map((v) => ({ id: v.id, angulo: v.angulo, assunto: v.assunto, enviados: v.enviados, respostas: v.respostas, interessados: v.interessados, taxa: v.taxa, ativa: v.ativa !== false })),
    melhor: melhor ? { id: melhor.id, assunto: melhor.assunto, taxa: melhor.taxa } : null,
    aposentadas,
    arquivo,
  };
});
