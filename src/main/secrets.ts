// Segredos (chaves e tokens) criptografados com o safeStorage do Electron (Keychain / DPAPI / libsecret).
import { safeStorage } from 'electron';
import { getKV, setKV } from './db/repos/settings';

export function encrypt(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Criptografia do sistema indisponível; não dá para guardar o segredo com segurança.');
  return safeStorage.encryptString(plain).toString('base64');
}

export function decrypt(b64: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'));
  } catch {
    return null;
  }
}

export function setSecret(key: string, value: string | null): void {
  setKV(`secret:${key}`, value ? encrypt(value) : null);
}

export function getSecret(key: string): string | null {
  const v = getKV<string | null>(`secret:${key}`, null);
  return v ? decrypt(v) : null;
}
