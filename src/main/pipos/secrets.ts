// Cofre de segredos por Pipo (APIFY_TOKEN, RESEND_API_KEY…): criptografados com o safeStorage, nunca no
// prompt nem nos logs. Só os nomes são listáveis.
import { getKV, setKV } from '../db/repos/settings';
import { getSecret, setSecret } from '../secrets';

const NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
const indexKey = (slug: string): string => `pipo-secrets:${slug}`;

export function validSecretName(name: string): boolean {
  return NAME.test(name);
}

export function secretNames(slug: string): string[] {
  return getKV<string[]>(indexKey(slug), []);
}

export function setPipoSecret(slug: string, name: string, value: string | null): void {
  if (!validSecretName(name)) throw new Error('Nome de segredo inválido: use MAIÚSCULAS, números e _ (ex.: APIFY_TOKEN).');
  setSecret(`pipo:${slug}:${name}`, value);
  const names = new Set(secretNames(slug));
  if (value) names.add(name);
  else names.delete(name);
  setKV(indexKey(slug), [...names].sort());
}

export function getPipoSecret(slug: string, name: string): string | null {
  return getSecret(`pipo:${slug}:${name}`);
}

/** Todos os segredos do Pipo (só para injetar no ambiente de um passo). */
export function pipoSecrets(slug: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of secretNames(slug)) {
    const v = getPipoSecret(slug, n);
    if (v) out[n] = v;
  }
  return out;
}

export function deletePipoSecrets(slug: string): void {
  for (const n of secretNames(slug)) setSecret(`pipo:${slug}:${n}`, null);
  setKV(indexKey(slug), []);
}

/** Move os segredos quando o @nome de um Pipo em rascunho muda. */
export function moveSecrets(from: string, to: string): void {
  for (const n of secretNames(from)) {
    const v = getPipoSecret(from, n);
    if (v) setPipoSecret(to, n, v);
  }
  deletePipoSecrets(from);
}

/** Troca qualquer valor de segredo por •••• (stdout, erros, prévias). */
export function maskSecrets(text: string, secrets: Record<string, string>): string {
  let out = text;
  for (const v of Object.values(secrets)) {
    if (v && v.length >= 4) out = out.split(v).join('••••');
  }
  return out;
}
