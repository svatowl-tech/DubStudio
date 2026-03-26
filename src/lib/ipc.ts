/**
 * Мок-обертка для Electron ipcRenderer.
 * В реальном Electron-приложении здесь будет `const { ipcRenderer } = window.require('electron');`
 * В нашей web-среде мы эмулируем это через HTTP-запросы к нашему Express API.
 */
export const ipcRenderer = {
  invoke: async (channel: string, ...args: any[]) => {
    const response = await fetch('/api/ipc/invoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel, args }),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error);
    }

    return result.data;
  },
};
