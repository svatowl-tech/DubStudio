export const ipcRenderer: {
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  on: (channel: string, callback: (...args: any[]) => void) => () => void;
  removeListener: (channel: string, callback: (...args: any[]) => void) => void;
} = {
  invoke: async (channel: string, ...args: any[]) => {
    if (window.electronAPI && window.electronAPI.invoke) {
      return await window.electronAPI.invoke(channel, ...args);
    }
    
    // Browser fallback for AI Studio preview
    console.warn(`IPC channel "${channel}" called in browser environment. Using fallback.`);
    
    const getLocalData = (key: string) => {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    };
    
    const saveLocalData = (key: string, data: any) => {
      localStorage.setItem(key, JSON.stringify(data));
    };

    if (channel === 'get-config') {
      const config = localStorage.getItem('config');
      return config ? JSON.parse(config) : { baseDir: '' };
    }
    if (channel === 'save-config') {
      localStorage.setItem('config', JSON.stringify(args[0]));
      return { success: true };
    }
    
    const entityMatch = channel.match(/^(get|save|delete)-(project|episode|participant)s?$/);
    if (entityMatch) {
      const action = entityMatch[1];
      const entity = entityMatch[2];
      const key = `${entity}s`;
      
      if (action === 'get') {
        if (entity === 'project') {
          // Join logic for projects
          const projects = getLocalData('projects');
          const episodes = getLocalData('episodes');
          const participants = getLocalData('participants');
          
          return projects.map((project: any) => {
            const projectEpisodes = episodes.filter((ep: any) => ep.projectId === project.id).map((ep: any) => {
              const assignments = (ep.assignments || []).map((assignment: any) => {
                const dubber = participants.find((p: any) => p.id === assignment.dubberId);
                return { ...assignment, dubber };
              });
              const uploads = (ep.uploads || []).map((upload: any) => {
                const uploadedBy = participants.find((p: any) => p.id === upload.uploadedById);
                return { ...upload, uploadedBy };
              });
              return { ...ep, assignments, uploads };
            });
            return { ...project, episodes: projectEpisodes };
          });
        }
        return getLocalData(key);
      }
      
      if (action === 'save') {
        const items = getLocalData(key);
        const item = args[0];
        const index = items.findIndex((i: any) => i.id === item.id);
        
        let dataToSave = { ...item };
        if (entity === 'episode') {
          delete dataToSave.project;
          if (dataToSave.assignments) {
            dataToSave.assignments = dataToSave.assignments.map((a: any) => {
              const { dubber, substitute, ...rest } = a;
              return rest;
            });
          }
          if (dataToSave.uploads) {
            dataToSave.uploads = dataToSave.uploads.map((u: any) => {
              const { uploadedBy, ...rest } = u;
              return rest;
            });
          }
        } else if (entity === 'project') {
          delete dataToSave.episodes;
        }

        if (index !== -1) {
          items[index] = dataToSave;
        } else {
          items.push(dataToSave);
        }
        saveLocalData(key, items);
        return { success: true };
      }
      
      if (action === 'delete') {
        const items = getLocalData(key);
        const id = args[0];
        const filtered = items.filter((i: any) => i.id !== id);
        saveLocalData(key, filtered);
        return { success: true };
      }
    }

    if (channel === 'get-gpus') {
      return [{ name: 'Mock GPU 0', index: '0' }];
    }

    if (channel === 'download-file') {
      const { url } = args[0];
      let progress = 0;
      const interval = setInterval(() => {
        progress += 10;
        window.dispatchEvent(new CustomEvent('download-progress', { detail: { url, progress } }));
        if (progress >= 100) clearInterval(interval);
      }, 500);
      return { success: true, data: { path: '/mock/downloaded/file' } };
    }

    if (channel === 'import-participants') {
      saveLocalData('participants', args[0]);
      return { success: true };
    }

    if (channel === 'select-folder') {
      return { success: true, data: { path: '/mock/path' } };
    }
    
    if (channel === 'select-file') {
      return { success: true, data: { path: '/mock/selected/file.mp4' } };
    }
    
    if (channel === 'get-raw-subtitles') {
      return {
        lines: [
          { rawLineIndex: 1, start: '0:00:00.00', end: '0:00:05.00', style: 'Default', name: 'Actor1', text: 'Hello world' },
          { rawLineIndex: 2, start: '0:00:05.00', end: '0:00:10.00', style: 'Default', name: 'Actor2', text: 'Hi there' },
          { rawLineIndex: 3, start: '0:00:10.00', end: '0:00:15.00', style: 'Default', name: 'Actor3', text: 'Testing' },
          { rawLineIndex: 4, start: '0:00:15.00', end: '0:00:20.00', style: 'Default', name: 'Actor4', text: 'More lines' },
          { rawLineIndex: 5, start: '0:00:20.00', end: '0:00:25.00', style: 'Default', name: 'Actor1', text: 'Another one' }
        ],
        actors: ['Actor1', 'Actor2', 'Actor3', 'Actor4'],
        styles: []
      };
    }

    if (channel === 'split-subs-by-dubber') {
      return { success: true, generatedFiles: ['actor1.ass', 'actor2.ass'] };
    }

    if (channel === 'split-subs-by-actor') {
      return { success: true, generatedFiles: ['actor1.ass', 'actor2.ass'] };
    }

    if (channel === 'export-full-ass-with-roles') {
      return { success: true, path: args[0].outputPath };
    }

    if (channel === 'copy-file') {
      const { fileName, targetDir } = args[0];
      return { success: true, data: { path: `${targetDir}/${fileName}` } };
    }

    if (channel === 'save-file-buffer') {
      const { fileName, targetDir } = args[0];
      return { success: true, data: { path: `${targetDir}/${fileName}` } };
    }

    if (channel === 'generate-release-post') {
      return { success: true, postText: 'Сгенерированный алгоритмом текст поста для релиза' };
    }

    return { success: true, mocked: true };
  },
  on: (channel: string, callback: (...args: any[]) => void) => {
    if (window.electronAPI && window.electronAPI.on) {
      return window.electronAPI.on(channel, callback);
    }
    
    const handler = (e: any) => {
      if (channel === 'download-progress' && e.type === 'download-progress') {
        callback(e.detail);
      } else if (channel === 'ffmpeg-progress' && e.type === 'ffmpeg-progress') {
        callback(e.detail);
      }
    };

    window.addEventListener(channel, handler);
    console.warn(`IPC channel "${channel}" listener registered in browser environment. Using fallback.`);
    return () => window.removeEventListener(channel, handler);
  },
  removeListener: (channel: string, callback: (...args: any[]) => void) => {
    // Note: In Electron environment, we should use the cleanup function returned by 'on'.
    // This method is kept for compatibility but might not work as expected for Electron.
    console.warn(`ipcRenderer.removeListener is deprecated. Use the cleanup function returned by ipcRenderer.on instead.`);
    
    const handler = (e: any) => {
      // This is a bit hacky as we don't have the original wrapper
    };
    window.removeEventListener(channel, handler);
  }
};
