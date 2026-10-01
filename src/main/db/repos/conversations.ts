import type { Attachment, ChatMessage, Conversation } from '@shared/types';
import { db } from '../index';

interface ConvRow {
  id: number;
  created_at: string;
  title: string;
  claude_session_id: string | null;
}

const toConv = (r: ConvRow): Conversation => ({ id: r.id, createdAt: r.created_at, title: r.title, claudeSessionId: r.claude_session_id });

export function createConversation(title = ''): Conversation {
  const { lastId } = db().run('INSERT INTO conversations (created_at, title) VALUES (?, ?)', new Date().toISOString(), title);
  return getConversation(lastId) as Conversation;
}

export function getConversation(id: number): Conversation | null {
  const r = db().get<ConvRow>('SELECT * FROM conversations WHERE id = ?', id);
  return r ? toConv(r) : null;
}

export function listConversations(): Conversation[] {
  return db().all<ConvRow>('SELECT * FROM conversations ORDER BY id DESC LIMIT 30').map(toConv);
}

export function setConversationSession(id: number, sessionId: string | null): void {
  db().run('UPDATE conversations SET claude_session_id = ? WHERE id = ?', sessionId, id);
}

export function setConversationTitle(id: number, title: string): void {
  db().run("UPDATE conversations SET title = ? WHERE id = ? AND title = ''", title.slice(0, 80), id);
}

interface MsgRow {
  id: number;
  conversation_id: number;
  role: 'user' | 'assistant';
  content_json: string;
  created_at: string;
}

interface AttRow {
  id: number;
  conversation_id: number | null;
  filename: string;
  mime: string;
  path: string;
  created_at: string;
}

export const toAttachment = (r: AttRow): Attachment => ({ id: r.id, conversationId: r.conversation_id, filename: r.filename, mime: r.mime, path: r.path, createdAt: r.created_at });

export function addMessage(conversationId: number, role: 'user' | 'assistant', text: string, attachmentIds: number[] = []): ChatMessage {
  const { lastId } = db().run(
    'INSERT INTO messages (conversation_id, role, content_json, created_at) VALUES (?, ?, ?, ?)',
    conversationId,
    role,
    JSON.stringify({ text, attachments: attachmentIds }),
    new Date().toISOString(),
  );
  for (const a of attachmentIds) db().run('UPDATE attachments SET conversation_id = ? WHERE id = ?', conversationId, a);
  return listMessages(conversationId).find((m) => m.id === lastId) as ChatMessage;
}

export function listMessages(conversationId: number): ChatMessage[] {
  const rows = db().all<MsgRow>('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id', conversationId);
  return rows.map((r) => {
    const c = JSON.parse(r.content_json) as { text: string; attachments?: number[] };
    const atts = (c.attachments ?? []).map((id) => db().get<AttRow>('SELECT * FROM attachments WHERE id = ?', id)).filter((x): x is AttRow => !!x).map(toAttachment);
    return { id: r.id, conversationId: r.conversation_id, role: r.role, text: c.text, attachments: atts, createdAt: r.created_at };
  });
}

export function getAttachments(ids: number[]): Attachment[] {
  return ids.map((id) => db().get<AttRow>('SELECT * FROM attachments WHERE id = ?', id)).filter((x): x is AttRow => !!x).map(toAttachment);
}

export function insertAttachment(a: Omit<Attachment, 'id' | 'createdAt'>): Attachment {
  const { lastId } = db().run('INSERT INTO attachments (conversation_id, filename, mime, path, created_at) VALUES (?, ?, ?, ?, ?)', a.conversationId, a.filename, a.mime, a.path, new Date().toISOString());
  return getAttachments([lastId])[0];
}
