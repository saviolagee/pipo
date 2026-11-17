// Equipe: a memória que todos os Pipos compartilham, o chat geral e a loja de Pipos prontos.
import type { PipoAccessory, PipoColor } from './pipos';

/** Um fato sobre o usuário ou o negócio que vale para o Pipo branco e para todos os coloridos. */
export interface TeamFact {
  id: number;
  text: string;
  /** De onde veio: chat, manual, ou o @nome do Pipo que aprendeu. */
  source: string;
  createdAt: string;
}

/** Quem escreveu uma mensagem no chat geral (guardado junto da mensagem: sobrevive se o Pipo for excluído). */
export interface MessageAuthor {
  name: string;
  slug: string;
  color: string;
  accessory: PipoAccessory;
}

export const MAX_FACTS = 80;
export const MAX_FACT_CHARS = 280;

/** "Meu  negócio é X." e "meu negócio é x" são o mesmo fato. */
export function factKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Bloco que entra no prompt de todos os Pipos. Vazio quando não há fatos. */
export function factsBlock(facts: Array<Pick<TeamFact, 'text'>>): string {
  if (!facts.length) return '';
  return `O que a equipe já sabe sobre o usuário e o negócio dele (use sempre que ajudar e não pergunte de novo):\n${facts.map((f) => `- ${f.text}`).join('\n')}`;
}

// ---------- Loja de Pipos ----------

export interface StoreField {
  key: string;
  label: string;
  /** 'secret' vai direto para o cofre e nunca volta para a tela. */
  kind: 'text' | 'textarea' | 'number' | 'secret';
  placeholder?: string;
  help?: string;
  required?: boolean;
  /** Valor inicial sugerido. */
  initial?: string;
}

export interface StoreItem {
  id: string;
  name: string;
  tagline: string;
  /** O que ele faz, em passos curtos. */
  does: string[];
  color: PipoColor;
  accessory: PipoAccessory;
  fields: StoreField[];
  /** @nome do Pipo já instalado a partir deste item, se houver. */
  installed: string | null;
}

/** Configuração de um Pipo da loja: os campos e o que já está preenchido (segredos só dizem se existem). */
export interface StoreConfig {
  itemId: string;
  name: string;
  fields: StoreField[];
  values: Record<string, string>;
  secretsSet: string[];
}
