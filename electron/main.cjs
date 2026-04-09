const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { exec } = require('child_process');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const DataManager = require('./lib/DataManager.cjs');
const TaskQueue = require('./lib/TaskQueue.cjs');
const MediaWorker = require('./lib/MediaWorker.cjs');

let dataManager;
let taskQueue;

// Setup electron-log
log.transports.file.resolvePathFn = () => path.join(process.cwd(), 'logs', 'main.log');
log.info('Application starting...');

// Auto-updater logging
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error);
});
process.on('unhandledRejection', (error) => {
  log.error('Unhandled Rejection:', error);
});

ipcMain.on('log-error', (event, error) => {
  log.error('Renderer Error:', error);
});

const { extractHardsub } = require('./services/ocrService.cjs');
const { bakeSubtitles, transcodeToMp4, muxRelease, takeScreenshot, getVideoMetadata, setCustomFfmpegPath, getActiveProcesses } = require('./services/ffmpegService.cjs');
const { getRawSubtitles, saveRawSubtitles, saveTranslatedSubtitles, splitSubsByActor, splitSubsByDubber, exportFullAssWithRoles, extractSignsAss } = require('./services/subtitleService.cjs');
const { translateText } = require('./services/translateService.cjs');
const { searchAnime, getAnimeDetails, getAnimeCharacters, getNextEpisodeDate } = require('./services/animeApiService.cjs');
const AISubtitleProcessor = require('./services/AISubtitleProcessor.cjs');
const { registerEpisodeHandlers } = require('./handlers/episodeHandlers.cjs');
const { registerFfmpegHandlers } = require('./handlers/ffmpegHandlers.cjs');


let mainWindow = null;
let debugWindow = null;

app.on('will-quit', () => {
  log.info('Application quitting, aborting all tasks...');
  if (taskQueue) {
    taskQueue.abortAll();
  }
});

function createDebugWindow() {
  debugWindow = new BrowserWindow({
    width: 600,
    height: 400,
    title: 'Debug Console',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (process.env.NODE_ENV === 'development') {
    debugWindow.loadURL('http://localhost:5173/#/debug');
  } else {
    debugWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'debug' });
  }

  debugWindow.on('close', (e) => {
    e.preventDefault();
    debugWindow.hide();
  });
}

