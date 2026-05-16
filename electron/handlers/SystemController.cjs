const { ipcMain, dialog, app, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { exec } = require('child_process');
const log = require('electron-log');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const { setCustomFfmpegPath, getActiveProcesses } = require('../services/ffmpegService.cjs');

function registerSystemHandlers(getData, saveData, mainWindow, taskQueue) {
  ipcMain.handle('open-external', wrapIpcHandler(async (event, url) => {
    if (!url) throw new Error('Missing URL');
    await shell.openExternal(url);
    return true;
  }));

  ipcMain.handle('get-config', wrapIpcHandler(async () => {
    const config = await getData('config.json');
    return config || { 
      baseDir: '', 
      ffmpegPath: '', 
      useNvenc: false, 
      gpuIndex: '0', 
      openRouterKey: '',
      aiModel: 'google/gemini-2.0-flash-lite-preview-02-05:free'
    };
  }));

  ipcMain.handle('save-config', wrapIpcHandler(async (event, newConfig) => {
    if (!newConfig) throw new Error('Invalid config data');
    log.info('Saving system configuration...');
    const currentConfig = await getData('config.json') || {};
    const mergedConfig = { ...currentConfig, ...newConfig };
    await saveData('config.json', mergedConfig);
    if (mergedConfig.ffmpegPath) {
      setCustomFfmpegPath(mergedConfig.ffmpegPath);
    }
    return true;
  }));

  ipcMain.handle('select-folder', wrapIpcHandler(async () => {
    if (!mainWindow) throw new Error('No main window');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    if (result.canceled) throw new Error('Selection canceled');
    return { path: result.filePaths[0] };
  }));

  ipcMain.handle('select-file', wrapIpcHandler(async (event, options) => {
    if (!mainWindow) throw new Error('No main window');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      ...options
    });
    if (result.canceled) throw new Error('Selection canceled');
    return { path: result.filePaths[0] };
  }));

  ipcMain.handle('copy-file', wrapIpcHandler(async (event, { sourcePath, targetDir, fileName }) => {
    if (!sourcePath || !targetDir || !fileName) throw new Error('Missing required parameters');
    log.info(`Copying file: ${sourcePath} -> ${targetDir}/${fileName}`);
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const fullTargetDir = path.isAbsolute(targetDir) ? targetDir : path.join(baseDir, targetDir);
    
    await fs.mkdir(fullTargetDir, { recursive: true });

    // Clean up existing versions of this file type (RAW or SUB) to avoid clutter
    const files = await fs.readdir(fullTargetDir);
    const isRaw = fileName.includes('raw_video');
    const isSub = fileName.includes('subtitles');
    
    // Prefix to search for and delete
    const cleanupPrefix = isRaw ? 'raw_video' : (isSub ? 'subtitles' : null);
    
    if (cleanupPrefix) {
      for (const f of files) {
        if (f.startsWith(cleanupPrefix)) {
          await fs.unlink(path.join(fullTargetDir, f)).catch(() => {});
        }
      }
    }

    let targetFileName = fileName;
    const sourceExt = path.extname(sourcePath).toLowerCase();
    
    // Subtitle conversion/normalization
    if (isSub) {
      if (sourceExt === '.srt' || sourceExt === '.vtt') {
        targetFileName = 'subtitles.ass';
        const targetPath = path.join(fullTargetDir, targetFileName);
        const { convertSrtToAss } = require('../services/subtitleService.cjs');
        await convertSrtToAss(sourcePath, targetPath);
        return { path: targetPath };
      } else if (sourceExt === '.ssa') {
        // SSA is almost identical to ASS, we can treat it as ASS
        targetFileName = 'subtitles.ass';
      }
    }

    const targetPath = path.join(fullTargetDir, targetFileName);
    await fs.copyFile(sourcePath, targetPath);
    
    if (targetPath.toLowerCase().endsWith('.ass')) {
      const { cleanAssFile } = require('../services/subtitleService.cjs');
      await cleanAssFile(targetPath);
    }
    
    return { path: targetPath };
  }));

  ipcMain.handle('save-file-buffer', wrapIpcHandler(async (event, { buffer, targetDir, fileName }) => {
    if (!buffer || !targetDir || !fileName) throw new Error('Missing required parameters');
    
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const fullTargetDir = path.isAbsolute(targetDir) ? targetDir : path.join(baseDir, targetDir);
    
    await fs.mkdir(fullTargetDir, { recursive: true });
    const targetPath = path.join(fullTargetDir, fileName);
    
    await fs.writeFile(targetPath, Buffer.from(buffer));
    
    if (targetPath.toLowerCase().endsWith('.ass')) {
      const { cleanAssFile } = require('../services/subtitleService.cjs');
      await cleanAssFile(targetPath);
    }
    
    return { path: targetPath };
  }));

  ipcMain.handle('create-dir', wrapIpcHandler(async (event, dirPath) => {
    if (!dirPath) throw new Error('Missing directory path');
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const fullDir = path.isAbsolute(dirPath) ? dirPath : path.join(baseDir, dirPath);
    await fs.mkdir(fullDir, { recursive: true });
    return { path: fullDir };
  }));

  ipcMain.handle('get-gpus', wrapIpcHandler(async () => {
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
  }));

  ipcMain.handle('get-debug-stats', wrapIpcHandler(async () => {
    const cpuUsage = process.getCPUUsage().percentCPUUsage;
    const memoryInfo = await process.getProcessMemoryInfo();
    const ffmpegProcesses = getActiveProcesses();
    
    return {
      cpu: cpuUsage,
      ram: memoryInfo.residentSet,
      ffmpeg: ffmpegProcesses
    };
  }));

  ipcMain.handle('get-temp-path', wrapIpcHandler(async () => {
    return app.getPath('temp');
  }));

  ipcMain.handle('select-directory', wrapIpcHandler(async () => {
    if (!mainWindow) throw new Error('No main window');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    if (result.canceled) throw new Error('Selection canceled');
    return result;
  }));

  ipcMain.handle('get-tasks', wrapIpcHandler(async () => taskQueue.getTasksSummary()));
  ipcMain.handle('abort-task', wrapIpcHandler(async (event, taskId) => taskQueue.abort(taskId)));
  ipcMain.handle('clear-task-history', wrapIpcHandler(async () => taskQueue.clearHistory()));
}

module.exports = { registerSystemHandlers };
