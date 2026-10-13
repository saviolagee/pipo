import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'pipo-painel-'));
vi.mock('electron', () => ({
  app: { getPath: () => dir, isPackaged: false, getName: () => 'Pipo', on: () => undefined },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  BrowserWindow: class {},
  dialog: {},
  shell: {},
  protocol: {},
  powerMonitor: {},
}));
const { openDb, db } = await import('../src/main/db');
const repo = await import('../src/main/pipos/repo');
const { rangeFor } = await import('../src/main/dashboard/data');
const { headlineKey, pipoDashboard, prevRange, setPipoConfig } = await import('../src/main/dashboard/pipo');
const { collectOutputs, opensDirectly } = await import('../src/main/dashboard/pipo-outputs');
const { execute } = await import('../src/main/pipos/runner');
const { normalizePipoConfig, packPipoCards, PIPO_CARDS } = await import('../src/shared/dashboard');
const { EMPTY_PLAYBOOK } = await import('../src/shared/pipos');
type Deps = import('../src/main/pipos/runner').RunnerDeps;

const at = (y: number, m: number, d: number, h = 9): Date => new Date(y, m - 1, d, h);
/** Quarta-feira, 07/10/2026 ao meio-dia: a semana (05–11/10) está pela metade. */
const NOW = at(2026, 10, 7, 12);

interface NewRun {
  at: Date;
  status?: string;
  metrics?: Record<string, number>;
  dry?: boolean;
  error?: string | null;
  tokens?: [number, number];
  minutes?: number;
}

function addRun(pipoId: number, o: NewRun): number {
  const status = o.status ?? 'done';
  const finished = status === 'running' ? null : new Date(o.at.getTime() + (o.minutes ?? 2) * 60_000).toISOString();
  return db().run(
    'INSERT INTO pipo_runs (pipo_id, version, trigger, status, dry_run, started_at, finished_at, summary, metrics_json, error, tokens_in, tokens_out) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    pipoId,
    'manual',
    status,
    !!o.dry,
    o.at.toISOString(),
    finished,
    'ok',
    JSON.stringify(o.metrics ?? {}),
    o.error ?? null,
    o.tokens?.[0] ?? 0,
    o.tokens?.[1] ?? 0,
  ).lastId;
}

function addStep(runId: number, key: string, title: string, status: string, error: string | null = null): void {
  db().run("INSERT INTO pipo_run_steps (run_id, step_key, title, kind, status, started_at, error) VALUES (?, ?, ?, 'script', ?, ?, ?)", runId, key, title, status, NOW.toISOString(), error);
}

function videoPipo(name = 'Editor de Vídeo'): ReturnType<typeof repo.createPipo> {
  const p = repo.createPipo({ name, color: 'purple', personality: { mission: 'Eu edito e publico os vídeos', tone: '', never: [] } });
  repo.addVersion(
    p.id,
    {
      ...EMPTY_PLAYBOOK,
      steps: [{ kind: 'notify', key: 'a', title: 'A' }],
      metrics: [
        { key: 'minutos', label: 'minutos de vídeo', from: '1' },
        { key: 'videos', label: 'vídeos feitos', from: '1', main: true },
      ],
      savedMinutesPerRun: 30,
    },
    'v1',
  );
  return repo.getPipo(p.id) as ReturnType<typeof repo.createPipo>;
}

