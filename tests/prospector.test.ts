// Loja de Pipos e o Prospector de ponta a ponta: instala pela loja e roda o plano de verdade (os
// scripts em Node) contra um servidor de e-mail de mentira (envio, sondagem de endereços e caixa de
// entrada). Só a IA e a busca na web são simuladas.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { validatePlaybook } from '../src/shared/plan-check';

const dir = mkdtempSync(join(tmpdir(), 'pipo-loja-'));
vi.mock('electron', () => ({
  app: { getPath: () => dir, isPackaged: false, getName: () => 'Pipo', on: () => undefined },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  nativeImage: { createFromBuffer: () => ({}) },
  Notification: class {},
  BrowserWindow: class {},
  screen: {},
  dialog: {},
  shell: {},
  protocol: {},
  powerMonitor: {},
  session: {},
}));

const { openDb } = await import('../src/main/db');
const repo = await import('../src/main/pipos/repo');
const { execute } = await import('../src/main/pipos/runner');
const { pipoSecrets, setPipoSecret } = await import('../src/main/pipos/secrets');
const store = await import('../src/main/store');
type Deps = import('../src/main/pipos/runner').RunnerDeps;

const require2 = createRequire(import.meta.url);
const scripts = join(__dirname, '..', 'src', 'main', 'store', 'prospector', 'scripts');
const emails = require2(join(scripts, 'emails.js')) as { candidates: (n: string, d: string, p?: string) => string[]; pickVariant: (s: unknown[], extra: Record<string, number>) => { id: string } | null };
const imapLib = require2(join(scripts, 'imap.js')) as { decodeWords: (s: string) => string; readable: (ct: string, enc: string, raw: string) => string; snippet: (s: string) => string; addressOf: (s: string) => string };
const smtpLib = require2(join(scripts, 'smtp.js')) as { verdict: (code: number, text: string) => string; buildMessage: (m: Record<string, unknown>) => { id: string; data: string } };

// ---------- servidor de e-mail de mentira ----------

const existing = new Set(['ana.souza@acme.com.br', 'blima@beta.com.br']);
const sent: Array<{ to: string; data: string }> = [];
const inbox: Array<{ uid: number; headers: string; text: string }> = [];
let smtp: Server;
let imap: Server;
const portOf = (s: Server): number => (s.address() as { port: number }).port;

function smtpSession(socket: Socket): void {
  let buf = '';
  let data: string | null = null;
  let to = '';
  socket.write('220 teste ESMTP\r\n');
  socket.on('error', () => undefined);
  socket.on('data', (d) => {
    buf += d.toString('utf8');
    for (;;) {
      if (data !== null) {
        const end = buf.indexOf('\r\n.\r\n');
        if (end < 0) return;
        sent.push({ to, data: buf.slice(0, end) });
        buf = buf.slice(end + 5);
        data = null;
        socket.write('250 ok, na fila\r\n');
        continue;
      }
      const nl = buf.indexOf('\r\n');
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      if (/^EHLO/i.test(line)) socket.write('250-teste\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (/^AUTH PLAIN/i.test(line)) socket.write('235 autenticado\r\n');
      else if (/^MAIL FROM/i.test(line)) socket.write('250 ok\r\n');
      else if (/^RCPT TO/i.test(line)) {
        to = (/<([^>]+)>/.exec(line) ?? [])[1] ?? '';
        socket.write(existing.has(to) ? '250 ok\r\n' : '550 5.1.1 user unknown\r\n');
      } else if (/^DATA/i.test(line)) {
        data = '';
        socket.write('354 manda\r\n');
      } else if (/^QUIT/i.test(line)) socket.end('221 tchau\r\n');
      else socket.write('250 ok\r\n');
    }
  });
}

function imapSession(socket: Socket): void {
  let buf = '';
  socket.write('* OK IMAP de teste\r\n');
  socket.on('error', () => undefined);
  socket.on('data', (d) => {
    buf += d.toString('utf8');
    for (;;) {
      const nl = buf.indexOf('\r\n');
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const [tag, ...rest] = line.split(' ');
      const cmd = rest.join(' ');
      if (/^LOGIN/i.test(cmd)) socket.write(`${tag} OK logado\r\n`);
      else if (/^SELECT/i.test(cmd)) socket.write(`* ${inbox.length} EXISTS\r\n${tag} OK [READ-WRITE] pronto\r\n`);
      else if (/^UID SEARCH/i.test(cmd)) {
        const from = Number((/UID (\d+):\*/.exec(cmd) ?? [])[1] ?? 0);
        // Como no IMAP de verdade, "n:*" sempre devolve a última mensagem.
        const uids = inbox.map((m) => m.uid).filter((u, i, all) => u >= from || i === all.length - 1);
        socket.write(`* SEARCH ${uids.join(' ')}\r\n${tag} OK feito\r\n`);
      } else if (/^UID FETCH/i.test(cmd)) {
        const want = (/^UID FETCH ([\d,]+)/i.exec(cmd) ?? [])[1].split(',').map(Number);
        inbox
          .filter((m) => want.includes(m.uid))
          .forEach((m, i) => {
            socket.write(`* ${i + 1} FETCH (UID ${m.uid} BODY[HEADER.FIELDS (FROM SUBJECT DATE CONTENT-TYPE CONTENT-TRANSFER-ENCODING AUTO-SUBMITTED)] {${Buffer.byteLength(m.headers)}}\r\n${m.headers} BODY[TEXT]<0> {${Buffer.byteLength(m.text)}}\r\n${m.text})\r\n`);
          });
        socket.write(`${tag} OK feito\r\n`);
      } else if (/^LOGOUT/i.test(cmd)) socket.end(`* BYE\r\n${tag} OK tchau\r\n`);
      else socket.write(`${tag} BAD ?\r\n`);
    }
  });
}

beforeAll(async () => {
  smtp = createServer(smtpSession);
  imap = createServer(imapSession);
  await Promise.all([new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r)), new Promise<void>((r) => imap.listen(0, '127.0.0.1', r))]);
});
afterAll(() => {
  smtp.close();
  imap.close();
});

