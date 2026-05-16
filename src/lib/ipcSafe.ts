import { ipcRenderer } from './ipc';

export const ipcSafe = {
  invoke: async (channel: string, ...args: any[]) => {
    try {
      const response = await ipcRenderer.invoke(channel, ...args);
      
      // If the response is the new standardized format
      if (response && typeof response === 'object' && 'success' in response) {
        if (!response.success) {
          throw new Error(response.error || 'Unknown IPC Error');
        }
        return response.data;
      }
      
      // Fallback for handlers that haven't been wrapped yet
      return response;
    } catch (error) {
      console.error(`IPC Error on channel "${channel}":`, error);
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
