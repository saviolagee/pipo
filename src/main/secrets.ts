// Segredos (chaves e tokens) criptografados com o safeStorage do Electron (Keychain / DPAPI / libsecret).
import { safeStorage } from 'electron';
import { getKV, setKV } from './db/repos/settings';

export const VAULT_UNAVAILABLE = 'O cofre do sistema (Keychain no macOS, DPAPI no Windows, chaveiro no Linux) não está disponível; não dá para guardar a chave com segurança.';

/** O cofre do sistema está disponível? No Linux, depende de um chaveiro (GNOME Keyring/KWallet) ativo. */
export function vaultAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function encrypt(plain: string): string {
  if (!vaultAvailable()) throw new Error(VAULT_UNAVAILABLE);
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
