const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const axios = require('axios');
const { exec } = require('child_process');
const { bakeSubtitles, transcodeToMp4, setCustomFfmpegPath } = require('./services/ffmpegService.cjs');
const { getRawSubtitles, saveRawSubtitles, saveTranslatedSubtitles, splitSubsByActor, splitSubsByDubber, exportFullAssWithRoles } = require('./services/subtitleService.cjs');

const { translateText } = require('./services/translateService.cjs');
const { SocialMediaBot } = require('./services/SocialMediaBot.cjs');


let mainWindow = null;

async function getData(filename) {
  const filePath = path.join(app.getPath('userData'), filename);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

async function saveData(filename, data) {
  const filePath = path.join(app.getPath('userData'), filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// Generic IPC handler factory
function createHandlers(entityName, filename) {
  if (entityName !== 'project') {
    ipcMain.handle(`get-${entityName}s`, async () => await getData(filename));
  }
  
  ipcMain.handle(`save-${entityName}`, async (event, item) => {
    const items = await getData(filename);
    const index = items.findIndex((i) => i.id === item.id);
    
    let dataToSave = item;
    if (entityName === 'episode') {
      const { project, ...episodeData } = item;
      if (episodeData.assignments) {
        episodeData.assignments = episodeData.assignments.map(a => {
          const { dubber, substitute, ...rest } = a;
          return rest;
        });
      }
      if (episodeData.uploads) {
        episodeData.uploads = episodeData.uploads.map(u => {
          const { uploadedBy, ...rest } = u;
          return rest;
        });
      }
      dataToSave = episodeData;
    } else if (entityName === 'project') {
      const { episodes, ...projectData } = item;
      dataToSave = projectData;
    }

    if (index !== -1) {
      items[index] = dataToSave;
    } else {
      items.push(dataToSave);
    }
    await saveData(filename, items);
  });
  
  ipcMain.handle(`delete-${entityName}`, async (event, id) => {
    const items = await getData(filename);
    const filtered = items.filter((i) => i.id !== id);
    await saveData(filename, filtered);
  });
}

// Custom get-projects handler to join episodes and participants
ipcMain.handle('get-projects', async () => {
  const projects = await getData('projects.json');
  const episodes = await getData('episodes.json');
  const participants = await getData('participants.json');

  return projects.map(project => {
    const projectEpisodes = episodes.filter(ep => ep.projectId === project.id).map(ep => {
      const assignments = (ep.assignments || []).map(assignment => {
        const dubber = participants.find(p => p.id === assignment.dubberId);
        return { ...assignment, dubber };
      });
      const uploads = (ep.uploads || []).map(upload => {
        const uploadedBy = participants.find(p => p.id === upload.uploadedById);
        return { ...upload, uploadedBy };
      });
      return { ...ep, assignments, uploads };
    });
    return { ...project, episodes: projectEpisodes };
  });
});

// Initialize handlers for all entities
createHandlers('participant', 'participants.json');
createHandlers('project', 'projects.json');
createHandlers('episode', 'episodes.json');

ipcMain.handle('get-config', async () => {
  const config = await getData('config.json');
  return config || { baseDir: '' };
});

ipcMain.handle('save-config', async (event, config) => {
  await saveData('config.json', config);
  if (config.ffmpegPath) {
    setCustomFfmpegPath(config.ffmpegPath);
  }
});

ipcMain.handle('select-folder', async () => {
  if (!mainWindow) return { success: false, error: 'No main window' };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled) {
    return { success: false, error: 'Selection canceled' };
  }
  return { success: true, data: { path: result.filePaths[0] } };
});

ipcMain.handle('select-file', async (event, options) => {
  if (!mainWindow) return { success: false, error: 'No main window' };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    ...options
  });
  if (result.canceled) {
    return { success: false, error: 'Selection canceled' };
  }
  return { success: true, data: { path: result.filePaths[0] } };
});

ipcMain.handle('copy-file', async (event, { sourcePath, targetDir, fileName }) => {
  try {
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const fullTargetDir = path.isAbsolute(targetDir) ? targetDir : path.join(baseDir, targetDir);
    
    await fs.mkdir(fullTargetDir, { recursive: true });
    const targetPath = path.join(fullTargetDir, fileName);
    
    await fs.copyFile(sourcePath, targetPath);
    return { success: true, data: { path: targetPath } };
  } catch (error) {
    console.error('Copy file error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-file-buffer', async (event, { buffer, targetDir, fileName }) => {
  try {
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const fullTargetDir = path.isAbsolute(targetDir) ? targetDir : path.join(baseDir, targetDir);
    
    await fs.mkdir(fullTargetDir, { recursive: true });
    const targetPath = path.join(fullTargetDir, fileName);
    
    await fs.writeFile(targetPath, Buffer.from(buffer));
    return { success: true, data: { path: targetPath } };
  } catch (error) {
    console.error('Save file buffer error:', error);
    return { success: false, error: error.message };
  }
});

// Specific import handler for participants
ipcMain.handle('import-participants', async (event, imported) => {
  await saveData('participants.json', imported);
});

ipcMain.handle('create-dir', async (event, dirPath) => {
  try {
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const fullDir = path.isAbsolute(dirPath) ? dirPath : path.join(baseDir, dirPath);
    await fs.mkdir(fullDir, { recursive: true });
    return { success: true, data: { path: fullDir } };
  } catch (error) {
    console.error('Create dir error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-gpus', async () => {
  return new Promise((resolve) => {
    exec('nvidia-smi --query-gpu=name,index --format=csv,noheader', (error, stdout) => {
      if (error) {
        resolve([{ name: 'Default GPU', index: '0' }]);
        return;
      }
      const gpus = stdout.trim().split('\n').map(line => {
        const [name, index] = line.split(',').map(s => s.trim());
        return { name, index };
      });
      resolve(gpus.length > 0 ? gpus : [{ name: 'Default GPU', index: '0' }]);
    });
  });
});

ipcMain.handle('download-file', async (event, { url, targetDir, fileName }) => {
  try {
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const fullTargetDir = path.join(baseDir, targetDir);
    await fs.mkdir(fullTargetDir, { recursive: true });
    const targetPath = path.join(fullTargetDir, fileName);

    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const totalLength = response.headers['content-length'];
    let downloadedLength = 0;

    const writer = (await import('fs')).createWriteStream(targetPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        downloadedLength += chunk.length;
        if (totalLength && mainWindow) {
          const progress = Math.round((downloadedLength / totalLength) * 100);
          mainWindow.webContents.send('download-progress', { url, progress });
        }
      });

      writer.on('finish', () => resolve({ success: true, data: { path: targetPath } }));
      writer.on('error', (err) => reject(err));
    });
  } catch (error) {
    console.error('Download error:', error);
    return { success: false, error: error.message };
  }
});

// FFmpeg Handlers
ipcMain.handle('bake-subtitles', async (event, { videoPath, finalAssPath, outputPath }) => {
  const config = await getData('config.json');
  const baseDir = config.baseDir || app.getPath('userData');
  
  // Ensure absolute paths
  const absVideoPath = path.isAbsolute(videoPath) ? videoPath : path.join(baseDir, videoPath);
  const absAssPath = path.isAbsolute(finalAssPath) ? finalAssPath : path.join(baseDir, finalAssPath);
  const absOutputPath = path.isAbsolute(outputPath) ? outputPath : path.join(baseDir, outputPath);

  await fs.mkdir(path.dirname(absOutputPath), { recursive: true });

  const options = {
    useNvenc: config.useNvenc,
    gpuIndex: config.gpuIndex
  };

  return await bakeSubtitles(absVideoPath, absAssPath, absOutputPath, (percent) => {
    if (mainWindow) {
      mainWindow.webContents.send('ffmpeg-progress', percent);
    }
  }, options);
});

ipcMain.handle('transcode-video', async (event, { videoPath, outputPath }) => {
  const config = await getData('config.json');
  const options = {
    useNvenc: config.useNvenc,
    gpuIndex: config.gpuIndex
  };
  return await transcodeToMp4(videoPath, outputPath, (percent) => {
    if (mainWindow) {
      mainWindow.webContents.send('ffmpeg-progress', percent);
    }
  }, options);
});

// Subtitle Handlers
ipcMain.handle('get-raw-subtitles', async (event, assFilePath) => {
  return await getRawSubtitles(assFilePath);
});

ipcMain.handle('save-translated-subtitles', async (event, { assFilePath, translatedLines }) => {
  await saveTranslatedSubtitles(assFilePath, translatedLines);
});


ipcMain.handle('split-subs-by-actor', async (event, { assFilePath, outputDirectory, options }) => {
  return await splitSubsByActor(assFilePath, outputDirectory, options);
});

ipcMain.handle('split-subs-by-dubber', async (event, { assFilePath, outputDirectory, assignments }) => {
  const dubbersData = await getData('participants.json');
  return await splitSubsByDubber(assFilePath, outputDirectory, assignments, dubbersData);
});

ipcMain.handle('export-full-ass-with-roles', async (event, { assFilePath, outputPath, assignments }) => {
  const participantsData = await getData('participants.json');
  return await exportFullAssWithRoles(assFilePath, outputPath, assignments, participantsData);
});

// Social Media Bot Handlers
ipcMain.handle('generate-release-post', async (event, { apiKey, data }) => {
  try {
    const config = await getData('config.json');
    const keyToUse = apiKey || config.polzaApiKey || '';
    
    if (!keyToUse) {
      throw new Error('API ключ Polza.ai не настроен');
    }

    const bot = new SocialMediaBot(keyToUse);
    const postText = await bot.generateReleasePost(data);
    return { success: true, postText };
  } catch (error) {
    console.error('Generate post error:', error);
    throw error;
  }
});

// Export Handlers
ipcMain.handle('export-dabber-files', async (event, { episode, targetDir }) => {
  try {
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const exportDir = path.isAbsolute(targetDir) ? targetDir : path.join(baseDir, targetDir);
    
    // 1. Copy lightweight video
    if (episode.rawPath) {
      const videoName = path.basename(episode.rawPath);
      await fs.mkdir(exportDir, { recursive: true });
      await fs.copyFile(episode.rawPath, path.join(exportDir, videoName));
    }

    // 2. Copy general subtitles
    if (episode.subPath) {
      const subName = path.basename(episode.subPath);
      await fs.copyFile(episode.subPath, path.join(exportDir, subName));
    }

    // 3. Generate and copy per-dubber subtitles
    const participantsData = await getData('participants.json');
    await splitSubsByDubber(episode.subPath, exportDir, episode.assignments, participantsData);

    return { success: true };
  } catch (error) {
    console.error('Export dabber files error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('export-sound-engineer-files', async (event, { episode, targetDir }) => {
  try {
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const exportDir = path.isAbsolute(targetDir) ? targetDir : path.join(baseDir, targetDir);
    await fs.mkdir(exportDir, { recursive: true });

    // 1. Bake subtitles into video
    const videoName = path.basename(episode.rawPath);
    const bakedVideoPath = path.join(exportDir, `baked_${videoName}`);
    await bakeSubtitles(episode.rawPath, episode.subPath, bakedVideoPath, () => {}, { useNvenc: config.useNvenc, gpuIndex: config.gpuIndex });

    // 2. Copy dabber audio tracks
    for (const upload of episode.uploads) {
      if (upload.type === 'DUBBER_FILE') {
        const fileName = path.basename(upload.path);
        await fs.copyFile(upload.path, path.join(exportDir, fileName));
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Export sound engineer files error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('generate-post', async (event, data) => {
  const config = await getData('config.json');
  const bot = new SocialMediaBot(config.polzaApiKey);
  return await bot.generateReleasePost(data);
});

ipcMain.handle('translate-text', async (event, { text, sourceLang, destLang }) => {
  return await translateText(text, sourceLang, destLang);
});


function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  const config = await getData('config.json');
  if (config && config.ffmpegPath) {
    setCustomFfmpegPath(config.ffmpegPath);
  }
  
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
