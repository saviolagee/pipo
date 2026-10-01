import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, clipboard: {}, session: {}, systemPreferences: {} }));
const { looksLikeDeadline } = await import('../src/main/capture');

describe('looksLikeDeadline', () => {
  it('reconhece textos com prazo ou data', () => {
    expect(looksLikeDeadline('Oi! Consegue me mandar o orçamento até sexta?')).toBe(true);
    expect(looksLikeDeadline('O prazo de entrega é dia 15')).toBe(true);
    expect(looksLikeDeadline('Reunião amanhã às 14:30 com o time')).toBe(true);
  });
  it('ignora textos comuns e links', () => {
    expect(looksLikeDeadline('const x = 10;')).toBe(false);
    expect(looksLikeDeadline('https://exemplo.com/pagina')).toBe(false);
    expect(looksLikeDeadline('ok')).toBe(false);
  });
});