// ---------- a IA e a busca, simuladas ----------

const companies = [
  { nome: 'Acme Indústria', dominio: 'acme.com.br', evidencia: 'vaga de Controller aberta', fonte: 'https://vagas.exemplo/acme' },
  { nome: 'Beta Logística', dominio: '', evidencia: 'vaga de Diretor Financeiro', fonte: 'https://vagas.exemplo/beta' },
  { nome: 'Gama Varejo', dominio: 'gama.com', evidencia: 'vaga de CFO', fonte: 'https://vagas.exemplo/gama' },
];
const people = [
  { empresa: 'Acme Indústria', dominio: 'acme.com.br', evidencia: 'vaga de Controller aberta', fonte: 'https://vagas.exemplo/acme', nome: 'Ana de Souza', cargo: 'CEO', email: '', padrao: '', fontePessoa: 'https://linkedin.exemplo/ana' },
  { empresa: 'Beta Logística', dominio: 'https://www.beta.com.br/sobre', evidencia: 'vaga de Diretor Financeiro', fonte: 'https://vagas.exemplo/beta', nome: 'Bruno Lima', cargo: 'Sócio', email: '', padrao: 'nsobrenome', fontePessoa: '' },
  { empresa: 'Gama Varejo', dominio: 'gama.com', evidencia: 'vaga de CFO', fonte: 'https://vagas.exemplo/gama', nome: 'Carla Dias', cargo: 'Diretora de RH', email: '', padrao: '', fontePessoa: '' },
];

interface Sim {
  prompts: Record<string, string>;
  confirms: number;
  notes: Array<{ title: string; body: string | null }>;
  round: number;
}

