import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false }, powerMonitor: { on: () => undefined }, clipboard: {}, session: {}, systemPreferences: {}, shell: {}, protocol: {}, dialog: {}, ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined } }));
const { looksStuck } = await import('../src/main/insights/context-reactions');

const now = 1_000_000_000;
const samples = (pattern: string[]): Array<{ at: number; cat: string }> => {
  const n = (15 * 60) / 5;
  return Array.from({ length: n }, (_, i) => ({ at: now - (n - 1 - i) * 5000, cat: pattern[Math.floor((i / n) * pattern.length)] }));
};

describe('destravar: detecção de procrastinação', () => {
  it('alternando entre distrações por 15 min = travado', () => {
    expect(looksStuck(samples(['distraction', 'work', 'distraction', 'work', 'distraction', 'distraction']), now)).toBe(true);
  });
  it('trabalhando direto não é travado', () => {
    expect(looksStuck(samples(['work', 'client', 'work']), now)).toBe(false);
  });
  it('uma distração longa sem alternar não dispara', () => {
    expect(looksStuck(samples(['distraction']), now)).toBe(false);
  });
});
