'use strict';
// Biblioteca comum dos scripts do Prospector: arquivos de dados, configuração, conta de e-mail e
// as contas que todos fazem igual (estatística por variante, quanto ainda dá para enviar hoje).
// Roda com Node puro (sem instalar nada). A pasta de trabalho é a pasta do Pipo.
const fs = require('fs');
const path = require('path');

const DATA = path.join(process.cwd(), 'data');
const DRY = process.env.PIPO_DRY_RUN === '1';
const file = (name) => path.join(DATA, name);

function readJson(f, fallback) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(f, value) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, f);
}

const int = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && String(v ?? '').trim() !== '' ? Math.min(max, Math.max(min, n)) : def;
};
const text = (v) => String(v ?? '').trim();
const lower = (v) => text(v).toLowerCase();
const plain = (s) => text(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function config() {
  const c = readJson(file('config.json'), {});
  return {
    busca: text(c.busca),
    decisores: text(c.decisores) || 'CEO, fundador, sócio ou o diretor da área',
    oferta: text(c.oferta),
    remetente: text(c.remetente),
    assinatura: text(c.assinatura),
    leadsPorRodada: int(c.leadsPorRodada, 1, 25, 8),
    limiteDia: int(c.limiteDia, 1, 80, 20),
    intervaloSeg: int(c.intervaloSeg, 0, 900, 40),
    followupDias: int(c.followupDias, 0, 30, 4),
    smtpHost: text(c.smtpHost),
    smtpPort: int(c.smtpPort, 1, 65535, 0),
    imapHost: text(c.imapHost),
    imapPort: int(c.imapPort, 1, 65535, 0),
    // Só para servidor de e-mail local ou de teste (sem criptografia).
    semTls: c.semTls === true,
    // Porta da sondagem de endereços (25 na vida real).
    portaSondagem: int(c.portaSondagem, 1, 65535, 25),
    sondar: c.sondar !== false,
  };
}

/** O que falta preencher para o Prospector trabalhar. */
function missing(c) {
  const m = [];
  if (!c.busca) m.push('que empresas procurar');
  if (!c.oferta) m.push('o que você oferece');
  if (!c.remetente) m.push('seu nome (quem assina)');
  return m;
}

const PRESETS = {
  'gmail.com': ['smtp.gmail.com', 465, 'imap.gmail.com', 993],
  'googlemail.com': ['smtp.gmail.com', 465, 'imap.gmail.com', 993],
  'outlook.com': ['smtp-mail.outlook.com', 587, 'outlook.office365.com', 993],
  'hotmail.com': ['smtp-mail.outlook.com', 587, 'outlook.office365.com', 993],
  'live.com': ['smtp-mail.outlook.com', 587, 'outlook.office365.com', 993],
  'yahoo.com': ['smtp.mail.yahoo.com', 465, 'imap.mail.yahoo.com', 993],
  'yahoo.com.br': ['smtp.mail.yahoo.com', 465, 'imap.mail.yahoo.com', 993],
  'icloud.com': ['smtp.mail.me.com', 587, 'imap.mail.me.com', 993],
  'zoho.com': ['smtp.zoho.com', 465, 'imap.zoho.com', 993],
  'uol.com.br': ['smtps.uol.com.br', 587, 'imap.uol.com.br', 993],
  'terra.com.br': ['smtp.terra.com.br', 587, 'imap.terra.com.br', 993],
};

/** Conta de e-mail do usuário (o endereço vem da configuração; a senha de app, do cofre do Pipo). null se não configurou. */
function account() {
  const user = text(readJson(file('config.json'), {}).email) || text(process.env.EMAIL_USER);
  const pass = String(process.env.EMAIL_PASS ?? '').replace(/\s+/g, '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user) || !pass) return null;
  const domain = user.split('@')[1].toLowerCase();
  const c = config();
  // Domínio próprio: quase sempre Google Workspace; dá para trocar na configuração.
  const p = PRESETS[domain] || ['smtp.gmail.com', 465, 'imap.gmail.com', 993];
  return {
    user,
    pass,
    domain,
    name: c.remetente,
    semTls: c.semTls,
    smtp: { host: c.smtpHost || p[0], port: c.smtpPort || p[1] },
    imap: { host: c.imapHost || p[2], port: c.imapPort || p[3] },
  };
}

/** Saídas dos passos anteriores e a entrada (do arquivo; a variável só serve quando é pequena). */
function context() {
  const f = process.env.PIPO_CONTEXT_FILE;
  if (f) {
    const c = readJson(f, null);
    if (c) return c;
  }
  try {
    return JSON.parse(process.env.PIPO_CONTEXT || '{}');
  } catch {
    return {};
  }
}
const stepOut = (ctx, key) => (ctx && ctx.passos && ctx.passos[key] ? ctx.passos[key].saida : null) || null;

function loadBase() {
  const b = readJson(file('leads.json'), {});
  return { leads: Array.isArray(b.leads) ? b.leads : [], empresas: b.empresas || {}, envios: b.envios || {}, caixa: b.caixa || {}, proximoId: b.proximoId || 1 };
}
const saveBase = (b) => !DRY && writeJson(file('leads.json'), b);
const loadVariants = () => {
  const v = readJson(file('variantes.json'), {});
  return Array.isArray(v.variantes) ? v.variantes : [];
};
const saveVariants = (list) => !DRY && writeJson(file('variantes.json'), { variantes: list });
const loadSuppressed = () => {
  const s = readJson(file('suprimidos.json'), []);
  return new Set((Array.isArray(s) ? s : []).map(lower));
};
function suppress(values) {
  if (DRY) return;
  const s = loadSuppressed();
  for (const v of values) if (lower(v)) s.add(lower(v));
  writeJson(file('suprimidos.json'), [...s]);
}

function today(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const sentToday = (base) => Number(base.envios[today()] || 0);

const REPLIED = ['respondeu', 'interessado', 'depois', 'sem_interesse'];
/** Números de cada variante, sempre recalculados a partir dos leads (não desalinha). */
function variantStats(variants, leads) {
  return variants.map((v) => {
    const mine = leads.filter((l) => l.variante === v.id && l.enviadoEm);
    const respostas = mine.filter((l) => REPLIED.includes(l.status)).length;
    const interessados = mine.filter((l) => l.status === 'interessado').length;
    const bounces = mine.filter((l) => l.status === 'bounce').length;
    const entregues = mine.length - bounces;
    return { ...v, enviados: mine.length, respostas, interessados, bounces, taxa: entregues > 0 ? Math.round((respostas / entregues) * 1000) / 10 : 0 };
  });
}

/** Totais da base inteira. */
function totals(leads) {
  const sent = leads.filter((l) => l.enviadoEm);
  const respostas = sent.filter((l) => REPLIED.includes(l.status)).length;
  const bounces = sent.filter((l) => l.status === 'bounce').length;
  return {
    leads: leads.length,
    enviados: sent.length,
    respostas,
    interessados: sent.filter((l) => l.status === 'interessado').length,
    bounces,
    taxaResposta: sent.length - bounces > 0 ? Math.round((respostas / (sent.length - bounces)) * 1000) / 10 : 0,
  };
}

/** Domínio limpo: "https://www.Empresa.com.br/contato" → "empresa.com.br". */
function domainOf(v) {
  const d = lower(v).replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '').replace(/^.*@/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : '';
}

function out(value) {
  process.stdout.write(JSON.stringify(value));
}

/** Roda o script e transforma qualquer erro numa mensagem que o usuário entende. */
function main(fn) {
  Promise.resolve()
    .then(fn)
    .then((value) => {
      if (value !== undefined) out(value);
      // Conexões de rede esquecidas não seguram o processo.
      setTimeout(() => process.exit(0), 50);
    })
    .catch((e) => {
      process.stderr.write(`${e && e.message ? e.message : String(e)}\n`);
      process.exit(1);
    });
}

module.exports = { DATA, DRY, REPLIED, file, readJson, writeJson, int, text, lower, plain, config, missing, account, context, stepOut, loadBase, saveBase, loadVariants, saveVariants, loadSuppressed, suppress, today, sentToday, variantStats, totals, domainOf, out, main };