function deps(sim: Sim): Deps {
  const reply = (key: string, prompt: string, value: unknown): string => {
    sim.prompts[key] = prompt;
    return JSON.stringify(value);
  };
  return {
    agent: async (o) => {
      const p = o.prompt;
      if (p.startsWith('Estas pessoas responderam')) return reply('classificar', p, { classes: [{ id: 1, classe: 'interessado', resumo: 'Quer conversar amanhã.' }] });
      if (p.startsWith('Você planeja a rodada')) {
        const novas = /Crie exatamente 2 variante/.test(p)
          ? [
              { angulo: 'a vaga aberta', assunto: 'Sobre a vaga na {empresa}', guia: 'Abre citando a vaga. Oferece assumir como interino e pergunta se vale uma conversa.' },
              { angulo: 'pergunta direta', assunto: '{nome}, uma pergunta rápida', guia: 'Abre com uma pergunta sobre o fechamento do mês. Oferece ajuda e pede 15 minutos.' },
            ]
          : [];
        return reply('planejar', p, { consultas: sim.round === 1 ? ['vaga "controller" indústria', 'vaga "diretor financeiro" site:gupy.io'] : [], variantesNovas: novas });
      }
      if (p.startsWith('Encontre nas pesquisas')) return reply('empresas', p, sim.round === 1 ? { empresas: companies, consultas: ['"Acme Indústria" CEO linkedin', '"Beta Logística" sócio'] } : { empresas: [], consultas: [] });
      if (p.startsWith('Descubra, para cada empresa')) return reply('decisores', p, { decisores: people });
      if (p.startsWith('Escreva os e-mails')) {
        const fila = JSON.parse(/Fila: (\[.*\])\n/.exec(p)?.[1] ?? '[]') as Array<{ id: number; tipo: string; email: string; nome: string; empresa: string; variante: { id: string } | null }>;
        return reply('escrever', p, { emails: fila.map((f) => ({ id: f.id, tipo: f.tipo, para: f.email, nome: f.nome, empresa: f.empresa, variante: f.variante?.id, assunto: `Sobre a vaga na ${f.empresa}`, corpo: `Olá ${f.nome.split(' ')[0]}, vi a vaga aberta. Posso assumir a área enquanto ela não fecha. Vale uma conversa?` })) });
      }
      throw new Error(`prompt inesperado: ${p.slice(0, 60)}`);
    },
    research: async (step, env) => {
      const list = step.key === 'buscar' ? ((env.ctx.passos as Record<string, { saida: { consultas: string[] } }>).planejar.saida.consultas ?? []) : ['"Acme Indústria" CEO linkedin'];
      return { aviso: 'dado', consultas: list.map((c) => ({ consulta: c, resultados: [{ titulo: `Resultado de ${c}`, url: 'https://exemplo.com', trecho: 'trecho' }], fontes: [] })), total: list.length };
    },
    confirm: async (o) => {
      sim.confirms++;
      return { answer: 'yes', items: o.list ?? [] };
    },
    notify: (o) => {
      sim.notes.push({ title: o.title, body: o.body });
    },
    gfetch: async () => {
      throw new Error('sem google');
    },
    fetch: (...a) => fetch(...a),
    handoff: async () => 'ok',
    askPipo: async () => 'ajuda',
    update: () => undefined,
  };
}

const values = { busca: 'Empresas com vaga aberta de controller ou diretor financeiro', decisores: 'CEO ou sócio', oferta: 'Assumo a área financeira como CFO interino.', remetente: 'Savio Teste', assinatura: 'Savio Teste\nCFO interino', email: 'eu@teste.com', EMAIL_PASS: 'senha-de-app-123', limiteDia: '20', leadsPorRodada: '8', agenda: 'de segunda a sexta às 9h' };

