// Janela de dashboards (Fase 22): janela normal (o notch é pequeno para gráficos), dados agregados,
// exportação CSV/PDF, "pergunte ao dashboard", relatório semanal e ferramenta para o chat.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import type { DashData } from '@shared/dashboard';
import { fmtHM } from '@shared/format';
import { runRaw } from '../agent/service';
import { getKV, setKV } from '../db/repos/settings';
import { balanceTransactions, stripeKey } from '../integrations/stripe';
import { interruptions } from '../interruptions/manager';
import { handle } from '../ipc';
import { registerTools } from '../mcp/tools';
import { every } from '../scheduler';
import { getProfile } from '../db/repos/profile';
import { hmToMin, minutesOfDay } from '../time';
import { clientEcon, dashboardData, dashHooks, rangeFor } from './data';

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
  d.rhythm.forEach((row, wd) => row.forEach((m, h) => ((byHour[h] += m), (byDay[wd] += m))));
  const topHours = byHour.map((m, h) => ({ h, m })).sort((a, b) => b.m - a.m).filter((x) => x.m > 0).slice(0, 3);
  return {
    periodo: d.range,
    totais: { ...d.totals, horas: fmtHM(d.totals.workedMin), meta: fmtHM(d.totals.goalMin) },
    dias: d.days.map((x) => ({ data: x.date, horas_min: x.workedMin, meta_min: x.goalMin, foco_min: x.focusMin, distracao_min: x.distractedMin, tarefas: x.tasksDone, humor: x.mood, status: x.status })),
    melhores_horarios: topHours.map((x) => `${x.h}h–${x.h + 1}h (${Math.round(x.m)} min)`),
    minutos_por_dia_da_semana: Object.fromEntries(byDay.map((m, i) => [weekdays[i], Math.round(m)])),
    distracoes: d.distractions,
    clientes: d.clients,
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
  const best = summarizeForAgent(d).melhores_horarios as string[];
  const answer = await interruptions.request({
    type: 'pattern',
    card: {
      kind: 'info',
      glow: 'done',
      mascot: 'happy',
      label: 'sua semana',
      title: `${fmtHM(t.workedMin)} de ${fmtHM(t.goalMin)} · ${t.tasksDone} tarefas`,
      body: [`Meta batida em ${t.goalDays} dia(s). Foco: ${fmtHM(t.focusMin)}. Distração: ${fmtHM(t.distractedMin)}.`, best[0] ? `Você rendeu mais ${best[0].split(' (')[0]}.` : null, d.money ? `Entrou ${d.money.currency} ${d.money.total.toLocaleString('pt-BR')}.` : null].filter(Boolean).join('\n'),
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
  handle('dash:setClientEcon', (clientId, econ) => {
    setKV('clients:econ', { ...clientEcon(), [String(clientId)]: econ });
  });
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

  registerTools([
    {
      name: 'get_dashboard',
      modes: ['chat', 'pipo'],
      description:
        'Números agregados de um período (today, week, month, year): horas por dia vs meta, foco, distração, tarefas, humor, melhores horários, minutos por dia da semana, clientes (valor/hora efetivo), métricas dos Pipos e dinheiro. Use para "em que horário eu rendo mais?", "como foi meu mês?".',
      inputSchema: { type: 'object', properties: { period: { type: 'string', enum: ['today', 'week', 'month', 'year'] } } },
      run: async (a) => summarizeForAgent(await dashboardData(rangeFor((a.period as 'today' | 'week' | 'month' | 'year') ?? 'week'))),
    },
  ]);

  every('weeklyReport', 10 * 60_000, () => weeklyReport());
}
