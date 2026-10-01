import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { MainEventName, MainEvents, PipoBridge } from '@shared/ipc-contract';

const bridge: PipoBridge = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on<K extends MainEventName>(event: K, cb: (payload: MainEvents[K]) => void) {
    const listener = (_e: IpcRendererEvent, payload: MainEvents[K]): void => cb(payload);
    ipcRenderer.on(event, listener);
    return () => {
      ipcRenderer.removeListener(event, listener);
    };
  },
  send: (event, payload) => ipcRenderer.send(event, payload),
  pathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('pipo', bridge);
