import { ipcRenderer } from './ipc';

export const ipcSafe = {
  invoke: async (channel: string, ...args: any[]) => {
    try {
      return await ipcRenderer.invoke(channel, ...args);
    } catch (error) {
      console.error(`IPC Error on channel "${channel}":`, error);
      // In a real app, we'd use a toast library here.
      // For now, we'll just throw the error to be handled by the caller.
      throw error;
    }
  },
  send: (channel: string, ...args: any[]) => {
    try {
      ipcRenderer.send(channel, ...args);
    } catch (error) {
      console.error(`IPC Send Error on channel "${channel}":`, error);
    }
  },
  on: ipcRenderer.on,
  removeListener: ipcRenderer.removeListener
};
