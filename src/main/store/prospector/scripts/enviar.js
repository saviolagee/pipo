'use strict';
// Envia os e-mails aprovados pela conta do usuário, um por vez e com intervalo, respeitando o limite
// do dia. Cada envio é gravado na hora: se cair no meio, rodar de novo não repete ninguém.
// No ensaio (PIPO_DRY_RUN=1) nada é enviado.
const L = require('./lib.js');
const smtp = require('./smtp.js');

const OPT_OUT = 'Se não fizer sentido receber minhas mensagens, é só responder "sair" que eu não escrevo mais.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

L.main(async () => {
  const ctx = L.context();
  const escritos = (L.stepOut(ctx, 'escrever') || {}).emails || [];
  const conf = L.stepOut(ctx, 'confirmar') || {};
  // Os itens aprovados (já com as edições do usuário); com "sempre permitir", valem os escritos.
  const aprovados = Array.isArray(conf.itens) ? conf.itens : escritos;
  if (L.DRY) return { seco: true, enviaria: aprovados.length, exemplo: aprovados[0] ? { para: aprovados[0].para, assunto: aprovados[0].assunto } : null, enviados: 0 };

  const acc = L.account();
  if (!acc) throw new Error('Falta a conta de e-mail para enviar. Abra Equipe → Prospector → Configurar e preencha o e-mail e a senha de app.');
  const c = L.config();
  const base = L.loadBase();
  const suppressed = L.loadSuppressed();
  const approved = new Set(aprovados.map((e) => Number(e.id)));
  // O que você pulou na revisão não volta na próxima rodada.
  let pulados = 0;
  for (const e of escritos) {
    const lead = base.leads.find((l) => l.id === Number(e.id));
    if (lead && !approved.has(lead.id) && lead.status === 'novo') {
      lead.status = 'pulado';
      pulados++;
    }
  }
  L.saveBase(base);

  let enviados = 0;
  let lembretes = 0;
  let ficaramParaAmanha = 0;
  const falhas = [];
  for (let i = 0; i < aprovados.length; i++) {
    const e = aprovados[i];
    const lead = base.leads.find((l) => l.id === Number(e.id));
    const followup = e.tipo === 'followup';
    if (!lead || !L.text(e.assunto) || !L.text(e.corpo)) {
      falhas.push({ para: L.text(e.para), erro: 'item sem lead, assunto ou texto' });
      continue;
    }
    if (suppressed.has(lead.email) || suppressed.has(lead.dominio)) continue;
    if (followup ? lead.status !== 'enviado' || lead.followupEm : lead.status !== 'novo') continue;
    if (L.sentToday(base) >= c.limiteDia) {
      ficaramParaAmanha++;
      continue;
    }
    const body = [L.text(e.corpo), c.assinatura || c.remetente, OPT_OUT].filter(Boolean).join('\n\n');
    try {
      const id = await smtp.send(acc, { to: lead.email, subject: L.text(e.assunto), text: body, inReplyTo: followup ? lead.messageId : null });
      const now = new Date().toISOString();
      if (followup) {
        lead.status = 'followup';
        lead.followupEm = now;
        lembretes++;
      } else {
        lead.status = 'enviado';
        lead.enviadoEm = now;
        lead.assunto = L.text(e.assunto);
        lead.corpo = L.text(e.corpo);
        lead.messageId = id;
        lead.variante = L.text(e.variante) || lead.variante || null;
      }
      base.envios[L.today()] = L.sentToday(base) + 1;
      L.saveBase(base);
      enviados++;
    } catch (x) {
      falhas.push({ para: lead.email, erro: x.message });
      // Login recusado ou servidor fora: não adianta insistir nos próximos.
      if (/login|não conectei|sem resposta/i.test(x.message)) throw new Error(`${x.message}${enviados ? ` (${enviados} já ${enviados === 1 ? 'foi enviado' : 'foram enviados'})` : ''}`);
      continue;
    }
    // Intervalo entre os envios, com uma variação: ritmo de gente, não de disparo em massa.
    if (i < aprovados.length - 1 && c.intervaloSeg > 0) await sleep(c.intervaloSeg * 1000 * (0.8 + Math.random() * 0.4));
  }
  return { enviados, lembretes, pulados, falhas, ficaramParaAmanha, enviadosHoje: L.sentToday(base), limiteDia: c.limiteDia };
});
