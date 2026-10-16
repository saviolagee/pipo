// Pedidos curtos que o app resolve sozinho, sem passar pelo agente.

const FOCUS_NEXT = /^(?:(?:bora|vamos|pipo|ok|ei)[,!]?\s+)*(?:foca|focar|foco|focando|come[cç]a(?:r)?(?:\s+(?:a|o))?\s+(?:focar|foco)|inicia(?:r)?(?:\s+o)?\s+foco)\s+(?:na|em|n[ao]\s+)?\s*pr[oó]xima(?:\s+tarefa)?\s*[.!]*$/i;

const CREATE_PIPO =
  /^(?:(?:ei|oi|ok|bora|pipo)[,!]?\s+)*(?:(?:eu\s+)?(?:quero|queria|preciso(?:\s+de)?|gostaria\s+de)\s+(?:criar\s+|montar\s+|fazer\s+|contratar\s+|ter\s+)?|(?:cria|crie|criar|monta|monte|faz|fa[cç]a|contrata|contrate)\s+)(?:um|uma|outro)\s+(?:novo\s+)?pipo\b/i;

/** "quero um Pipo que…", "cria um pipo pra…", "preciso de um novo Pipo que…" */
export function isCreatePipoIntent(text: string): boolean {
  return CREATE_PIPO.test(text.trim());
}

/** "foca na próxima", "começar foco na próxima tarefa", "bora focar na próxima!" */
export function isFocusNextIntent(text: string): boolean {
  return FOCUS_NEXT.test(text.trim());
}
