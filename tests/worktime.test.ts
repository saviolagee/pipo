import { describe, expect, it } from 'vitest';
import { computeWorkTime } from '../src/main/activity/worktime';

const H = 3_600_000;
const M = 60_000;
const day = { start: 0, end: 24 * H };

describe('computeWorkTime', () => {
  it('não conta duas vezes foco e bloco de trabalho sobrepostos', () => {
    const r = computeWorkTime(day, [{ start: 9 * H, end: 10 * H, category: 'work', idle: false }], [{ start: 9 * H + 30 * M, end: 10 * H + 30 * M }]);
    expect(r.workedMin).toBe(90);
  });

  it('desconta distração e ociosidade', () => {
    const r = computeWorkTime(
      day,
      [
        { start: 9 * H, end: 11 * H, category: 'client', idle: false },
        { start: 9 * H + 10 * M, end: 9 * H + 25 * M, category: 'distraction', idle: false },
        { start: 10 * H, end: 10 * H + 5 * M, category: 'idle', idle: true },
      ],
      [{ start: 9 * H, end: 11 * H }],
    );
    expect(r.workedMin).toBe(100);
    expect(r.distractedMin).toBe(15);
  });

  it('reunião não conta como trabalho produtivo', () => {
    const r = computeWorkTime(day, [{ start: 14 * H, end: 15 * H, category: 'meeting', idle: false }], []);
    expect(r.workedMin).toBe(0);
    expect(r.meetingMin).toBe(60);
  });
});
