'use strict';
// Passo 2: lê a caixa de entrada (só leitura) e descobre quem respondeu e quais e-mails voltaram.
// Sem conta de e-mail configurada, o passo é pulado e o resto segue.
const L = require('./lib.js');
const imap = require('./imap.js');

const BOUNCE = /mailer-daemon|postmaster|mail delivery|delivery status|undeliver|n[aã]o (foi )?entregue|returned mail|failure notice/i;

L.main(async () => {
  const acc = L.account();
  if (!acc) return { pulado: 'sem conta de e-mail configurada', novas: [], bounces: [], lidas: 0 };
  const base = L.loadBase();
  const waiting = base.leads.filter((l) => l.enviadoEm && l.email && ['enviado', 'followup'].includes(l.status));
  if (!waiting.length) return { novas: [], bounces: [], lidas: 0 };

  let box;
  try {
    box = await imap.fetchNew(acc, { afterUid: base.caixa.ultimoUid || 0, sinceDays: 21 });
  } catch (e) {
    // Sem ler a caixa o resto do trabalho continua valendo; o resumo avisa.
    return { erro: `Não consegui ler a caixa de entrada: ${e.message}`, novas: [], bounces: [], lidas: 0 };
  }

  const novas = [];
  const bounces = [];
  const now = new Date().toISOString();
  for (const m of box.mensagens) {
    const fromDomain = m.endereco.split('@')[1] || '';
    if (BOUNCE.test(`${m.de} ${m.assunto}`)) {
      // E-mail que voltou: o endereço que falhou aparece no corpo do aviso.
      const hay = `${m.bruto} ${m.texto}`.toLowerCase();
      const lead = waiting.find((l) => hay.includes(l.email.toLowerCase()));
      if (lead && lead.status !== 'bounce') {
        lead.status = 'bounce';
        lead.bounceEm = now;
        bounces.push({ id: lead.id, email: lead.email, empresa: lead.empresa });
      }
      continue;
    }
    // Resposta da própria pessoa ou, se só há um contato naquela empresa, de alguém do mesmo domínio.
    const sameDomain = waiting.filter((l) => l.email.split('@')[1] === fromDomain);
    const lead = waiting.find((l) => l.email.toLowerCase() === m.endereco) || (sameDomain.length === 1 && !/gmail|outlook|hotmail|yahoo|icloud|uol|terra/.test(fromDomain) ? sameDomain[0] : null);
    if (!lead || !['enviado', 'followup'].includes(lead.status)) continue;
    lead.statusAntes = lead.status;
    lead.status = 'respondeu';
    lead.respostaEm = now;
    lead.respostaAssunto = m.assunto;
    lead.respostaTrecho = m.texto;
    novas.push({ id: lead.id, de: m.de, nome: lead.nome, empresa: lead.empresa, assunto: m.assunto, trecho: m.texto, automatica: m.automatica });
  }
  base.caixa.ultimoUid = box.ultimoUid;
  base.caixa.verificadaEm = now;
  L.saveBase(base);
  if (bounces.length) L.suppress(bounces.map((b) => b.email));
  return { novas, bounces, lidas: box.mensagens.length };
});
