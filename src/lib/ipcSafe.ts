import { ipcRenderer } from './ipc';

export const isWeb = typeof window !== 'undefined' && !(window as any).electronAPI;

// Debounce background sync
let syncTimeout: any = null;

export const ipcSafe = {
  invoke: async (channel: string, ...args: any[]) => {
    try {
      const response = await ipcRenderer.invoke(channel, ...args);
      
      // Auto-sync in background when saving data
      if (channel.startsWith('save-') || channel.startsWith('delete-')) {
        if (syncTimeout) clearTimeout(syncTimeout);
        syncTimeout = setTimeout(() => {
           ipcRenderer.invoke('cloud-sync-status').then((status: any) => {
             if (status?.connected && status?.enabled) {
               console.log('Background auto-sync triggered by save operation');
               ipcRenderer.invoke('cloud-push').catch(console.error);
             }
           }).catch(console.error);
        }, 5000); // 5 sec debounce
      }

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
