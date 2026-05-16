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
const { bakeSubtitles, transcodeToMp4, muxRelease, takeScreenshot, getVideoMetadata, extractSubtitleTrack, setCustomFfmpegPath, getActiveProcesses, killAllProcesses } = require('./services/ffmpegService.cjs');
const { getRawSubtitles, saveRawSubtitles, saveTranslatedSubtitles, splitSubsByActor, splitSubsByDubber, exportFullAssWithRoles, extractSignsAss, cleanAssFile } = require('./services/subtitleService.cjs');
const { translateText } = require('./services/translateService.cjs');
const { searchAnime, getAnimeDetails, getAnimeCharacters, getNextEpisodeDate } = require('./services/animeApiService.cjs');
const AISubtitleProcessor = require('./services/AISubtitleProcessor.cjs');

const { registerEpisodeHandlers } = require('./handlers/episodeHandlers.cjs');
const { registerProjectHandlers } = require('./handlers/ProjectController.cjs');
const { registerMediaHandlers } = require('./handlers/MediaController.cjs');
const { registerExportHandlers } = require('./handlers/ExportController.cjs');
const { registerSubtitleHandlers } = require('./handlers/SubtitleController.cjs');
const { registerSystemHandlers } = require('./handlers/SystemController.cjs');
const { registerApiHandlers } = require('./handlers/ApiController.cjs');
const { registerSyncHandlers } = require('./handlers/SyncController.cjs');


let mainWindow = null;
let debugWindow = null;
let isQuitting = false;

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  log.info('Application quitting, aborting all tasks...');
  if (taskQueue) {
    taskQueue.abortAll();
  }
  killAllProcesses();
  
  // Try to forcefully exit to ensure no background processes block
  setTimeout(() => process.exit(0), 1000);
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
    if (!isQuitting) {
      e.preventDefault();
      debugWindow.hide();
    }
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

  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
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

  // Register all IPC handlers
  registerProjectHandlers(getData, saveData, mainWindow);
  registerEpisodeHandlers(getData, saveData);
  registerMediaHandlers(getData, mainWindow, taskQueue);
  registerExportHandlers(getData, mainWindow, taskQueue);
  registerSubtitleHandlers(getData, saveData);
  registerSystemHandlers(getData, saveData, mainWindow, taskQueue);
  registerApiHandlers(getData);
  registerSyncHandlers(getData, saveData, app.getPath('userData'));

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
