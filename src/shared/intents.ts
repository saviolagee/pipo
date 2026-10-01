// Pedidos curtos que o app resolve sozinho, sem passar pelo agente.

const FOCUS_NEXT = /^(?:(?:bora|vamos|pipo|ok|ei)[,!]?\s+)*(?:foca|focar|foco|focando|come[cç]a(?:r)?(?:\s+(?:a|o))?\s+(?:focar|foco)|inicia(?:r)?(?:\s+o)?\s+foco)\s+(?:na|em|n[ao]\s+)?\s*pr[oó]xima(?:\s+tarefa)?\s*[.!]*$/i;

/** "foca na próxima", "começar foco na próxima tarefa", "bora focar na próxima!" */
export function isFocusNextIntent(text: string): boolean {
  return FOCUS_NEXT.test(text.trim());
}
