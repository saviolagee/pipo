import type { PipoBridge } from '../shared/ipc-contract';

declare global {
  interface Window {
    pipo: PipoBridge;
  }
}

export {};