// Auto-updater handlers
autoUpdater.on('checking-for-update', () => {
  log.info('Checking for update...');
});
autoUpdater.on('update-available', (info) => {
  log.info('Update available.');
  if (mainWindow) {
    mainWindow.webContents.send('update-available', info);
  }
});
autoUpdater.on('update-not-available', (info) => {
  log.info('Update not available.');
});
autoUpdater.on('error', (err) => {
  log.error('Error in auto-updater: ' + err);
});
autoUpdater.on('download-progress', (progressObj) => {
  let log_message = "Download speed: " + progressObj.bytesPerSecond;
  log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
  log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
  log.info(log_message);
});
autoUpdater.on('update-downloaded', (info) => {
  log.info('Update downloaded');
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded');
  }
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.handle('get-tasks', () => taskQueue.getTasksSummary());
ipcMain.handle('abort-task', (event, taskId) => taskQueue.abort(taskId));
ipcMain.handle('clear-task-history', () => taskQueue.clearHistory());

ipcMain.handle('enqueue-ffmpeg-task', async (event, { type, payload, metadata }) => {
  let taskFn;
  let args = [];
  
  try {
    switch (type) {
      case 'bake-subtitles': {
        const { videoPath, assPath, outputPath, options } = payload;
        taskFn = (id, v, a, o, opts, onProgress, onCommand) => 
          MediaWorker.execute(bakeSubtitles, [v, a, o, opts], onProgress, onCommand); 
        args = [videoPath, assPath, outputPath, options];
        break;
      }
      case 'transcode-video': {
        const { videoPath, outputPath, options } = payload;
        taskFn = (id, v, o, opts, onProgress, onCommand) => 
          MediaWorker.execute(transcodeToMp4, [v, o, opts], onProgress, onCommand); 
        args = [videoPath, outputPath, options];
        break;
      }
      case 'mux-release': {
        const { episode, targetDir, customAudioPath, customRawPath } = payload;
        const { rawPath, subPath, uploads, number, project } = episode;
        
        const finalRawPath = customRawPath || rawPath;
        if (!finalRawPath) throw new Error('Raw video is missing');
        
        let audioPath = customAudioPath;
        if (!audioPath) {
          const soundEngineerUpload = (uploads || [])
            .filter(u => u.role === 'SOUND_ENGINEER' || u.type === 'SOUND_ENGINEER_FILE')
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
            
          if (!soundEngineerUpload) throw new Error('Sound engineer audio is missing');
          audioPath = soundEngineerUpload.path;
        }
        
        let signsPath = null;
        if (subPath) {
          const tempSignsPath = path.join(path.dirname(subPath), `temp_signs_${Date.now()}.ass`);
          const hasSigns = await extractSignsAss(subPath, tempSignsPath);
          if (hasSigns) {
            signsPath = tempSignsPath;
          }
        }
        
        const title = project?.title || 'Project';
        const typeAndSeason = project?.typeAndSeason || '';
        const fileName = `[${number} серия] ${title} ${typeAndSeason} [Оканэ].mp4`.replace(/\s+/g, ' ');
        const outputPath = path.join(targetDir, fileName);
        
        taskFn = async (id, v, a, s, o, onProgress, onCommand) => {
          try {
            const res = await MediaWorker.execute(muxRelease, [v, a, s, o], onProgress, onCommand);
            if (s) await fs.unlink(s).catch(() => {});
            return res;
          } catch (err) {
            if (s) await fs.unlink(s).catch(() => {});
            throw err;
          }
        };
        args = [finalRawPath, audioPath, signsPath, outputPath];
        break;
      }
      case 'export-dabber-files': {
        const { episode, targetDir, skipConversion } = payload;
        taskFn = async (id, ep, tDir, sConv, onProgress, onCommand) => {
          return await exportDabberFilesInternal(ep, tDir, sConv, onProgress, onCommand);
        };
        args = [episode, targetDir, skipConversion];
        break;
      }
      case 'export-sound-engineer-files': {
        const { episode, targetDir, skipConversion, smartExport } = payload;
        taskFn = async (id, ep, tDir, sConv, sExp, onProgress, onCommand) => {
          return await exportSoundEngineerFilesInternal(ep, tDir, sConv, sExp, onProgress, onCommand);
        };
        args = [episode, targetDir, skipConversion, smartExport];
        break;
      }
      default: throw new Error('Unknown task type');
    }
    
    return taskQueue.enqueue(type, taskFn, args, metadata);
  } catch (error) {
    log.error('Enqueue task error:', error);
    throw error;
  }
});

ipcMain.handle('get-debug-stats', async () => {
  const cpuUsage = process.getCPUUsage().percentCPUUsage;
  const memoryInfo = await process.getProcessMemoryInfo();
  const ffmpegProcesses = getActiveProcesses();
  
  return {
    cpu: cpuUsage,
    ram: memoryInfo.residentSet,
    ffmpeg: ffmpegProcesses
  };
});

async function getData(filename) {
  if (!dataManager) {
    dataManager = new DataManager(app.getPath('userData'));
    await dataManager.init();
  }
  return await dataManager.getData(filename);
}

async function saveData(filename, data) {
  if (!dataManager) {
    dataManager = new DataManager(app.getPath('userData'));
    await dataManager.init();
  }
  await dataManager.saveData(filename, data);
}

// Generic IPC handler factory
function createHandlers(entityName, filename) {
  if (entityName !== 'project') {
    ipcMain.handle(`get-${entityName}s`, async () => await getData(filename));
  }
  
  ipcMain.handle(`save-${entityName}`, async (event, item) => {
    try {
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
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle(`delete-${entityName}`, async (event, id) => {
    try {
      const items = await getData(filename);
      const filtered = items.filter((i) => i.id !== id);
      await saveData(filename, filtered);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

// Custom get-projects handler to join episodes and participants
ipcMain.handle('select-directory', async () => {
  return await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
});

ipcMain.handle('get-temp-path', async () => {
  return app.getPath('temp');
});

ipcMain.handle('get-projects', async () => {
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
});

// Initialize handlers for all entities
createHandlers('participant', 'participants.json');
createHandlers('project', 'projects.json');

registerEpisodeHandlers(getData, saveData);
registerFfmpegHandlers(getData, mainWindow);

ipcMain.handle('get-config', async () => {
  const config = await getData('config.json');
  return config || { baseDir: '', ffmpegPath: '', useNvenc: false, gpuIndex: '0', openRouterKey: '' };
});

ipcMain.handle('save-config', async (event, config) => {
  try {
    await saveData('config.json', config);
    if (config.ffmpegPath) {
      setCustomFfmpegPath(config.ffmpegPath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
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
    log.error('Copy file error:', error);
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
    log.error('Save file buffer error:', error);
    return { success: false, error: error.message };
  }
});

// Specific import handler for participants
ipcMain.handle('import-participants', async (event, imported) => {
  try {
    await saveData('participants.json', imported);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-dir', async (event, dirPath) => {
  try {
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const fullDir = path.isAbsolute(dirPath) ? dirPath : path.join(baseDir, dirPath);
    await fs.mkdir(fullDir, { recursive: true });
    return { success: true, data: { path: fullDir } };
  } catch (error) {
    log.error('Create dir error:', error);
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

// FFmpeg Handlers
// Handlers are registered in registerFfmpegHandlers

// Subtitle Handlers
ipcMain.handle('extract-hardsub', async (event, { videoPath, outputAssPath }) => {
  return await extractHardsub(videoPath, outputAssPath, (percent) => {
    event.sender.send('ffmpeg-progress', percent);
  });
});

ipcMain.handle('get-raw-subtitles', async (event, assFilePath) => {
  return await getRawSubtitles(assFilePath);
});

ipcMain.handle('save-raw-subtitles', async (event, { assFilePath, updates }) => {
  try {
    await saveRawSubtitles(assFilePath, updates);
    return { success: true };
  } catch (error) {
    log.error('Save raw subtitles error:', error);
    return { success: false, error: error.message };
  }
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

// Export Handlers
async function exportDabberFilesInternal(episode, targetDir, skipConversion, onProgress, onCommand) {
  try {
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const exportDir = path.isAbsolute(targetDir) ? targetDir : path.join(baseDir, targetDir);
    
    await fs.mkdir(exportDir, { recursive: true });

    // 1. Process video for dabbers
    if (episode.rawPath) {
      const videoName = path.basename(episode.rawPath);
      
      const progressCb = (percent) => {
        if (onProgress) onProgress(percent);
        if (mainWindow) mainWindow.webContents.send('ffmpeg-progress', percent);
      };

      if (skipConversion) {
        let outVideoPath = path.join(exportDir, videoName);
        if (path.resolve(outVideoPath) !== path.resolve(episode.rawPath)) {
          progressCb(50);
          await fs.copyFile(episode.rawPath, outVideoPath);
          progressCb(100);
        } else {
          progressCb(100);
        }
      } else if (episode.isHardsub) {
        // Just compress
        const ext = path.extname(videoName);
        const nameWithoutExt = path.basename(videoName, ext);
        const finalName = nameWithoutExt.endsWith('_hardsub') ? videoName : `${nameWithoutExt}_hardsub${ext}`;
        let outVideoPath = path.join(exportDir, finalName);
        
        // Prevent overwrite conflict
        if (path.resolve(outVideoPath) === path.resolve(episode.rawPath)) {
          outVideoPath = path.join(exportDir, `${nameWithoutExt}_exported${ext}`);
        }

        await transcodeToMp4(episode.rawPath, outVideoPath, progressCb, onCommand, { 
          useNvenc: config.useNvenc, 
          gpuIndex: config.gpuIndex,
          crf: 28 // Lower quality for dabbers
        });
      } else {
        // Compress and burn full subtitles
        let outVideoPath = path.join(exportDir, videoName);

        // Prevent overwrite conflict
        if (path.resolve(outVideoPath) === path.resolve(episode.rawPath)) {
          const ext = path.extname(videoName);
          const name = path.basename(videoName, ext);
          outVideoPath = path.join(exportDir, `${name}_exported${ext}`);
        }

        if (episode.subPath) {
          await bakeSubtitles(episode.rawPath, episode.subPath, outVideoPath, progressCb, onCommand, { 
            useNvenc: config.useNvenc, 
            gpuIndex: config.gpuIndex,
            crf: 28 // Lower quality for dabbers
          });
        } else {
          // Fallback if no subtitles
          await transcodeToMp4(episode.rawPath, outVideoPath, progressCb, onCommand, { 
            useNvenc: config.useNvenc, 
            gpuIndex: config.gpuIndex,
            crf: 28 // Lower quality for dabbers
          });
        }
      }
    }

    // 2. Copy general subtitles
    if (episode.subPath) {
      const subName = path.basename(episode.subPath);
      await fs.copyFile(episode.subPath, path.join(exportDir, subName));
    }

    // 3. Generate and copy per-dubber subtitles
    if (episode.subPath) {
      const participantsData = await getData('participants.json');
      await splitSubsByDubber(episode.subPath, exportDir, episode.assignments, participantsData);
    }

    return { success: true };
  } catch (error) {
    log.error('Export dabber files error:', error);
    throw error;
  }
}

ipcMain.handle('export-dabber-files', async (event, { episode, targetDir, skipConversion }) => {
  return await exportDabberFilesInternal(episode, targetDir, skipConversion);
});

async function exportSoundEngineerFilesInternal(episode, targetDir, skipConversion, smartExport, onProgress, onCommand) {
  try {
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const exportDir = path.isAbsolute(targetDir) ? targetDir : path.join(baseDir, targetDir);
    await fs.mkdir(exportDir, { recursive: true });

    const progressCb = (percent) => {
      if (onProgress) onProgress(percent);
      if (mainWindow) mainWindow.webContents.send('ffmpeg-progress', percent);
    };

    // 1. Process video
    if (episode.rawPath) {
      const videoName = path.basename(episode.rawPath);
      
      if (skipConversion) {
        let outVideoPath = path.join(exportDir, videoName);
        if (path.resolve(outVideoPath) !== path.resolve(episode.rawPath)) {
          progressCb(50);
          await fs.copyFile(episode.rawPath, outVideoPath);
          progressCb(100);
        } else {
          progressCb(100);
        }
      } else if (episode.isHardsub) {
        // Just copy the hardsub video
        const ext = path.extname(videoName);
        const nameWithoutExt = path.basename(videoName, ext);
        const finalName = nameWithoutExt.endsWith('_hardsub') ? videoName : `${nameWithoutExt}_hardsub${ext}`;
        const markedVideoPath = path.join(exportDir, finalName);
        progressCb(50);
        await fs.copyFile(episode.rawPath, markedVideoPath);
        progressCb(100);
      } else {
        // Burn only signs
        const bakedVideoPath = path.join(exportDir, `baked_${videoName}`);
        
        if (episode.subPath) {
          const signsAssPath = path.join(exportDir, `temp_signs_${Date.now()}.ass`);
          const hasSigns = await extractSignsAss(episode.subPath, signsAssPath);
          
          if (hasSigns) {
            await bakeSubtitles(episode.rawPath, signsAssPath, bakedVideoPath, progressCb, onCommand, { 
              useNvenc: config.useNvenc, 
              gpuIndex: config.gpuIndex,
              crf: 18 // High quality for sound engineer
            });
            await fs.unlink(signsAssPath).catch(() => {}); // Cleanup temp file
          } else {
            // No signs found, just copy the raw video
            progressCb(50);
            await fs.copyFile(episode.rawPath, bakedVideoPath);
            progressCb(100);
          }
        } else {
          // No subtitles at all, just copy
          progressCb(50);
          await fs.copyFile(episode.rawPath, bakedVideoPath);
          progressCb(100);
        }
      }
    }

    // 2. Copy audio tracks with smart logic
    const dubberFiles = {}; // Group by dubberId
    for (const upload of episode.uploads) {
      if (upload.type === 'DUBBER_FILE' || upload.type === 'FIXES') {
        const dubberId = upload.uploadedById;
        if (!dubberFiles[dubberId]) dubberFiles[dubberId] = { original: [], fixes: [] };
        if (upload.type === 'DUBBER_FILE') dubberFiles[dubberId].original.push(upload);
        else dubberFiles[dubberId].fixes.push(upload);
      }
    }

    const projects = await getData('projects.json');
    const project = projects.find(p => p.id === episode.projectId);
    const projectTitle = project ? project.title : 'Unknown';
    const participants = await getData('participants.json');

    const getNick = (id) => {
      const p = participants.find(part => part.id === id);
      return p ? p.nickname : 'Unknown';
    };

    const getExportName = (upload, isFix) => {
      const nick = getNick(upload.uploadedById);
      const ext = path.extname(upload.path);
      const fixSuffix = isFix ? '._Fix' : '.';
      return `${nick}${fixSuffix} ${projectTitle}[${episode.number}]${ext}`;
    };

    for (const dubberId in dubberFiles) {
      const { original, fixes } = dubberFiles[dubberId];
      // Get latest original and latest fix
      const latestOriginal = original.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      const latestFix = fixes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

      if (smartExport && latestOriginal && latestFix) {
        try {
          const origStat = await fs.stat(latestOriginal.path);
          const fixStat = await fs.stat(latestFix.path);

          if (fixStat.size < origStat.size) {
            // Fix is smaller (likely a patch) -> export both
            await fs.copyFile(latestOriginal.path, path.join(exportDir, getExportName(latestOriginal, false)));
            await fs.copyFile(latestFix.path, path.join(exportDir, getExportName(latestFix, true)));
          } else {
            // Fix is larger or equal (likely a full re-record) -> export only fix
            await fs.copyFile(latestFix.path, path.join(exportDir, getExportName(latestFix, true)));
          }
        } catch (e) {
          log.error('Smart export stat error:', e);
          // Fallback: copy both
          await fs.copyFile(latestOriginal.path, path.join(exportDir, getExportName(latestOriginal, false)));
          await fs.copyFile(latestFix.path, path.join(exportDir, getExportName(latestFix, true)));
        }
      } else {
        // No smart logic or missing one of the files -> copy all latest available
        if (latestOriginal) await fs.copyFile(latestOriginal.path, path.join(exportDir, getExportName(latestOriginal, false)));
        if (latestFix) await fs.copyFile(latestFix.path, path.join(exportDir, getExportName(latestFix, true)));
      }
    }

    return { success: true };
  } catch (error) {
    log.error('Export sound engineer files error:', error);
    throw error;
  }
}

ipcMain.handle('export-sound-engineer-files', async (event, { episode, targetDir, skipConversion, smartExport }) => {
  return await exportSoundEngineerFilesInternal(episode, targetDir, skipConversion, smartExport);
});

ipcMain.handle('build-release', async (event, { episode, targetDir, customAudioPath, customRawPath }) => {
  try {
    const { rawPath, subPath, uploads, number, project } = episode;
    
    // Use custom raw path if provided, otherwise fallback to episode's rawPath
    const finalRawPath = customRawPath || rawPath;
    if (!finalRawPath) throw new Error('Raw video is missing');
    
    // Use custom audio path if provided, otherwise find sound engineer's audio in uploads
    let audioPath = customAudioPath;
    if (!audioPath) {
      const soundEngineerUpload = (uploads || [])
        .filter(u => u.role === 'SOUND_ENGINEER' || u.type === 'SOUND_ENGINEER_FILE')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        
      if (!soundEngineerUpload) throw new Error('Sound engineer audio is missing');
      audioPath = soundEngineerUpload.path;
    }
    
    // Extract signs
    let signsPath = null;
    if (subPath) {
      const tempSignsPath = path.join(path.dirname(subPath), `temp_signs_${Date.now()}.ass`);
      const hasSigns = await extractSignsAss(subPath, tempSignsPath);
      if (hasSigns) {
        signsPath = tempSignsPath;
      }
    }
    
    // Format filename: [Номер серии] название тайтла, тип, сезон[Оканэ]
    // Example: [1 серия] Маг воды TV1 [Оканэ]
    const title = project?.title || 'Project';
    const typeAndSeason = project?.typeAndSeason || '';
    
    const fileName = `[${number} серия] ${title} ${typeAndSeason} [Оканэ].mp4`.replace(/\s+/g, ' ');
    const outputPath = path.join(targetDir, fileName);
    
    await muxRelease(finalRawPath, audioPath, signsPath, outputPath, (percent) => {
      event.sender.send('ffmpeg-progress', percent);
    });
    
    // Cleanup temp signs
    if (signsPath) {
      await fs.unlink(signsPath).catch(() => {});
    }
    
    return { success: true, path: outputPath };
  } catch (error) {
    log.error('Build release error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-video-metadata', async (event, videoPath) => {
  try {
    return await getVideoMetadata(videoPath);
  } catch (error) {
    log.error('Get video metadata error:', error);
    return { error: error.message };
  }
});

ipcMain.handle('take-screenshot', async (event, { videoPath, timestamp, outputPath }) => {
  try {
    await takeScreenshot(videoPath, timestamp, outputPath);
    return { success: true, path: outputPath };
  } catch (error) {
    log.error('Take screenshot error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('translate-text', async (event, { text, sourceLang, destLang }) => {
  return await translateText(text, sourceLang, destLang);
});

ipcMain.handle('search-anime', async (event, { query }) => {
  return await searchAnime(query);
});

ipcMain.handle('get-anime-details', async (event, { id, source }) => {
  return await getAnimeDetails(id, source);
});

ipcMain.handle('get-anime-characters', async (event, { id, source }) => {
  return await getAnimeCharacters(id, source);
});

ipcMain.handle('get-next-episode-date', async (event, { title }) => {
  return await getNextEpisodeDate(title);
});

ipcMain.handle('ai-process-subtitles', async (event, { lines, glossary }) => {
  try {
    const config = await getData('config.json');
    const apiKey = config?.openRouterKey;
    
    if (!apiKey) {
      throw new Error('OpenRouter API key is not configured. Please add it in Settings.');
    }

    const processor = new AISubtitleProcessor(apiKey, glossary);
    return await processor.processSubtitles(lines);
  } catch (error) {
    log.error('AI Subtitle Processing error:', error);
    throw error;
  }
});

ipcMain.handle('save-translated-subtitles', async (event, { assFilePath, translatedLines }) => {
  try {
    await saveTranslatedSubtitles(assFilePath, translatedLines);
    return { success: true };
  } catch (error) {
    log.error('Save translated subtitles error:', error);
    return { success: false, error: error.message };
  }
});


function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Anime Dub Manager',
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
  dataManager = new DataManager(app.getPath('userData'));
  await dataManager.init();

  taskQueue = new TaskQueue(2);
  
  taskQueue.on('queue-updated', (summary) => {
    if (mainWindow) mainWindow.webContents.send('task-queue-updated', summary);
  });

  taskQueue.on('task-progress', (data) => {
    if (mainWindow) mainWindow.webContents.send('task-progress', data);
  });

  const config = await getData('config.json');
  if (config && config.ffmpegPath) {
    setCustomFfmpegPath(config.ffmpegPath);
  }
  
  createWindow();
  createDebugWindow();

  // Check for updates
  if (process.env.NODE_ENV !== 'development') {
    autoUpdater.checkForUpdatesAndNotify();
  }

  globalShortcut.register('CommandOrControl+Shift+D', () => {
    if (debugWindow) {
      if (debugWindow.isVisible()) {
        debugWindow.hide();
      } else {
        debugWindow.show();
      }
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
