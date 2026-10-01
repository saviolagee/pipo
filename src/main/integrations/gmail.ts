// Gmail somente leitura (gmail.readonly): usado na reação de e-mail longo e quando o usuário pede no chat.
import { googleFetch } from './google-auth';

interface MsgRef {
  id: string;
}
interface Msg {
  id: string;
  snippet: string;
  payload: { headers: Array<{ name: string; value: string }> };
}

export async function unreadEmails(max: number): Promise<Array<{ from: string; subject: string; snippet: string; date: string }>> {
  const q = new URLSearchParams({ q: 'is:unread in:inbox -category:promotions -category:social', maxResults: String(max) });
  const list = await googleFetch<{ messages?: MsgRef[] }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${q.toString()}`);
  const out = [];
  for (const m of list.messages ?? []) {
    const full = await googleFetch<Msg>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    const h = (n: string): string => full.payload.headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? '';
    out.push({ from: h('From'), subject: h('Subject'), snippet: full.snippet, date: h('Date') });
  }
  return out;
}
