// Pedidos curtos que o app resolve sozinho, sem passar pelo agente.

const CREATE_PIPO =
  /^(?:(?:ei|oi|ok|bora|pipo)[,!]?\s+)*(?:(?:eu\s+)?(?:quero|queria|preciso(?:\s+de)?|gostaria\s+de)\s+(?:criar\s+|montar\s+|fazer\s+|contratar\s+|ter\s+)?|(?:cria|crie|criar|monta|monte|faz|fa[cç]a|contrata|contrate)\s+)(?:um|uma|outro)\s+(?:novo\s+)?pipo\b/i;

/** "quero um Pipo que…", "cria um pipo pra…", "preciso de um novo Pipo que…" */
export function isCreatePipoIntent(text: string): boolean {
  return CREATE_PIPO.test(text.trim());
}

