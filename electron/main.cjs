const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const axios = require('axios');
const { exec } = require('child_process');
const { bakeSubtitles, transcodeToMp4, muxRelease, takeScreenshot, getVideoMetadata, setCustomFfmpegPath } = require('./services/ffmpegService.cjs');
const { getRawSubtitles, saveRawSubtitles, saveTranslatedSubtitles, splitSubsByActor, splitSubsByDubber, exportFullAssWithRoles, extractSignsAss } = require('./services/subtitleService.cjs');

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
createHandlers('episode', 'episodes.json');

ipcMain.handle('get-config', async () => {
  const config = await getData('config.json');
  return config || { baseDir: '', ffmpegPath: '', useNvenc: false, gpuIndex: '0', openRouterKey: '' };
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
ipcMain.handle('export-dabber-files', async (event, { episode, targetDir, skipConversion }) => {
  try {
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const exportDir = path.isAbsolute(targetDir) ? targetDir : path.join(baseDir, targetDir);
    
    await fs.mkdir(exportDir, { recursive: true });

    // 1. Process video for dubbers
    if (episode.rawPath) {
      const videoName = path.basename(episode.rawPath);
      
      const onProgress = (percent) => {
        if (mainWindow) mainWindow.webContents.send('ffmpeg-progress', percent);
      };

      if (skipConversion) {
        let outVideoPath = path.join(exportDir, videoName);
        if (path.resolve(outVideoPath) !== path.resolve(episode.rawPath)) {
          onProgress(50);
          await fs.copyFile(episode.rawPath, outVideoPath);
          onProgress(100);
        } else {
          onProgress(100);
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

        await transcodeToMp4(episode.rawPath, outVideoPath, onProgress, { 
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
          await bakeSubtitles(episode.rawPath, episode.subPath, outVideoPath, onProgress, { 
            useNvenc: config.useNvenc, 
            gpuIndex: config.gpuIndex,
            crf: 28 // Lower quality for dabbers
          });
        } else {
          // Fallback if no subtitles
          await transcodeToMp4(episode.rawPath, outVideoPath, onProgress, { 
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
    console.error('Export dabber files error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('export-sound-engineer-files', async (event, { episode, targetDir, skipConversion, smartExport }) => {
  try {
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const exportDir = path.isAbsolute(targetDir) ? targetDir : path.join(baseDir, targetDir);
    await fs.mkdir(exportDir, { recursive: true });

    const onProgress = (percent) => {
      if (mainWindow) mainWindow.webContents.send('ffmpeg-progress', percent);
    };

    // 1. Process video
    if (episode.rawPath) {
      const videoName = path.basename(episode.rawPath);
      
      if (skipConversion) {
        let outVideoPath = path.join(exportDir, videoName);
        if (path.resolve(outVideoPath) !== path.resolve(episode.rawPath)) {
          onProgress(50);
          await fs.copyFile(episode.rawPath, outVideoPath);
          onProgress(100);
        } else {
          onProgress(100);
        }
      } else if (episode.isHardsub) {
        // Just copy the hardsub video
        const ext = path.extname(videoName);
        const nameWithoutExt = path.basename(videoName, ext);
        const finalName = nameWithoutExt.endsWith('_hardsub') ? videoName : `${nameWithoutExt}_hardsub${ext}`;
        const markedVideoPath = path.join(exportDir, finalName);
        onProgress(50);
        await fs.copyFile(episode.rawPath, markedVideoPath);
        onProgress(100);
      } else {
        // Burn only signs
        const bakedVideoPath = path.join(exportDir, `baked_${videoName}`);
        
        if (episode.subPath) {
          const signsAssPath = path.join(exportDir, `temp_signs_${Date.now()}.ass`);
          const hasSigns = await extractSignsAss(episode.subPath, signsAssPath);
          
          if (hasSigns) {
            await bakeSubtitles(episode.rawPath, signsAssPath, bakedVideoPath, onProgress, { 
              useNvenc: config.useNvenc, 
              gpuIndex: config.gpuIndex,
              crf: 18 // High quality for sound engineer
            });
            await fs.unlink(signsAssPath).catch(() => {}); // Cleanup temp file
          } else {
            // No signs found, just copy the raw video
            onProgress(50);
            await fs.copyFile(episode.rawPath, bakedVideoPath);
            onProgress(100);
          }
        } else {
          // No subtitles at all, just copy
          onProgress(50);
          await fs.copyFile(episode.rawPath, bakedVideoPath);
          onProgress(100);
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
          console.error('Smart export stat error:', e);
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
    console.error('Export sound engineer files error:', error);
    return { success: false, error: error.message };
  }
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
    console.error('Build release error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-video-metadata', async (event, videoPath) => {
  try {
    return await getVideoMetadata(videoPath);
  } catch (error) {
    console.error('Get video metadata error:', error);
    return { error: error.message };
  }
});

ipcMain.handle('take-screenshot', async (event, { videoPath, timestamp, outputPath }) => {
  try {
    await takeScreenshot(videoPath, timestamp, outputPath);
    return { success: true, path: outputPath };
  } catch (error) {
    console.error('Take screenshot error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('generate-post', async (event, data) => {
  const bot = new SocialMediaBot();
  return await bot.generateReleasePost(data);
});

ipcMain.handle('translate-text', async (event, { text, sourceLang, destLang }) => {
  return await translateText(text, sourceLang, destLang);
});

ipcMain.handle('save-translated-subtitles', async (event, { assFilePath, translatedLines }) => {
  try {
    await saveTranslatedSubtitles(assFilePath, translatedLines);
    return { success: true };
  } catch (error) {
    console.error('Save translated subtitles error:', error);
    return { success: false, error: error.message };
  }
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
