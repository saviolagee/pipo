import { describe, expect, it } from 'vitest';
import { parseCapture } from '../src/shared/parse-capture';
import type { Client } from '../src/shared/types';

// Quinta-feira, 1º de outubro de 2026, 15:00 (horário local).
const NOW = new Date(2026, 9, 1, 15, 0, 0);
const clients: Client[] = [{ id: 7, name: 'Pró-Saúde', keywords: ['pro-saude', 'prosaude', 'clinica'], color: '#fff', archived: false }];

const local = (iso: string | null): string => {
  if (!iso) return 'null';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

describe('parseCapture', () => {
  it('extrai dia da semana, hora, cliente e estimativa', () => {
    const r = parseCapture('ligar pro Leo sexta 10h #prosaude ~15min', clients, NOW);
    expect(r.title).toBe('Ligar pro Leo');
    expect(local(r.dueAt)).toBe('2026-10-02 10:00');
    expect(r.clientId).toBe(7);
    expect(r.estimateMin).toBe(15);
  });

  it('entende "sexta de manhã"', () => {
    const r = parseCapture('mandar proposta pro Leo sexta de manhã', clients, NOW);
    expect(r.title).toBe('Mandar proposta pro Leo');
    expect(local(r.dueAt)).toBe('2026-10-02 09:00');
  });

  it('entende amanhã com horário e minutos', () => {
    expect(local(parseCapture('reunião amanhã às 14:30', [], NOW).dueAt)).toBe('2026-10-02 14:30');
    expect(local(parseCapture('call amanhã 9h30', [], NOW).dueAt)).toBe('2026-10-02 09:30');
  });

  it('entende "dia 15", datas com barra e "em N dias"', () => {
    expect(local(parseCapture('pagar boleto dia 15', [], NOW).dueAt)).toBe('2026-10-15 00:00');
    expect(local(parseCapture('pagar aluguel 05/11', [], NOW).dueAt)).toBe('2026-11-05 00:00');
    expect(local(parseCapture('enviar nf em 3 dias', [], NOW).dueAt)).toBe('2026-10-04 00:00');
    expect(local(parseCapture('revisar 10 de dezembro', [], NOW).dueAt)).toBe('2026-12-10 00:00');
  });

  it('só horário que já passou cai para amanhã', () => {
    expect(local(parseCapture('ligar pra mãe 9h', [], NOW).dueAt)).toBe('2026-10-02 09:00');
    expect(local(parseCapture('ligar pra mãe 18h', [], NOW).dueAt)).toBe('2026-10-01 18:00');
  });

  it('semana que vem → próxima segunda; estimativa em horas', () => {
    const r = parseCapture('planejar Q4 semana que vem ~1h30 !!', [], NOW);
    expect(local(r.dueAt)).toBe('2026-10-05 00:00');
    expect(r.estimateMin).toBe(90);
    expect(r.priority).toBe(3);
    expect(r.title).toBe('Planejar Q4');
  });

  it('sem data não inventa prazo', () => {
    const r = parseCapture('comprar café', [], NOW);
    expect(r.dueAt).toBeNull();
    expect(r.title).toBe('Comprar café');
  });
});
