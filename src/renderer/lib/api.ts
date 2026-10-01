import type { PipoBridge } from '@shared/ipc-contract';

/** Ponte tipada exposta pelo preload. */
export const api: PipoBridge = window.pipo;

export { fmtDue, fmtHM, fmtTime, fmtTimer } from '@shared/format';
