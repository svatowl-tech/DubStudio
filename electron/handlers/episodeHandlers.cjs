const { ipcMain } = require('electron');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');

function registerEpisodeHandlers(getData, saveData) {
  ipcMain.handle('save-episode', wrapIpcHandler(async (event, item) => {
    if (!item || !item.id) throw new Error('Invalid episode data');
    
    const items = await getData('episodes.json');
    const index = items.findIndex((i) => i.id === item.id);
    
    const { project, ...dataToSave } = item;
    if (dataToSave.assignments) {
      dataToSave.assignments = dataToSave.assignments.map(a => {
        const { dubber, substitute, ...rest } = a;
        return rest;
      });
    }
    if (dataToSave.uploads) {
      dataToSave.uploads = dataToSave.uploads.map(u => {
        const { uploadedBy, ...rest } = u;
        return rest;
      });
    }

    if (index !== -1) {
      items[index] = dataToSave;
    } else {
      items.push(dataToSave);
    }
    await saveData('episodes.json', items);
    return true;
  }));
  
  ipcMain.handle('delete-episode', wrapIpcHandler(async (event, id) => {
    if (!id) throw new Error('Invalid episode ID');
    const items = await getData('episodes.json');
    const filtered = items.filter((i) => i.id !== id);
    await saveData('episodes.json', filtered);
    return true;
  }));
}

module.exports = { registerEpisodeHandlers };
