'use strict';
// Cliente SMTP mínimo, só com o Node: envia e-mail pela conta do usuário e sonda se um endereço
// existe (pergunta ao servidor de destino sem enviar nada).
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

function connect(host, port, secure, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = secure ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host }) : net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`sem resposta de ${host}:${port}`));
    }, timeoutMs);
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`não conectei em ${host}:${port} (${e.code || e.message})`));
    });
  });
}

/** Lê respostas SMTP (várias linhas "250-..." terminam em "250 ..."). */
function reader(socket, timeoutMs) {
  let buf = '';
  let waiting = null;
  let failure = null;
  const take = () => {
    const lines = buf.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
        const reply = lines.slice(0, i + 1);
        buf = lines.slice(i + 1).join('\r\n');
        return { code: Number(reply[i].slice(0, 3)), text: reply.map((l) => l.slice(4)).join(' ') };
      }
    }
    return null;
  };
  const pump = () => {
    if (!waiting) return;
    const r = failure ? null : take();
    if (!r && !failure) return;
    const w = waiting;
    waiting = null;
    clearTimeout(w.timer);
    if (r) w.resolve(r);
    else w.reject(failure);
  };
  const onData = (d) => {
    buf += d.toString('utf8');
    pump();
  };
  const onEnd = (e) => {
    failure = new Error(e && e.message ? `a conexão caiu (${e.message})` : 'o servidor fechou a conexão');
    pump();
  };
  socket.on('data', onData);
  socket.on('error', onEnd);
  socket.on('close', onEnd);
  return {
    read: () =>
      new Promise((resolve, reject) => {
        waiting = { resolve, reject, timer: setTimeout(() => onEnd(new Error('tempo esgotado')), timeoutMs) };
        pump();
      }),
    detach: () => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onEnd);
      socket.removeListener('close', onEnd);
    },
  };
}

async function session(host, port, opts) {
  const timeoutMs = opts.timeoutMs || 20000;
  const implicit = !opts.semTls && port === 465;
  let socket = await connect(host, port, implicit, timeoutMs);
  let rd = reader(socket, timeoutMs);
  const cmd = async (line, okCodes) => {
    if (line !== null) socket.write(`${line}\r\n`);
    const r = await rd.read();
    if (okCodes && !okCodes.includes(r.code)) throw Object.assign(new Error(`${r.code} ${r.text}`.slice(0, 240)), { code: r.code });
    return r;
  };
  await cmd(null, [220]);
  const helo = opts.helo || 'localhost';
  let ehlo = await cmd(`EHLO ${helo}`, [250]);
  if (!implicit && !opts.semTls && /STARTTLS/i.test(ehlo.text)) {
    await cmd('STARTTLS', [220]);
    rd.detach();
    socket = await new Promise((resolve, reject) => {
      const s = tls.connect({ socket, servername: net.isIP(host) ? undefined : host }, () => resolve(s));
      s.once('error', reject);
    });
    rd = reader(socket, timeoutMs);
    ehlo = await cmd(`EHLO ${helo}`, [250]);
  }
  return {
    cmd,
    ehlo: ehlo.text,
    write: (data) => socket.write(data),
    close: () => {
      try {
        socket.write('QUIT\r\n');
      } catch {
        // já fechou
      }
      socket.destroy();
    },
  };
}

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const header = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

/** Monta a mensagem (texto simples, UTF-8) com os cabeçalhos que os servidores esperam. */
function buildMessage(m) {
  const id = m.messageId || `<${crypto.randomBytes(12).toString('hex')}@${m.from.split('@')[1]}>`;
  const head = [
    `From: ${m.fromName ? `${header(m.fromName).replace(/"/g, '')} ` : ''}<${m.from}>`,
    `To: <${m.to}>`,
    `Subject: ${header(m.subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${id}`,
    m.inReplyTo ? `In-Reply-To: ${m.inReplyTo}` : null,
    m.inReplyTo ? `References: ${m.inReplyTo}` : null,
    `List-Unsubscribe: <mailto:${m.from}?subject=sair>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  const body = b64(m.text.replace(/\r?\n/g, '\r\n')).replace(/(.{76})/g, '$1\r\n');
  return { id, data: `${head.join('\r\n')}\r\n\r\n${body}\r\n.\r\n` };
}

/** Envia uma mensagem pela conta do usuário. Devolve o Message-ID. */
async function send(account, m) {
  const s = await session(account.smtp.host, account.smtp.port, { semTls: account.semTls, helo: account.domain });
  try {
    if (/AUTH/i.test(s.ehlo) || !account.semTls) {
      try {
        await s.cmd(`AUTH PLAIN ${b64(`\u0000${account.user}\u0000${account.pass}`)}`, [235]);
      } catch (e) {
        if (e.code === 535 || e.code === 534) throw new Error('O servidor recusou o login do e-mail. No Gmail, use uma "senha de app" (Conta Google → Segurança → Senhas de app), não a senha normal.');
        // Servidor que só aceita AUTH LOGIN.
        await s.cmd('AUTH LOGIN', [334]);
        await s.cmd(b64(account.user), [334]);
        await s.cmd(b64(account.pass), [235]);
      }
    }
    const msg = buildMessage({ ...m, from: account.user, fromName: account.name });
    await s.cmd(`MAIL FROM:<${account.user}>`, [250]);
    await s.cmd(`RCPT TO:<${m.to}>`, [250, 251]);
    await s.cmd('DATA', [354]);
    s.write(msg.data);
    await s.cmd(null, [250]);
    return msg.id;
  } finally {
    s.close();
  }
}

const UNKNOWN_USER = /5\.1\.[0-9]|user unknown|unknown user|no such|does not exist|doesn't exist|not exist|recipient (address )?rejected|mailbox (unavailable|not found)|invalid (recipient|mailbox|address)|undeliverable|n[aã]o existe/i;
const BLOCKED = /5\.7\.|spamhaus|blocked|blacklist|block list|denied|policy|reputation|not allowed|relay/i;

/** O que o servidor disse sobre um endereço: existe, não existe ou não deu para saber. */
function verdict(code, textReply) {
  if (code === 250 || code === 251) return 'aceito';
  if (code >= 500 && UNKNOWN_USER.test(textReply) && !BLOCKED.test(textReply.replace(/5\.1\.[0-9]/g, ''))) return 'recusado';
  if (code === 550 && !BLOCKED.test(textReply)) return 'recusado';
  return 'indefinido';
}

/**
 * Sonda endereços no servidor de e-mail do domínio (sem enviar nada): MAIL FROM + RCPT TO.
 * Devolve {endereço: 'aceito' | 'recusado' | 'indefinido'}. Lança erro se nem conectar.
 */
async function probe(mxHost, fromAddress, addresses, opts = {}) {
  const s = await session(mxHost, opts.port || 25, { semTls: opts.semTls, helo: fromAddress.split('@')[1], timeoutMs: opts.timeoutMs || 9000 });
  const result = {};
  try {
    await s.cmd(`MAIL FROM:<${fromAddress}>`, [250]);
    for (const a of addresses) {
      const r = await s.cmd(`RCPT TO:<${a}>`);
      result[a] = verdict(r.code, r.text);
    }
  } finally {
    s.close();
  }
  return result;
}

module.exports = { send, probe, buildMessage, verdict };
