const { ipcMain } = require('electron');

function registerEpisodeHandlers(getData, saveData) {
  ipcMain.handle('save-episode', async (event, item) => {
    try {
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
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('delete-episode', async (event, id) => {
    try {
      const items = await getData('episodes.json');
      const filtered = items.filter((i) => i.id !== id);
      await saveData('episodes.json', filtered);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerEpisodeHandlers };
