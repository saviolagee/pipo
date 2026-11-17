'use strict';
// Passo do meio: registra o que as respostas significam, guarda as variantes novas, transforma os
// decisores encontrados em leads com e-mail validado e monta a fila desta rodada (lembretes + novos),
// cada um com a variante que vai testar.
const dns = require('dns').promises;
const L = require('./lib.js');
const smtp = require('./smtp.js');
const { candidates, pickVariant, nextId } = require('./emails.js');

const mxCache = new Map();
/** Servidor de e-mail do domínio: host, null (o domínio não recebe e-mail) ou undefined (não deu para saber). */
async function mailServer(domain) {
  if (process.env.PROSPECTOR_MX) return process.env.PROSPECTOR_MX;
  if (mxCache.has(domain)) return mxCache.get(domain);
  let host;
  try {
    const mx = await dns.resolveMx(domain);
    host = mx.length ? mx.sort((a, b) => a.priority - b.priority)[0].exchange : null;
  } catch (e) {
    host = ['ENOTFOUND', 'ENODATA', 'NXDOMAIN'].includes(e.code) ? null : undefined;
  }
  mxCache.set(domain, host);
  return host;
}

L.main(async () => {
  const c = L.config();
  const ctx = L.context();
  const base = L.loadBase();
  const acc = L.account();
  const now = new Date().toISOString();
  const suppressed = L.loadSuppressed();

  // 1. O que cada resposta significa.
  const toSuppress = [];
  let interessados = 0;
  for (const k of (L.stepOut(ctx, 'classificar') || {}).classes || []) {
    const lead = base.leads.find((l) => l.id === Number(k.id));
    if (!lead || lead.status !== 'respondeu') continue;
    const classe = L.lower(k.classe);
    lead.respostaResumo = L.text(k.resumo).slice(0, 300);
    if (classe === 'automatica') lead.status = lead.statusAntes || 'enviado';
    else if (classe === 'interessado') {
      lead.status = 'interessado';
      interessados++;
    } else if (classe === 'depois') lead.status = 'depois';
    else if (classe === 'sem_interesse' || classe === 'descadastrar') {
      lead.status = 'sem_interesse';
      toSuppress.push(lead.email);
    }
  }

  // 2. Variantes novas (as apostas de assunto e texto em teste).
  const variants = L.loadVariants();
  for (const v of (L.stepOut(ctx, 'planejar') || {}).variantesNovas || []) {
    if (variants.filter((x) => x.ativa !== false).length >= 4) break;
    if (!L.text(v.assunto) || !L.text(v.guia)) continue;
    variants.push({ id: nextId(variants), angulo: L.text(v.angulo).slice(0, 80) || 'sem nome', assunto: L.text(v.assunto).slice(0, 120), guia: L.text(v.guia).slice(0, 600), ativa: true, criadaEm: now });
  }
  const stats = L.variantStats(variants, base.leads);

  // 3. Empresas vistas nesta rodada entram na base (para a próxima busca trazer outras).
  for (const e of (L.stepOut(ctx, 'empresas') || {}).empresas || []) {
    const nome = L.text(e.nome);
    if (nome && !base.empresas[L.plain(nome)]) base.empresas[L.plain(nome)] = { nome, dominio: L.domainOf(e.dominio), vistaEm: now };
  }

  // 4. Decisores → leads com e-mail validado.
  const descartados = [];
  const novos = [];
  let sondagem = L.DRY ? 'ensaio' : c.sondar && acc ? 'feita' : 'desligada';
  const drop = (d, motivo) => descartados.push({ nome: L.text(d.nome), empresa: L.text(d.empresa), motivo });
  for (const d of (L.stepOut(ctx, 'decisores') || {}).decisores || []) {
    const literal = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(L.lower(d.email)) ? L.lower(d.email) : '';
    const dominio = L.domainOf(d.dominio) || (literal ? literal.split('@')[1] : '');
    const nome = L.text(d.nome);
    if (!dominio) { drop(d, 'sem o site da empresa'); continue; }
    if (!nome && !literal) { drop(d, 'sem nome e sem e-mail'); continue; }
    if (base.leads.some((l) => (nome && L.plain(l.nome) === L.plain(nome) && l.dominio === dominio) || (literal && l.email === literal))) { drop(d, 'já está na base'); continue; }
    if (suppressed.has(dominio) || (literal && suppressed.has(literal))) { drop(d, 'pediu para não receber'); continue; }
    const mx = await mailServer(dominio);
    if (mx === null) { drop(d, `o domínio ${dominio} não recebe e-mail`); continue; }
    const cands = [...new Set([literal && literal.endsWith(`@${dominio}`) ? literal : null, ...candidates(nome, dominio, d.padrao)].filter(Boolean))];
    if (!cands.length) { drop(d, 'não deu para montar o e-mail'); continue; }
    let email = cands[0];
    let confianca = literal ? 'encontrado' : 'padrao';
    if (sondagem === 'feita' && mx) {
      try {
        const fake = `nao-existe-${Math.random().toString(36).slice(2, 10)}@${dominio}`;
        const r = await smtp.probe(mx, acc.user, [fake, ...cands.slice(0, 5)], { port: c.portaSondagem, semTls: c.semTls });
        if (r[fake] === 'recusado') {
          // O servidor diz quem existe: fica o primeiro endereço aceito.
          const ok = cands.find((a) => r[a] === 'aceito');
          if (ok) { email = ok; confianca = 'verificado'; }
          else if (cands.slice(0, 5).every((a) => r[a] === 'recusado')) { drop(d, 'nenhum endereço foi aceito pelo servidor'); continue; }
        }
        // Se até o endereço inventado é aceito, o servidor aceita tudo: vale o formato mais comum.
      } catch {
        // Porta 25 fechada pela operadora (comum em internet residencial): segue pelo formato.
        sondagem = 'indisponivel';
      }
    }
    if (suppressed.has(email)) { drop(d, 'pediu para não receber'); continue; }
    const lead = { id: base.proximoId++, empresa: L.text(d.empresa), dominio, evidencia: L.text(d.evidencia).slice(0, 300), fonte: L.text(d.fonte), nome, cargo: L.text(d.cargo), fontePessoa: L.text(d.fontePessoa), email, confianca, status: 'novo', criadoEm: now };
    base.leads.push(lead);
    novos.push(lead);
  }

  // 5. A fila de hoje: lembretes para quem não respondeu e os leads ainda não abordados.
  const cap = Math.max(0, c.limiteDia - L.sentToday(base));
  const dueBefore = Date.now() - c.followupDias * 86400000;
  const due = c.followupDias > 0 ? base.leads.filter((l) => l.status === 'enviado' && !l.followupEm && new Date(l.enviadoEm).getTime() <= dueBefore) : [];
  const pending = base.leads.filter((l) => l.status === 'novo');
  const followups = due.slice(0, pending.length ? Math.ceil(cap / 2) : cap);
  const fresh = pending.slice(0, Math.max(0, Math.min(c.leadsPorRodada, cap - followups.length)));
  const extra = {};
  const brief = (v) => (v ? { id: v.id, angulo: v.angulo, assunto: v.assunto, guia: v.guia } : null);
  const fila = [
    ...followups.map((l) => ({ id: l.id, tipo: 'followup', nome: l.nome, cargo: l.cargo, empresa: l.empresa, evidencia: l.evidencia, email: l.email, assuntoAnterior: l.assunto, variante: brief(variants.find((v) => v.id === l.variante)) })),
    ...fresh.map((l) => {
      const v = pickVariant(stats, extra);
      l.variante = v ? v.id : null;
      return { id: l.id, tipo: 'primeiro', nome: l.nome, cargo: l.cargo, empresa: l.empresa, evidencia: l.evidencia, fonte: l.fonte, email: l.email, confianca: l.confianca, variante: brief(v) };
    }),
  ];

  L.saveBase(base);
  L.saveVariants(variants);
  if (toSuppress.length) L.suppress(toSuppress);
  return { fila, total: fila.length, novos: novos.length, lembretes: followups.length, interessados, descartados, sondagem, ficamParaDepois: Math.max(0, pending.length - fresh.length), variantesAtivas: variants.filter((v) => v.ativa !== false).length };
});

