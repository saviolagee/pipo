// /criarpipo e /editarpipo: liga a conversa do chat ao rascunho, ao prompt do construtor e às
// ferramentas; campo seguro de segredos; modelos próprios ("Salvar como modelo").
import { EMPTY_PLAYBOOK, PIPO_COLORS, type PipoModel, type PipoPlaybook } from '@shared/pipos';
import { promptHooks } from '../agent/service';
import { createConversation, getConversation } from '../db/repos/conversations';
import { getProfile } from '../db/repos/profile';
import { db } from '../db';
import { dismissCard } from '../cards';
import { handle } from '../ipc';
import { buildBuilderPrompt } from './builder-prompt';
import { builderHooks, emitDraft, registerBuilderTools } from './builder-tools';
import { emit } from '../bus';
import { createDraft, draftForConversation, getDraft, openDrafts } from './drafts';
import { pipesChanged } from './ipc';
import { setLive } from './live';
import { activePlaybook, createPipo, getPipo, listPipos } from './repo';
import { takeSecretCard } from './secret-cards';
import { secretNames, setPipoSecret } from './secrets';

interface ModelRow {
  id: number;
  name: string;
  personality_json: string;
  playbook_json: string;
  color: PipoModel['color'];
  accessory: PipoModel['accessory'];
  secrets_json: string;
  created_at: string;
}

const toModel = (r: ModelRow): PipoModel => ({
  id: r.id,
  name: r.name,
  color: r.color,
  accessory: r.accessory,
  personality: JSON.parse(r.personality_json) as PipoModel['personality'],
  playbook: { ...EMPTY_PLAYBOOK, ...(JSON.parse(r.playbook_json) as Partial<PipoPlaybook>) },
  secrets: JSON.parse(r.secrets_json) as string[],
  createdAt: r.created_at,
});

export function listModels(): PipoModel[] {
  return db().all<ModelRow>('SELECT * FROM pipo_models ORDER BY id DESC').map(toModel);
}

export function getModel(id: number): PipoModel | null {
  const r = db().get<ModelRow>('SELECT * FROM pipo_models WHERE id = ?', id);
  return r ? toModel(r) : null;
}

export function insertModel(m: Omit<PipoModel, 'id' | 'createdAt'>): PipoModel {
  const { lastId } = db().run(
    'INSERT INTO pipo_models (name, personality_json, playbook_json, color, accessory, secrets_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    m.name,
    JSON.stringify(m.personality),
    JSON.stringify(m.playbook),
    m.color,
    m.accessory,
    JSON.stringify(m.secrets),
    new Date().toISOString(),
  );
  return getModel(lastId) as PipoModel;
}

export function registerBuilder(): void {
  registerBuilderTools();
  // Até o chat próprio de cada Pipo existir (Fase 20), a apresentação aparece como aviso.
  builderHooks.introduce = (_id, text) => emit('toast:show', { id: `intro:${Date.now()}`, text, durationMs: 8000 });
  promptHooks.builder = (draftId) => {
    const d = getDraft(draftId);
    return d ? buildBuilderPrompt(d, getProfile()?.name || 'o usuário') : '';
  };
  const prevModeFor = promptHooks.modeFor;
  promptHooks.modeFor = (conversationId) => {
    const d = draftForConversation(conversationId);
    if (d) return { mode: 'builder', draftId: d.id };
    return prevModeFor?.(conversationId) ?? null;
  };

  // Mini-Pipos de rascunho aparecem tracejados na pill.
  for (const d of openDrafts()) if (d.data.pipoId && !getPipo(d.data.pipoId)?.activeVersion) setLive(d.data.pipoId, 'draft');

  handle('pipos:startDraft', (opts) => {
    if (opts.editSlug) {
      const p = getPipo(opts.editSlug);
      if (!p) throw new Error(`Não existe Pipo @${opts.editSlug}.`);
      const existing = openDrafts().find((d) => d.data.pipoId === p.id && d.data.editing);
      if (existing?.conversationId && getConversation(existing.conversationId)) return { conversationId: existing.conversationId, draftId: existing.id, resumed: true, name: p.name };
      const conv = createConversation();
      const d = createDraft(conv.id, { pipoId: p.id, editing: true, plan: activePlaybook(p.id)?.playbook ?? EMPTY_PLAYBOOK });
      emitDraft(d);
      return { conversationId: conv.id, draftId: d.id, resumed: false, name: p.name };
    }
    if (!opts.fresh && !opts.fromModelId) {
      // Rascunho persistente: continua o último que ficou pela metade.
      const open = openDrafts().find((d) => !d.data.editing && d.conversationId && getConversation(d.conversationId));
      if (open) {
        const p = open.data.pipoId ? getPipo(open.data.pipoId) : null;
        return { conversationId: open.conversationId as number, draftId: open.id, resumed: true, name: p?.name ?? null };
      }
    }
    const conv = createConversation();
    if (opts.fromModelId) {
      const m = getModel(opts.fromModelId);
      if (!m) throw new Error('Modelo não encontrado.');
      const used = new Set(listPipos().map((x) => x.color));
      const color = used.has(m.color) ? ((Object.keys(PIPO_COLORS) as Array<PipoModel['color']>).find((c) => !used.has(c)) ?? m.color) : m.color;
      const p = createPipo({ name: m.name, color, accessory: m.accessory, personality: m.personality });
      setLive(p.id, 'draft');
      const d = createDraft(conv.id, { pipoId: p.id, plan: m.playbook }, m.id);
      emitDraft(d);
      pipesChanged();
      return { conversationId: conv.id, draftId: d.id, resumed: false, name: p.name };
    }
    const d = createDraft(conv.id);
    emitDraft(d);
    return { conversationId: conv.id, draftId: d.id, resumed: false, name: null };
  });

  handle('pipos:draftFor', (conversationId) => {
    const d = draftForConversation(conversationId);
    if (!d) return null;
    const p = d.data.pipoId ? getPipo(d.data.pipoId) : null;
    return { conversationId: d.conversationId, draftId: d.id, stage: d.stage, name: p?.name ?? null, color: p ? PIPO_COLORS[p.color] : null, editing: d.data.editing };
  });

  // O valor vem do campo seguro do card direto para o cofre; nunca passa pelo agente.
  handle('pipos:submitSecret', (cardId, value) => {
    if (!value.trim()) return false;
    const s = takeSecretCard(cardId);
    const p = s ? getPipo(s.pipoId) : null;
    if (!s || !p) return false;
    setPipoSecret(p.slug, s.name, value.trim());
    dismissCard(cardId, 'saved');
    pipesChanged();
    return true;
  });

  handle('pipos:saveModel', (id) => {
    const p = getPipo(id);
    const v = p ? activePlaybook(id) : null;
    if (!p || !v) throw new Error('Só dá para salvar como modelo um Pipo já contratado.');
    return insertModel({ name: p.name, color: p.color, accessory: p.accessory, personality: p.personality, playbook: v.playbook, secrets: secretNames(p.slug) });
  });
  handle('pipos:models', () => listModels());
  handle('pipos:deleteModel', (id) => {
    db().run('DELETE FROM pipo_models WHERE id = ?', id);
  });
}
