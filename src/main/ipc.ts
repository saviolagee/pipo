import { ipcMain } from 'electron';
import type { InvokeArgs, InvokeChannel, InvokeResult } from '@shared/ipc-contract';

type Handler<K extends InvokeChannel> = (...args: InvokeArgs<K>) => Awaited<InvokeResult<K>> | Promise<Awaited<InvokeResult<K>>>;

/** Registra um handler tipado para um canal do contrato. */
export function handle<K extends InvokeChannel>(channel: K, fn: Handler<K>): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (_e, ...args: unknown[]) => {
    try {
      return await fn(...(args as InvokeArgs<K>));
    } catch (err) {
      console.error(`[ipc] ${channel} falhou:`, err);
      throw err;
    }
  });
}
