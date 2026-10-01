// /criarpipo e /editarpipo: liga a conversa do chat ao rascunho, ao prompt do construtor e às
// ferramentas; campo seguro de segredos; modelos próprios ("Salvar como modelo").
import { EMPTY_PLAYBOOK, PIPO_COLORS, type PipoModel } from '@shared/pipos';
import { readFileSync, writeFileSync } from 'node:fs';
import { BrowserWindow, dialog } from 'electron';
import { deleteModel, exportPipo, getModel, importPipo, insertModel, listModels, modelFromPipo, writeFiles } from './models';
import { promptHooks } from '../agent/service';
import { createConversation, getConversation } from '../db/repos/conversations';
import { getProfile } from '../db/repos/profile';
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
import { setPipoSecret } from './secrets';

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
      writeFiles(p.slug, m.files);
      setLive(p.id, 'draft');
      const d = createDraft(conv.id, { pipoId: p.id, plan: m.playbook, triggers: { schedule: m.triggers.schedule, after: null, events: [] } }, m.id);
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

  handle('pipos:saveModel', (id) => insertModel(modelFromPipo(id)));
  handle('pipos:models', () => listModels());
  handle('pipos:deleteModel', (id) => deleteModel(id));
  // .pipo: compartilhar um Pipo (sem segredos) e importar de outra pessoa.
  handle('pipos:exportFile', async (id) => {
    const p = getPipo(id);
    if (!p) throw new Error('Pipo não encontrado.');
    const content = exportPipo(id);
    const win = BrowserWindow.getFocusedWindow();
    const opts = { defaultPath: `${p.slug}.pipo`, filters: [{ name: 'Pipo', extensions: ['pipo'] }] };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    writeFileSync(r.filePath, content);
    return r.filePath;
  });
  handle('pipos:importFile', async (path) => {
    let file = path ?? null;
    if (!file) {
      const win = BrowserWindow.getFocusedWindow();
      const opts = { filters: [{ name: 'Pipo', extensions: ['pipo', 'json'] }], properties: ['openFile' as const] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (r.canceled || !r.filePaths[0]) return null;
      file = r.filePaths[0];
    }
    const m = importPipo(readFileSync(file, 'utf8'));
    return { modelId: m.id, name: m.name, secrets: m.secrets };
  });
}
