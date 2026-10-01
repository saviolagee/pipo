// Campos seguros abertos no notch: id do card → Pipo e nome do segredo.
const open = new Map<string, { pipoId: number; name: string }>();

export function trackSecretCard(cardId: string, pipoId: number, name: string): void {
  open.set(cardId, { pipoId, name });
}

export function takeSecretCard(cardId: string): { pipoId: number; name: string } | null {
  const s = open.get(cardId) ?? null;
  open.delete(cardId);
  return s;
}

export function forgetSecretCard(cardId: string): void {
  open.delete(cardId);
}