describe('painel de cada Pipo', () => {
  it('um Pipo de vídeo mostra os vídeos feitos, o custo e a comparação com o mesmo trecho da semana anterior', () => {
    openDb(':memory:');
    const p = videoPipo();
    addRun(p.id, { at: at(2026, 9, 28), metrics: { videos: 1, minutos: 4 } });
    // Quinta da semana anterior: fica fora da comparação (a semana atual só chegou à quarta).
    addRun(p.id, { at: at(2026, 10, 1), metrics: { videos: 5, minutos: 20 } });
    addRun(p.id, { at: at(2026, 10, 5), metrics: { videos: 2, minutos: 10 }, tokens: [1000, 200] });
    addRun(p.id, { at: at(2026, 10, 6), metrics: { videos: 3, minutos: 12 }, tokens: [1500, 300] });
    addRun(p.id, { at: at(2026, 10, 6, 15), dry: true, tokens: [500, 100] });
    const f1 = addRun(p.id, { at: at(2026, 10, 7, 9), status: 'failed', error: 'Renderizar: O script terminou com erro (código 1). 3 quadros corrompidos' });
    addStep(f1, 'render', 'Renderizar', 'failed', 'O script terminou com erro (código 1). 3 quadros corrompidos');
    const f2 = addRun(p.id, { at: at(2026, 10, 7, 10), status: 'failed', error: 'Renderizar: O script terminou com erro (código 1). 7 quadros corrompidos' });
    addStep(f2, 'render', 'Renderizar', 'failed', 'O script terminou com erro (código 1). 7 quadros corrompidos');

    const d = pipoDashboard(p.id, rangeFor('week', NOW), NOW)!;
    expect(d.prevRange).toMatchObject({ from: '2026-09-28', to: '2026-09-30' });
    // A métrica marcada como principal no plano é o número em destaque.
    expect(d.metrics.map((m) => [m.key, m.total, m.prev, m.headline])).toEqual([
      ['minutos', 22, 4, false],
      ['videos', 5, 1, true],
    ]);
    expect(d.totals).toMatchObject({ runs: 4, ok: 2, failed: 2, cancelled: 0, avgSec: 120, savedMin: 60 });
    // Ensaios entram no custo, mas não na contagem de execuções.
    expect(d.totals.tokens).toBe(1200 + 1800 + 600);
    expect(d.tokensPerRun).toBe(1500);
    expect(d.month).toEqual({ tokens: 3600, runs: 5 });
    expect(d.prev).toMatchObject({ runs: 1, ok: 1, savedMin: 30 });
    expect(d.days.map((x) => [x.date, x.runs, x.failed, x.metrics.videos ?? 0])).toEqual([
      ['2026-10-05', 1, 0, 2],
      ['2026-10-06', 1, 0, 3],
      ['2026-10-07', 2, 2, 0],
    ]);
    // O mesmo motivo com números diferentes é uma falha só, contada duas vezes.
    expect(d.failures).toHaveLength(1);
    expect(d.failures[0]).toMatchObject({ step: 'Renderizar', count: 2, lastRunId: f2, reason: 'O script terminou com erro (código 1). 7 quadros corrompidos' });
    expect(d.runs.map((r) => r.id)[0]).toBe(f2);
    expect(d.runs[0]).toMatchObject({ status: 'failed', failedStep: 'Renderizar', durationSec: 120 });
    expect(d.runs.some((r) => r.tokens === 600)).toBe(false);
  });

  it('o usuário escolhe o destaque, a ordem e o que fica oculto', () => {
    openDb(':memory:');
    const p = videoPipo();
    addRun(p.id, { at: at(2026, 10, 5), metrics: { videos: 2, minutos: 10 } });
    setPipoConfig(p.id, { headline: 'minutos', order: ['timeline', 'inexistente' as never], hidden: ['funnel', 'funnel'] });
    const d = pipoDashboard(p.id, rangeFor('week', NOW), NOW)!;
    expect(d.metrics.find((m) => m.headline)?.key).toBe('minutos');
    expect(d.config.order[0]).toBe('timeline');
    expect([...d.config.order].sort()).toEqual([...PIPO_CARDS].sort());
    expect(d.config.hidden).toEqual(['funnel']);
    // Um destaque que saiu do plano volta para o principal.
    setPipoConfig(p.id, { headline: 'sumiu' });
    expect(pipoDashboard(p.id, rangeFor('week', NOW), NOW)!.metrics.find((m) => m.headline)?.key).toBe('videos');
    expect(pipoDashboard(9999, rangeFor('week', NOW), NOW)).toBeNull();
  });

  it('a galeria traz os arquivos que existem e os links que os passos devolveram', () => {
    openDb(':memory:');
    const p = videoPipo('Editor Dois');
    const runId = addRun(p.id, { at: at(2026, 10, 6), metrics: { videos: 1 } });
    addStep(runId, 'render', 'Renderizar', 'done');
    const runDir = join(repo.pipoDir(p.slug), 'runs', String(runId));
    mkdirSync(runDir, { recursive: true });
    const video = join(dir, 'saida final.mp4');
    writeFileSync(video, 'x');
    writeFileSync(join(runDir, 'entrada.json'), 'null');
    writeFileSync(join(runDir, 'legenda.srt'), '1');
    writeFileSync(
      join(runDir, 'render.json'),
      JSON.stringify({ videos: [{ arquivo: video, url: 'https://youtu.be/abc' }, { arquivo: join(dir, 'nao-existe.mp4') }], repetido: video, texto: 'veja https://exemplo.com no meio da frase' }),
    );
    const found = collectOutputs(repo.pipoDir(p.slug), runId, at(2026, 10, 6).toISOString(), [{ key: 'render', title: 'Renderizar' }]);
    expect(found.more).toBe(0);
    expect(found.items.map((x) => [x.kind, x.media, x.label, x.step])).toEqual([
      ['file', 'video', 'saida final.mp4', 'Renderizar'],
      ['file', 'doc', 'legenda.srt', null],
      ['link', 'link', 'youtu.be/abc', 'Renderizar'],
    ]);
    const d = pipoDashboard(p.id, rangeFor('week', NOW), NOW)!;
    expect(d.outputs).toHaveLength(3);
    expect(d.runs[0].outputs).toBe(3);
    // Só mídia e documento abrem direto; o resto é mostrado na pasta.
    expect([opensDirectly('a.mp4'), opensDirectly('a.PDF'), opensDirectly('a.exe'), opensDirectly('a.bat'), opensDirectly('semextensao')]).toEqual([true, true, false, false, false]);
  });

  it('pendências: confirmação esperando e entrega de outro Pipo na fila', () => {
    openDb(':memory:');
    const p = videoPipo('Editor Três');
    const other = repo.createPipo({ name: 'Roteirista', color: 'blue', personality: { mission: '', tone: '', never: [] } });
    const waiting = addRun(p.id, { at: at(2026, 10, 7, 11), status: 'running' });
    addStep(waiting, 'ok', 'Confirmar publicação', 'waiting');
    // Confirmação de uma execução que já foi cancelada não é pendência.
    const old = addRun(p.id, { at: at(2026, 10, 6), status: 'cancelled' });
    addStep(old, 'ok', 'Confirmar publicação', 'waiting');
    const from = addRun(other.id, { at: at(2026, 10, 7, 8) });
    db().run("INSERT INTO pipo_inbox (to_pipo_id, from_run_id, payload_path, status, run_after, created_at) VALUES (?, ?, '', 'pending', ?, ?)", p.id, from, at(2026, 10, 7, 14).toISOString(), NOW.toISOString());
    const d = pipoDashboard(p.id, rangeFor('week', NOW), NOW)!;
    expect(d.pending.map((x) => [x.kind, x.runId, x.title])).toEqual([
      ['approval', waiting, 'Confirmar publicação'],
      ['inbox', null, 'Roteirista'],
    ]);
  });

  it('os tokens dos passos agent ficam gravados na execução', async () => {
    openDb(':memory:');
    const p = repo.createPipo({ name: 'Redator', color: 'green', personality: { mission: 'escrever', tone: '', never: [] } });
    const deps: Deps = {
      agent: async (o) => {
        o.onUsage?.({ input: 120, output: 30 });
        return 'ok';
      },
      confirm: async () => 'yes',
      notify: () => undefined,
      gfetch: async () => {
        throw new Error('sem google');
      },
      fetch: (...a) => fetch(...a),
      handoff: async () => 'ok',
      askPipo: async () => 'ajuda',
      update: () => undefined,
    };
    const run = await execute(
      {
        pipo: p,
        version: 1,
        dryRun: false,
        trigger: 'manual',
        playbook: { ...EMPTY_PLAYBOOK, steps: [{ kind: 'agent', key: 'a', title: 'Escrever' }, { kind: 'agent', key: 'b', title: 'Revisar' }].map((s) => ({ ...s, prompt: 'oi' })) as never },
      },
      deps,
    );
    expect(run.status).toBe('done');
    expect([run.tokensIn, run.tokensOut]).toEqual([240, 60]);
    expect(repo.getRun(run.id)).toMatchObject({ tokensIn: 240, tokensOut: 60 });
  });

  it('regras puras: destaque, período anterior, configuração e encaixe dos cartões', () => {
    const m = (key: string, extra: object = {}): { key: string; label: string; from: string } => ({ key, label: key, from: '1', ...extra });
    expect(headlineKey([m('a'), m('b', { stage: 2 }), m('c', { stage: 1 })], null)).toBe('b');
    expect(headlineKey([m('a'), m('b', { stage: 2 }), m('c', { main: true })], null)).toBe('c');
    expect(headlineKey([m('a'), m('b')], 'b')).toBe('b');
    expect(headlineKey([m('a')], 'x')).toBe('a');
    expect(headlineKey([], null)).toBeNull();

    // Mês que já acabou: compara com o mês anterior inteiro. Hoje: com ontem.
    expect(prevRange(rangeFor('month', at(2026, 9, 15)), NOW)).toMatchObject({ from: '2026-08-01', to: '2026-08-31' });
    expect(prevRange(rangeFor('today', NOW), NOW)).toMatchObject({ from: '2026-10-06', to: '2026-10-06' });
    expect(prevRange(rangeFor('month', NOW), NOW)).toMatchObject({ from: '2026-09-01', to: '2026-09-07' });
    expect(prevRange({ kind: 'custom', from: '2026-09-10', to: '2026-09-12' }, NOW)).toMatchObject({ from: '2026-09-07', to: '2026-09-09' });

    expect(normalizePipoConfig(null)).toEqual({ headline: null, order: PIPO_CARDS, hidden: [] });
    expect(packPipoCards(['results', 'overTime', 'compare', 'funnel', 'timeline'])).toEqual([
      { id: 'results', wide: true },
      { id: 'overTime', wide: false },
      { id: 'compare', wide: false },
      { id: 'funnel', wide: true },
      { id: 'timeline', wide: true },
    ]);
  });
});
