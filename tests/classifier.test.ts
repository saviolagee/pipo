import { describe, expect, it } from 'vitest';
import { classify, isIgnored } from '../src/main/activity/classifier';
import type { Client } from '../src/shared/types';

const clients: Client[] = [
  { id: 1, name: 'Pró-Saúde', keywords: ['pro-saude', 'prosaude', 'clinica'], color: '#000', archived: false },
  { id: 2, name: 'Acme', keywords: ['acme'], color: '#000', archived: false },
];
const opts = { distractions: ['YouTube', 'Instagram', 'WhatsApp Web', 'X', 'TikTok', 'Netflix', 'Notícias', 'reddit.com'], allowed: [], clients };

describe('classify', () => {
  it('detecta distração pelo título da aba', () => {
    expect(classify(opts, 'Google Chrome', 'Lofi beats - YouTube', null).category).toBe('distraction');
    expect(classify(opts, 'Firefox', 'Elon Musk on X: "..." / X', null).category).toBe('distraction');
    expect(classify(opts, 'Safari', 'Página inicial', 'https://www.reddit.com/r/brasil').category).toBe('distraction');
  });

  it('detecta distração pela URL', () => {
    expect(classify(opts, 'Safari', 'Feed', 'https://www.instagram.com/').category).toBe('distraction');
  });

  it('respeita "Sempre permitir"', () => {
    expect(classify({ ...opts, allowed: ['YouTube'] }, 'Chrome', 'Aula - YouTube', null).category).toBe('work');
  });

  it('atribui ao cliente por palavra-chave no título ou no nome do arquivo', () => {
    const r = classify(opts, 'Code', 'proposta-prosaude.md — Visual Studio Code', null);
    expect(r.category).toBe('client');
    expect(r.clientId).toBe(1);
    expect(classify(opts, 'Excel', 'Orçamento Clínica Pró-Saúde.xlsx', null).clientId).toBe(1);
    expect(classify(opts, 'Figma', 'ACME – Landing', null).clientId).toBe(2);
  });

  it('reconhece reuniões', () => {
    expect(classify(opts, 'zoom.us', 'Zoom Meeting', null).category).toBe('meeting');
    expect(classify(opts, 'Google Chrome', 'Meet - abc-defg-hij', null).category).toBe('meeting');
    expect(classify(opts, 'Microsoft Teams', 'Daily | Microsoft Teams', null).category).toBe('meeting');
  });

  it('o resto é trabalho', () => {
    expect(classify(opts, 'Code', 'index.ts — pipo', null).category).toBe('work');
    expect(classify(opts, 'Xcode', 'Pipo.xcodeproj', null).category).toBe('work');
  });

  it('apps ignorados', () => {
    expect(isIgnored(['1Password', 'Bitwarden'], '1Password 8')).toBe(true);
    expect(isIgnored(['1Password'], 'Chrome')).toBe(false);
  });
});
