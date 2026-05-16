const { ipcMain, dialog } = require('electron');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');

function registerProjectHandlers(getData, saveData, mainWindow) {
  // Generic CRUD handlers
  const entities = [
    { name: 'participant', filename: 'participants.json' },
    { name: 'project', filename: 'projects.json' }
  ];

  for (const { name, filename } of entities) {
    if (name !== 'project') {
      ipcMain.handle(`get-${name}s`, wrapIpcHandler(async () => {
        return await getData(filename);
      }));
    }

    ipcMain.handle(`save-${name}`, wrapIpcHandler(async (event, item) => {
      if (!item || !item.id) throw new Error(`Invalid ${name} data`);
      
      const items = await getData(filename);
      const index = items.findIndex((i) => i.id === item.id);
      
      let dataToSave = item;
      if (name === 'project') {
        const { episodes, ...projectData } = item;
        dataToSave = projectData;
      }

      if (index !== -1) {
        items[index] = dataToSave;
      } else {
        items.push(dataToSave);
      }
      await saveData(filename, items);
      return items;
    }));

    ipcMain.handle(`delete-${name}`, wrapIpcHandler(async (event, id) => {
      if (!id) throw new Error(`Invalid ${name} ID`);
      const items = await getData(filename);
      const filtered = items.filter((i) => i.id !== id);
      await saveData(filename, filtered);
      return filtered;
    }));
  }

  // Custom get-projects handler
  ipcMain.handle('get-projects', wrapIpcHandler(async () => {
    const projects = await getData('projects.json');
    const episodes = await getData('episodes.json');
    const participants = await getData('participants.json');

    return projects.map(project => {
      const projectEpisodes = episodes.filter(ep => ep.projectId === project.id).map(ep => {
        const assignments = (ep.assignments || []).map(assignment => {
          const dubber = participants.find(p => p.id === assignment.dubberId);
          const substitute = assignment.substituteId ? participants.find(p => p.id === assignment.substituteId) : undefined;
          return { ...assignment, dubber, substitute };
        });
        const uploads = (ep.uploads || []).map(upload => {
          const uploadedBy = participants.find(p => p.id === upload.uploadedById);
          return { ...upload, uploadedBy };
        });
        return { ...ep, assignments, uploads };
      });
      const soundEngineer = project.soundEngineerId ? participants.find(p => p.id === project.soundEngineerId) : undefined;
      const assignedDubbers = (project.assignedDubberIds || []).map(id => participants.find(p => p.id === id)).filter(Boolean);
      return { ...project, episodes: projectEpisodes, soundEngineer, assignedDubbers };
    });
  }));

  // Import participants
  ipcMain.handle('import-participants', wrapIpcHandler(async (event, imported) => {
    if (!Array.isArray(imported)) throw new Error('Invalid participants data');
    await saveData('participants.json', imported);
    return true;
  }));
}

module.exports = { registerProjectHandlers };
