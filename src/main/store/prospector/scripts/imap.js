'use strict';
// Cliente IMAP mínimo, só com o Node: lê as mensagens novas da caixa de entrada (remetente, assunto
// e o começo do texto) para o Prospector saber quem respondeu e quais e-mails voltaram.
const net = require('net');
const tls = require('tls');

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

/**
 * Lê respostas do servidor. Cada resposta é uma lista de partes: texto (uma linha) e Buffer (um
 * literal "{123}" que vem logo depois da linha).
 */
function reader(socket, timeoutMs) {
  let buf = Buffer.alloc(0);
  let waiting = null;
  let failure = null;
  const take = () => {
    let pos = 0;
    const parts = [];
    for (;;) {
      const nl = buf.indexOf('\r\n', pos);
      if (nl < 0) return null;
      const line = buf.slice(pos, nl).toString('utf8');
      parts.push(line);
      pos = nl + 2;
      const lit = /\{(\d+)\}$/.exec(line);
      if (!lit) break;
      const n = Number(lit[1]);
      if (buf.length < pos + n) return null;
      parts.push(buf.slice(pos, pos + n));
      pos += n;
    }
    buf = buf.slice(pos);
    return parts;
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
  const fail = (e) => {
    failure = new Error(e && e.message ? `a conexão caiu (${e.message})` : 'o servidor fechou a conexão');
    pump();
  };
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    pump();
  });
  socket.on('error', fail);
  socket.on('close', fail);
  return () =>
    new Promise((resolve, reject) => {
      waiting = { resolve, reject, timer: setTimeout(() => fail(new Error('tempo esgotado')), timeoutMs) };
      pump();
    });
}

const quote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const imapDate = (d) => `${d.getDate()}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;

/** "=?UTF-8?B?...?=" e "=?UTF-8?Q?...?=" viram texto. */
function decodeWords(s) {
  return String(s || '').replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(\s+(?==\?))?/g, (_m, charset, enc, data) => {
    try {
      const bytes = enc.toLowerCase() === 'b' ? Buffer.from(data, 'base64') : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h) => String.fromCharCode(parseInt(h, 16))), 'binary');
      return bytes.toString(/8859|1252|latin/i.test(charset) ? 'latin1' : 'utf8');
    } catch {
      return data;
    }
  });
}

function parseHeaders(raw) {
  const out = {};
  for (const line of String(raw).replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = decodeWords(line.slice(i + 1).trim());
  }
  return out;
}

const qp = (s) => Buffer.from(s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))), 'binary').toString('utf8');

/** O texto legível de uma mensagem (procura a parte de texto simples dentro do multipart). */
function readable(ctype, encoding, raw, depth = 0) {
  const boundary = /boundary="?([^";\s]+)"?/i.exec(ctype || '');
  if (boundary && depth < 3) {
    const parts = raw.split(`--${boundary[1]}`).slice(1);
    const pick = parts.find((p) => /content-type:\s*text\/plain/i.test(p)) || parts.find((p) => /content-type:\s*multipart\//i.test(p)) || parts.find((p) => /content-type:\s*text\/html/i.test(p)) || parts[0];
    if (!pick) return '';
    const cut = pick.search(/\r?\n\r?\n/);
    const head = parseHeaders(cut >= 0 ? pick.slice(0, cut) : '');
    return readable(head['content-type'] || '', head['content-transfer-encoding'] || '', cut >= 0 ? pick.slice(cut) : pick, depth + 1);
  }
  let body = raw;
  const enc = String(encoding || '').toLowerCase();
  if (enc === 'base64') {
    const clean = body.replace(/[^A-Za-z0-9+/=]/g, '');
    body = Buffer.from(clean.slice(0, clean.length - (clean.length % 4)), 'base64').toString('utf8');
  } else if (enc === 'quoted-printable') body = qp(body);
  if (/html/i.test(ctype || '')) body = body.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  return body;
}

/** Só a resposta nova: corta a citação da mensagem original e a assinatura do aplicativo. */
function snippet(body) {
  const cut = body.split(/\r?\n(?:Em .{4,90} escreveu:|On .{4,90} wrote:|Le .{4,90} a écrit|-{2,} ?(?:Original Message|Mensagem original)|De: .{3,80}\r?\nEnviad|From: .{3,80}\r?\nSent:|> )/i)[0];
  return cut.replace(/\s+/g, ' ').trim().slice(0, 700);
}

const addressOf = (from) => {
  const m = /<([^>]+)>/.exec(from || '') || /([^\s<>"]+@[^\s<>"]+)/.exec(from || '');
  return m ? m[1].trim().toLowerCase() : '';
};

/**
 * Mensagens da caixa de entrada depois de `afterUid` (ou dos últimos `sinceDays` dias na primeira vez).
 * Devolve {mensagens: [{uid, de, endereco, assunto, texto, bruto}], ultimoUid}.
 */
async function fetchNew(account, opts = {}) {
  const timeoutMs = opts.timeoutMs || 25000;
  const socket = await connect(account.imap.host, account.imap.port, !account.semTls, timeoutMs);
  const read = reader(socket, timeoutMs);
  let tag = 0;
  /** Manda um comando e junta as respostas até a linha final ("a3 OK ..."). */
  const run = async (command) => {
    const id = `a${++tag}`;
    socket.write(`${id} ${command}\r\n`);
    const untagged = [];
    for (;;) {
      const parts = await read();
      const first = String(parts[0]);
      if (first.startsWith(`${id} `)) {
        if (!/^\S+ OK/i.test(first)) throw new Error(first.slice(id.length + 1).slice(0, 200));
        return untagged;
      }
      untagged.push(parts);
    }
  };
  try {
    await read();
    try {
      await run(`LOGIN ${quote(account.user)} ${quote(account.pass)}`);
    } catch (e) {
      throw new Error(`O servidor recusou o login do e-mail (${e.message}). No Gmail, use uma "senha de app" e deixe o IMAP ligado.`);
    }
    await run('SELECT INBOX');
    const after = Number(opts.afterUid || 0);
    const since = new Date(Date.now() - (opts.sinceDays || 14) * 86400000);
    const found = await run(after ? `UID SEARCH UID ${after + 1}:*` : `UID SEARCH SINCE ${imapDate(since)}`);
    const uids = found
      .map((p) => String(p[0]))
      .filter((l) => /^\* SEARCH/i.test(l))
      .flatMap((l) => l.replace(/^\* SEARCH/i, '').trim().split(/\s+/))
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > after)
      .sort((a, b) => a - b)
      .slice(-(opts.max || 150));
    const mensagens = [];
    for (let i = 0; i < uids.length; i += 40) {
      const chunk = uids.slice(i, i + 40);
      const res = await run(`UID FETCH ${chunk.join(',')} (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE CONTENT-TYPE CONTENT-TRANSFER-ENCODING AUTO-SUBMITTED)] BODY.PEEK[TEXT]<0.6000>)`);
      for (const parts of res) {
        const first = String(parts[0]);
        if (!/^\* \d+ FETCH/i.test(first)) continue;
        let headers = '';
        let body = '';
        // Cada literal pertence à seção nomeada no texto que vem logo antes dele.
        for (let k = 1; k < parts.length; k += 2) {
          const label = String(parts[k - 1]);
          const lit = Buffer.isBuffer(parts[k]) ? parts[k].toString('utf8') : '';
          if (/HEADER\.FIELDS[^\]]*\]\s*\{\d+\}$/i.test(label)) headers = lit;
          else if (/BODY\[TEXT\](<\d+>)?\s*\{\d+\}$/i.test(label)) body = lit;
        }
        const uid = Number((/UID (\d+)/i.exec(parts.filter((p) => typeof p === 'string').join(' ')) || [])[1] || 0);
        const h = parseHeaders(headers);
        mensagens.push({
          uid,
          de: h.from || '',
          endereco: addressOf(h.from),
          assunto: h.subject || '',
          automatica: /auto-(replied|generated)/i.test(h['auto-submitted'] || ''),
          texto: snippet(readable(h['content-type'] || '', h['content-transfer-encoding'] || '', body)),
          bruto: body.slice(0, 6000),
        });
      }
    }
    try {
      socket.write(`a${++tag} LOGOUT\r\n`);
    } catch {
      // já fechou
    }
    return { mensagens, ultimoUid: uids.length ? uids[uids.length - 1] : after };
  } finally {
    socket.destroy();
  }
}

module.exports = { fetchNew, decodeWords, parseHeaders, readable, snippet, addressOf };