/** Instala o Prospector e aponta a conta para o servidor de mentira. */
function install(): { p: NonNullable<ReturnType<typeof repo.getPipo>>; data: (f: string) => string } {
  openDb(':memory:');
  const r = store.installItem('prospector', values);
  const p = repo.getPipo(r.pipoId) as NonNullable<ReturnType<typeof repo.getPipo>>;
  const data = (f: string): string => join(repo.pipoDir(p.slug), 'data', f);
  const config = JSON.parse(readFileSync(data('config.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(data('config.json'), JSON.stringify({ ...config, smtpHost: '127.0.0.1', smtpPort: portOf(smtp), imapHost: '127.0.0.1', imapPort: portOf(imap), portaSondagem: portOf(smtp), semTls: true, intervaloSeg: 0 }));
  setPipoSecret(p.slug, 'PROSPECTOR_MX', '127.0.0.1');
  return { p, data };
}

const run = (p: NonNullable<ReturnType<typeof repo.getPipo>>, sim: Sim, dryRun = false): ReturnType<typeof execute> => {
  const v = repo.activePlaybook(p.id);
  return execute({ pipo: p, version: 1, dryRun, trigger: dryRun ? 'ensaio' : 'manual', playbook: v!.playbook }, deps(sim));
};

describe('loja de Pipos', () => {
  it('instala o Prospector pronto: plano válido, scripts, configuração, senha no cofre e agenda', () => {
    openDb(':memory:');
    expect(store.listStore()[0]).toMatchObject({ id: 'prospector', name: 'Prospector', installed: null });
    expect(() => store.installItem('prospector', { ...values, busca: ' ' })).toThrow('Falta preencher: Que empresas procurar.');
    expect(repo.listPipos()).toHaveLength(0);

    const r = store.installItem('prospector', values);
    const p = repo.getPipo(r.pipoId)!;
    expect(p).toMatchObject({ slug: 'prospector', color: 'green', accessory: 'magnifier', activeVersion: 1 });
    const v = repo.activePlaybook(p.id)!;
    const files = ['lib.js', 'smtp.js', 'imap.js', 'emails.js', 'estado.js', 'respostas.js', 'validar.js', 'enviar.js', 'relatorio.js'];
    for (const f of files) expect(existsSync(join(repo.pipoDir(p.slug), 'scripts', f))).toBe(true);
    expect(validatePlaybook(v.playbook, { secrets: ['EMAIL_PASS'], scripts: files, pipos: [], mcpServers: [] })).toEqual([]);
    // Envio é ação externa e vem depois de uma confirmação.
    const keys = v.playbook.steps.map((s) => s.key);
    expect(keys.indexOf('confirmar')).toBeLessThan(keys.indexOf('enviar'));
    expect(v.playbook.steps.find((s) => s.key === 'enviar')?.external).toBe(true);

    expect(pipoSecrets(p.slug)).toEqual({ EMAIL_PASS: 'senha-de-app-123' });
    const cfg = store.getConfig(p.id)!;
    expect(cfg.values).toMatchObject({ busca: values.busca, email: 'eu@teste.com', limiteDia: '20', agenda: 'de segunda a sexta às 9h' });
    expect(cfg.values.EMAIL_PASS).toBeUndefined();
    expect(cfg.secretsSet).toEqual(['EMAIL_PASS']);
    expect(readFileSync(join(repo.pipoDir(p.slug), 'data', 'config.json'), 'utf8')).not.toContain('senha-de-app');
    expect(repo.listTriggers(p.id).map((t) => t.kind)).toEqual(['schedule']);
    expect(store.listStore()[0].installed).toBe('prospector');
    expect(store.storeItemOf(p.id)?.id).toBe('prospector');

    // Reconfigurar: senha vazia mantém a guardada; agenda vazia tira o horário.
    const next = store.saveConfig(p.id, { ...cfg.values, limiteDia: '5', EMAIL_PASS: '', agenda: '' });
    expect(next.values.limiteDia).toBe('5');
    expect(pipoSecrets(p.slug).EMAIL_PASS).toBe('senha-de-app-123');
    expect(repo.listTriggers(p.id)).toHaveLength(0);
    expect(store.getConfig(999)).toBeNull();
    expect(store.syncInstalled()).toBe(1);
  });
});

describe('Prospector de decisores', () => {
  it('ensaio: acha e escreve, mas não envia nem grava nada', async () => {
    const { p, data } = install();
    sent.length = 0;
    const sim: Sim = { prompts: {}, confirms: 0, notes: [], round: 1 };
    const r = await run(p, sim, true);
    expect(r.error).toBeNull();
    expect(r.status).toBe('done');
    expect(sent).toHaveLength(0);
    expect(existsSync(data('leads.json'))).toBe(false);
    expect(existsSync(data('variantes.json'))).toBe(false);
    expect(r.metrics).toMatchObject({ empresas: 3, enviados: 0 });
  }, 60_000);

  it('roda de verdade: valida os e-mails, envia os aprovados, lê as respostas e mede as variantes', async () => {
    const { p, data } = install();
    sent.length = 0;
    inbox.length = 0;
    const sim: Sim = { prompts: {}, confirms: 0, notes: [], round: 1 };
    const r1 = await run(p, sim);
    expect(r1.error).toBeNull();
    expect(r1.metrics).toEqual({ empresas: 3, decisores: 2, enviados: 2, respostas: 0, interessados: 0 });
    expect(sim.confirms).toBe(1);

    // O planejamento recebeu a busca do usuário; a escrita, a fila com a variante de cada um.
    expect(sim.prompts.planejar).toContain(values.busca);
    expect(sim.prompts.planejar).toContain('Crie exatamente 2 variante');
    expect(sim.prompts.empresas).toContain('Resultado de vaga');
    expect(sim.prompts.escrever).toContain('"confianca":"verificado"');

    // Ana: o formato nome.sobrenome foi aceito; Bruno: o formato visto na empresa; Carla: nenhum endereço existe.
    const base1 = JSON.parse(readFileSync(data('leads.json'), 'utf8')) as { leads: Array<Record<string, string>>; empresas: Record<string, unknown>; envios: Record<string, number> };
    expect(base1.leads.map((l) => [l.email, l.status, l.confianca])).toEqual([
      ['ana.souza@acme.com.br', 'enviado', 'verificado'],
      ['blima@beta.com.br', 'enviado', 'verificado'],
    ]);
    expect(base1.leads[1].dominio).toBe('beta.com.br');
    expect(Object.keys(base1.empresas)).toHaveLength(3);
    expect(Object.values(base1.envios)).toEqual([2]);
    // Cada lead testa uma variante diferente (duas apostas, dois envios).
    expect(new Set(base1.leads.map((l) => l.variante))).toEqual(new Set(['A', 'B']));

    expect(sent.map((m) => m.to)).toEqual(['ana.souza@acme.com.br', 'blima@beta.com.br']);
    const body = Buffer.from(sent[0].data.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8').replace(/\r\n/g, '\n');
    expect(body).toContain('Olá Ana, vi a vaga aberta.');
    expect(body).toContain('Savio Teste\nCFO interino');
    expect(body).toContain('responder "sair"');
    expect(sent[0].data).toContain('From: Savio Teste <eu@teste.com>');
    expect(sent[0].data).toContain('List-Unsubscribe: <mailto:eu@teste.com?subject=sair>');
    expect(sim.notes.at(-1)?.title).toBe('Enviei 2 e-mails.');
    expect(existsSync(data('relatorio.html'))).toBe(true);

    // Segunda rodada: a Ana respondeu e o e-mail do Bruno voltou.
    inbox.push(
      { uid: 11, headers: 'From: Newsletter <news@loja.com>\r\nSubject: Promo\r\n\r\n', text: 'Compre agora' },
      { uid: 12, headers: 'From: =?UTF-8?B?QW5hIGRlIFNvdXph?= <ana.souza@acme.com.br>\r\nSubject: Re: Sobre a vaga\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n', text: 'Tenho interesse, podemos falar amanh=C3=A3?\r\n\r\nEm seg., 16 de nov. de 2026, Savio escreveu:\r\n> Olá Ana' },
      { uid: 13, headers: 'From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>\r\nSubject: Delivery Status Notification (Failure)\r\n\r\n', text: 'Address not found: blima@beta.com.br could not be delivered.' },
    );
    sim.round = 2;
    const r2 = await run(p, sim);
    expect(r2.error).toBeNull();
    expect(r2.metrics).toEqual({ empresas: 0, decisores: 0, enviados: 0, respostas: 1, interessados: 1 });
    expect(sim.prompts.classificar).toContain('Tenho interesse, podemos falar amanhã?');
    expect(sim.prompts.classificar).not.toContain('Olá Ana');
    // Com as duas variantes já criadas, o planejamento não pede outras.
    expect(sim.prompts.planejar).toContain('Crie exatamente 0 variante');
    expect(sim.confirms).toBe(1);
    expect(sent).toHaveLength(2);

    const base2 = JSON.parse(readFileSync(data('leads.json'), 'utf8')) as { leads: Array<Record<string, string>>; caixa: { ultimoUid: number } };
    expect(base2.leads.map((l) => l.status)).toEqual(['interessado', 'bounce']);
    expect(base2.leads[0].respostaResumo).toBe('Quer conversar amanhã.');
    expect(base2.caixa.ultimoUid).toBe(13);
    expect(JSON.parse(readFileSync(data('suprimidos.json'), 'utf8'))).toEqual(['blima@beta.com.br']);
    expect(sim.notes.at(-1)?.title).toBe('Nenhum e-mail enviado nesta rodada. 1 resposta nova, 1 interessado. 1 e-mail voltou.');
    // "Melhor assunto" só aparece com amostra (5 entregues por variante); aqui ainda não há.
    expect(sim.notes.at(-1)?.body).toBe('Na base: 2 leads, 2 enviados, 1 resposta (100%), 1 interessado.');
    const html = readFileSync(data('relatorio.html'), 'utf8');
    expect(html).toContain('Ana de Souza');
    expect(html).toContain('interessado');

    // Terceira rodada sem novidade: a caixa não é relida do começo e ninguém recebe de novo.
    const r3 = await run(p, sim);
    expect(r3.metrics).toMatchObject({ respostas: 0, enviados: 0 });
    expect(sent).toHaveLength(2);
  }, 120_000);

  it('sem configuração, explica o que falta em vez de rodar', async () => {
    const { p, data } = install();
    writeFileSync(data('config.json'), JSON.stringify({ busca: '', oferta: '', remetente: '' }));
    const r = await run(p, { prompts: {}, confirms: 0, notes: [], round: 1 });
    expect(r.status).toBe('failed');
    expect(r.error).toContain('Falta configurar o Prospector: que empresas procurar, o que você oferece, seu nome (quem assina).');
  }, 30_000);
});

describe('contas do Prospector', () => {
  it('monta os formatos de e-mail, com o padrão da empresa na frente', () => {
    expect(emails.candidates('João da Silva Pereira', 'empresa.com.br').slice(0, 3)).toEqual(['joao.pereira@empresa.com.br', 'joao@empresa.com.br', 'jpereira@empresa.com.br']);
    expect(emails.candidates('João da Silva Pereira', 'empresa.com.br', 'nsobrenome')[0]).toBe('jpereira@empresa.com.br');
    expect(emails.candidates('Ana', 'x.com')).toEqual(['ana@x.com']);
    expect(emails.candidates('', 'x.com')).toEqual([]);
  });

  it('testa mais a variante que responde melhor, sem abandonar a pouco testada', () => {
    const stats = [
      { id: 'A', ativa: true, enviados: 30, respostas: 6, bounces: 0 },
      { id: 'B', ativa: true, enviados: 30, respostas: 0, bounces: 0 },
      { id: 'C', ativa: false, enviados: 0, respostas: 0, bounces: 0 },
    ];
    const extra: Record<string, number> = {};
    const picks = Array.from({ length: 20 }, () => emails.pickVariant(stats, extra)?.id);
    expect(picks.filter((x) => x === 'A').length).toBeGreaterThan(picks.filter((x) => x === 'B').length);
    expect(picks).toContain('B');
    expect(picks).not.toContain('C');
    expect(emails.pickVariant([{ id: 'N', ativa: true, enviados: 0, respostas: 0, bounces: 0 }, stats[0]], {})?.id).toBe('N');
    expect(emails.pickVariant([], {})).toBeNull();
  });

  it('entende a resposta do servidor sobre um endereço', () => {
    expect(smtpLib.verdict(250, 'ok')).toBe('aceito');
    expect(smtpLib.verdict(550, '5.1.1 The email account that you tried to reach does not exist')).toBe('recusado');
    expect(smtpLib.verdict(550, '5.7.1 Service unavailable, client host blocked using Spamhaus')).toBe('indefinido');
    expect(smtpLib.verdict(451, 'greylisted, try again later')).toBe('indefinido');
  });

  it('monta a mensagem com assunto acentuado e lê respostas em vários formatos', () => {
    const m = smtpLib.buildMessage({ from: 'eu@teste.com', fromName: 'Sávio', to: 'ana@x.com', subject: 'Sobre a vaga de Controller na Ação', text: 'Olá\n.começa com ponto' });
    expect(m.data).toContain('Subject: =?UTF-8?B?');
    expect(m.data).toMatch(/Message-ID: <[0-9a-f]{24}@teste\.com>/);
    expect(m.data.endsWith('\r\n.\r\n')).toBe(true);
    expect(imapLib.decodeWords('=?UTF-8?B?QW5hIGRlIFNvdXph?= <a@b.com>')).toBe('Ana de Souza <a@b.com>');
    expect(imapLib.decodeWords('=?iso-8859-1?Q?Jo=E3o_Silva?=')).toBe('João Silva');
    expect(imapLib.addressOf('"Ana" <Ana.Souza@Acme.com.br>')).toBe('ana.souza@acme.com.br');
    const multipart = ['--b1', 'Content-Type: text/html; charset=utf-8', '', '<p>em html</p>', '--b1', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from('Podemos falar na terça?').toString('base64'), '--b1--'].join('\r\n');
    expect(imapLib.readable('multipart/alternative; boundary="b1"', '', multipart).trim()).toBe('Podemos falar na terça?');
    expect(imapLib.readable('text/html', '', '<style>p{}</style><p>Oi&nbsp;<b>Savio</b></p>').replace(/\s+/g, ' ').trim()).toBe('Oi Savio');
    expect(imapLib.snippet('Sim, me liga.\r\n\r\nOn Mon, Nov 16, 2026 Savio wrote:\r\n> texto antigo')).toBe('Sim, me liga.');
  });
});
