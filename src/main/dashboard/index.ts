// Janela de dashboards (Fase 22): janela normal (o notch é pequeno para gráficos), dados agregados,
// exportação CSV/PDF, "pergunte ao dashboard", relatório semanal e ferramenta para o chat.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, dialog, shell } from 'electron';
import type { DashData } from '@shared/dashboard';
import { runRaw } from '../agent/service';
import { emit } from '../bus';
import { getKV, setKV } from '../db/repos/settings';
import { balanceTransactions, stripeKey } from '../integrations/stripe';
import { interruptions } from '../interruptions/manager';
import { handle } from '../ipc';
import { registerTools } from '../mcp/tools';
import { every } from '../scheduler';
import { getProfile } from '../db/repos/profile';
import { hmToMin, minutesOfDay } from '../time';
import { getPipo, getRun, pipoDir, runSteps } from '../pipos/repo';
import { showNotch } from '../window';
import { nextRunAt, scheduleLabel } from '../pipos/triggers';
import { dashboardData, dashHooks, rangeFor } from './data';
import { pipoDashboard, pipoDashHooks, setPipoConfig } from './pipo';
import { collectOutputs, opensDirectly } from './pipo-outputs';

let win: BrowserWindow | null = null;

export function dashWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

export function openDashboard(tab?: string): void {
  if (win && !win.isDestroyed()) {
    if (tab) win.webContents.send('dash:tab', tab);
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 1140,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    show: false,
    backgroundColor: '#0B0B0D',
    title: 'Pipo · Dashboards',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => (win = null));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const query = { view: 'dashboard', ...(tab ? { tab } : {}) };
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query).toString()}`);
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { query });
}

/** Stripe por dia no período, se conectada. */
async function moneyByDay(from: Date, to: Date): Promise<DashData['money']> {
  if (!stripeKey()) return null;
  const txs = (await balanceTransactions(from)).filter((t) => t.created * 1000 < to.getTime() && ['charge', 'payment', 'refund', 'payment_refund'].includes(t.type));
  if (!txs.length) return { currency: 'BRL', total: 0, days: [] };
  const currency = txs[0].currency;
  const by = new Map<string, number>();
  for (const t of txs.filter((x) => x.currency === currency)) {
    const d = new Date(t.created * 1000);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    by.set(k, (by.get(k) ?? 0) + t.amount / 100);
  }
  const days = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, amount]) => ({ date, amount: Math.round(amount * 100) / 100 }));
  return { currency: currency.toUpperCase(), total: Math.round(days.reduce((a, d) => a + d.amount, 0) * 100) / 100, days };
}

/** Resumo enxuto para o agente (perguntas livres e a ferramenta do chat). */
export function summarizeForAgent(d: DashData): Record<string, unknown> {
  const weekdays = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const byHour = new Array<number>(24).fill(0);
  const byDay = new Array<number>(7).fill(0);
  d.rhythm.forEach((row, wd) => row.forEach((n, h) => ((byHour[h] += n), (byDay[wd] += n))));
  const topHours = byHour.map((n, h) => ({ h, n })).sort((a, b) => b.n - a.n).filter((x) => x.n > 0).slice(0, 3);
  return {
    periodo: d.range,
    totais: d.totals,
    sequencia: d.streak,
    dias: d.days.map((x) => ({ data: x.date, feitas: x.done, tarefas: x.tasksDone, trilha: x.actionsDone, cadastradas: x.created, humor: x.mood, status: x.status, dia_util: x.workday })),
    horarios_em_que_mais_faz: topHours.map((x) => `${x.h}h–${x.h + 1}h (${x.n})`),
    feitas_por_dia_da_semana: Object.fromEntries(byDay.map((n, i) => [weekdays[i], n])),
    o_que_fez: d.activities.slice(0, 60).map((a) => ({ data: a.date, tipo: a.kind === 'task' ? 'tarefa' : 'trilha', titulo: a.title, onde: a.where })),
    clientes: d.clients,
    planos: d.goals,
    equipe: d.team.map((p) => ({ nome: p.name, execucoes: p.runs, ok: p.ok, falhas: p.failed, metricas: p.metrics, versoes: p.versions })),
    dinheiro: d.money ? { moeda: d.money.currency, total: d.money.total } : null,
  };
}

/** Sexta, perto do fim do expediente: o resumo da semana (1x por semana). */
async function weeklyReport(now = new Date()): Promise<void> {
  const p = getProfile();
  if (!p || now.getDay() !== 5) return;
  const m = minutesOfDay(now);
  if (m < hmToMin(p.endTime) - 45 || m > hmToMin(p.endTime) + 120) return;
  const r = rangeFor('week', now);
  if (getKV<string | null>('dash:weekly', null) === r.from) return;
  setKV('dash:weekly', r.from);
  const d = await dashboardData(r, now);
  const t = d.totals;
  const best = summarizeForAgent(d).horarios_em_que_mais_faz as string[];
  const answer = await interruptions.request({
    type: 'pattern',
    card: {
      kind: 'info',
      glow: 'done',
      mascot: 'happy',
      label: 'sua semana',
      title: `${t.done} ${t.done === 1 ? 'atividade feita' : 'atividades feitas'} · ${t.activeWorkdays} de ${t.workdays} dias`,
      body: [`Você fez algo em ${t.activeDays} ${t.activeDays === 1 ? 'dia' : 'dias'} da semana${t.bestDay ? `; o melhor teve ${t.bestDay.done}` : ''}.`, best[0] ? `Você mais conclui por volta das ${best[0].split('–')[0]}.` : null, d.money ? `Entrou ${d.money.currency} ${d.money.total.toLocaleString('pt-BR')}.` : null].filter(Boolean).join('\n'),
      buttons: [
        { id: 'ok', label: 'Boa', kbd: 'N', variant: 'secondary' },
        { id: 'open', label: 'Ver dashboard', kbd: 'Y', variant: 'primary' },
      ],
    },
    queueable: true,
  });
  if (answer === 'open') openDashboard('overview');
}

export function registerDashboard(): void {
  dashHooks.money = moneyByDay;
  handle('dash:open', (tab) => openDashboard(tab ?? undefined));
  handle('dash:data', (range) => dashboardData(range.kind === 'custom' ? range : rangeFor(range.kind, range.from ? new Date(`${range.from}T12:00:00`) : new Date())));
  handle('dash:exportCsv', async (name, csv) => {
    const r = await dialog.showSaveDialog(win ?? (undefined as unknown as BrowserWindow), { defaultPath: `${name}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return null;
    writeFileSync(r.filePath, `﻿${csv}`);
    return r.filePath;
  });
  handle('dash:exportPdf', async (name) => {
    if (!win) return null;
    const r = await dialog.showSaveDialog(win, { defaultPath: `${name}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return null;
    const pdf = await win.webContents.printToPDF({ printBackground: true, landscape: true, pageSize: 'A4' });
    writeFileSync(r.filePath, pdf);
    return r.filePath;
  });
  handle('dash:ask', async (question, range) => {
    const d = await dashboardData(range.kind === 'custom' ? range : rangeFor(range.kind, new Date(`${range.from}T12:00:00`)));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 120_000);
    try {
      return await runRaw({
        system:
          'Você é o Pipo respondendo uma pergunta sobre os dashboards do usuário. Use SÓ os dados agregados abaixo; não invente. Responda em português do Brasil, em no máximo 3 frases curtas, com os números que importam. Se os dados não respondem, diga o que falta.',
        prompt: `Pergunta: ${question}\n\nDados (JSON):\n${JSON.stringify(summarizeForAgent(d))}`,
        model: 'sonnet',
        effort: 'low',
        readDirs: [],
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  });

  pipoDashHooks.next = (pipoId) => ({ at: nextRunAt(pipoId), label: scheduleLabel(pipoId) });
  handle('dash:pipo', (pipoId, range) => pipoDashboard(pipoId, range.kind === 'custom' ? range : rangeFor(range.kind, range.from ? new Date(`${range.from}T12:00:00`) : new Date())));
  handle('dash:setPipoConfig', (pipoId, config) => setPipoConfig(pipoId, config));
  handle('dash:openPipoOutput', async (pipoId, runId, target) => {
    const p = getPipo(pipoId);
    const run = getRun(runId);
    if (!p || !run || run.pipoId !== p.id) return false;
    // Só abre o que a própria execução produziu: o caminho é conferido de novo aqui.
    const item = collectOutputs(pipoDir(p.slug), runId, run.startedAt, runSteps(runId).map((s) => ({ key: s.key, title: s.title }))).items.find((x) => x.target === target);
    if (!item) return false;
    if (item.kind === 'link') await shell.openExternal(item.target);
    else if (opensDirectly(item.target)) return (await shell.openPath(item.target)) === '';
    else shell.showItemInFolder(item.target);
    return true;
  });
  handle('dash:openPipoRun', (pipoId, runId) => {
    // O clique veio da janela de dashboards: o notch precisa vir à frente para a execução aparecer.
    showNotch(true);
    emit('ui:openPipoRun', { pipoId, runId });
  });

  registerTools([
    {
      name: 'get_dashboard',
      modes: ['chat', 'pipo'],
      description:
        'Números de um período (today, week, month, year), contados pelo que foi feito: atividades feitas por dia (tarefas concluídas e ações da trilha), dias com atividade, sequência, o que foi feito, horários e dias da semana em que mais conclui, clientes, planos, humor, métricas dos Pipos e dinheiro. Use para "quantos dias eu fiz algo?", "como foi meu mês?".',
      inputSchema: { type: 'object', properties: { period: { type: 'string', enum: ['today', 'week', 'month', 'year'] } } },
      run: async (a) => summarizeForAgent(await dashboardData(rangeFor((a.period as 'today' | 'week' | 'month' | 'year') ?? 'week'))),
    },
  ]);

  every('weeklyReport', 10 * 60_000, () => weeklyReport());
}
