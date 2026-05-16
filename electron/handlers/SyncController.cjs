const { ipcMain } = require('electron');
const YandexDiskService = require('../services/YandexDiskService.cjs');
const log = require('electron-log');
const path = require('path');
const fs = require('fs/promises');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');

function registerSyncHandlers(getData, saveData, dataPath) {
  async function getYandexService() {
    const config = await getData('config.json');
    const clientId = config?.yandexClientId || process.env.YANDEX_CLIENT_ID || 'ba2d620516e94f91b713e1afaa74283e';
    const clientSecret = config?.yandexClientSecret || process.env.YANDEX_CLIENT_SECRET || 'd7bf8221a1a74aeea750887581de5ea6';
    
    if (!clientId || !clientSecret) {
      throw new Error('Yandex Client ID or Secret is not configured in settings.');
    }

    return new YandexDiskService(
      clientId,
      clientSecret,
      'https://oauth.yandex.ru/verification_code'
    );
  }

  ipcMain.handle('yandex-get-auth-url', wrapIpcHandler(async () => {
    const yandexService = await getYandexService();
    return await yandexService.getAuthUrl();
  }));

  ipcMain.handle('yandex-exchange-token', wrapIpcHandler(async (event, { code }) => {
    const yandexService = await getYandexService();
    const tokenData = await yandexService.exchangeCodeForToken(code);
    const config = await getData('config.json') || {};
    await saveData('config.json', { ...config, yandexToken: tokenData.access_token, syncEnabled: true });
    return true;
  }));

  ipcMain.handle('yandex-disconnect', wrapIpcHandler(async () => {
    const config = await getData('config.json') || {};
    const { yandexToken, syncEnabled, ...rest } = config;
    await saveData('config.json', rest);
    return true;
  }));

  ipcMain.handle('cloud-sync-status', wrapIpcHandler(async () => {
    const config = await getData('config.json');
    return {
      connected: !!config?.yandexToken,
      enabled: !!config?.syncEnabled,
    };
  }));

  async function syncDir(yandexService, token, localDir, remoteDir, mode = 'push') {
    await yandexService.ensureFolder(token, remoteDir);
    const items = await fs.readdir(localDir, { withFileTypes: true });

    for (const item of items) {
      const localPath = path.join(localDir, item.name);
      const remotePath = `${remoteDir}/${item.name}`;

      if (item.isDirectory()) {
         await syncDir(yandexService, token, localPath, remotePath, mode);
      } else if (item.isFile()) {
        try {
          if (mode === 'push') {
            await yandexService.uploadFile(token, localPath, remotePath);
          } else {
            await yandexService.downloadFile(token, remotePath, localPath);
          }
        } catch (e) {
          log.error(`Sync error for ${item.name}:`, e.message);
        }
      }
    }
  }

  ipcMain.handle('cloud-push', wrapIpcHandler(async () => {
    const config = await getData('config.json');
    if (!config?.yandexToken) throw new Error('Yandex Disk not connected');

    const yandexService = await getYandexService();
    const results = [];

    // 1. Sync data JSONs
    await yandexService.ensureFolder(config.yandexToken, 'app:/AnimeDubManagerData');
    const jsonFiles = ['participants.json', 'projects.json', 'episodes.json', 'config.json'];
    for (const file of jsonFiles) {
      const localPath = path.join(dataPath, file);
      const remotePath = `app:/AnimeDubManagerData/${file}`;
      try {
        await fs.access(localPath);
        await yandexService.uploadFile(config.yandexToken, localPath, remotePath);
        results.push({ file, status: 'pushed' });
      } catch (e) {
        results.push({ file, status: 'skipped' });
      }
    }

    // 2. Sync projects in baseDir
    if (config.baseDir) {
      try {
        await syncDir(yandexService, config.yandexToken, config.baseDir, 'app:/AnimeDubManagerProjects', 'push');
        results.push({ folder: 'projects', status: 'pushed' });
      } catch (e) {
        log.error('Failed to sync projects:', e);
        results.push({ folder: 'projects', status: 'failed: ' + e.message });
      }
    }

    return results;
  }));

  ipcMain.handle('cloud-pull', wrapIpcHandler(async () => {
    const config = await getData('config.json');
    if (!config?.yandexToken) throw new Error('Yandex Disk not connected');

    const yandexService = await getYandexService();
    const results = [];

    // 1. Pull JSONs
    const jsonFiles = ['participants.json', 'projects.json', 'episodes.json', 'config.json'];
    for (const file of jsonFiles) {
      const localPath = path.join(dataPath, file);
      const remotePath = `app:/AnimeDubManagerData/${file}`;
      try {
        const meta = await yandexService.getFileMeta(config.yandexToken, remotePath);
        if (meta) {
          await yandexService.downloadFile(config.yandexToken, remotePath, localPath);
          results.push({ file, status: 'pulled' });
        }
      } catch (e) {
        results.push({ file, status: 'error: ' + e.message });
      }
    }

    // 2. Pull Projects
    // Note: Recursive pull is harder because we don't have a local list to compare with.
    // We should probably list remote resources.
    if (config.baseDir) {
      try {
        await fs.mkdir(config.baseDir, { recursive: true });
        
        async function pullDirRecursive(remotePath, localPath) {
          const meta = await yandexService.getFileMeta(config.yandexToken, remotePath);
          if (!meta || !meta._embedded || !meta._embedded.items) return;

          for (const item of meta._embedded.items) {
            const itemRemotePath = item.path;
            const itemLocalPath = path.join(localPath, item.name);

            if (item.type === 'dir') {
              await fs.mkdir(itemLocalPath, { recursive: true });
              await pullDirRecursive(itemRemotePath, itemLocalPath);
            } else {
              await yandexService.downloadFile(config.yandexToken, itemRemotePath, itemLocalPath);
            }
          }
        }

        await pullDirRecursive('app:/AnimeDubManagerProjects', config.baseDir);
        results.push({ folder: 'projects', status: 'pulled' });
      } catch (e) {
        log.error('Failed to pull projects:', e);
        results.push({ folder: 'projects', status: 'failed: ' + e.message });
      }
    }

    return results;
  }));

  // New Handlers for Extended Yandex Disk API
  ipcMain.handle('yandex-get-disk-info', wrapIpcHandler(async () => {
    const config = await getData('config.json');
    if (!config?.yandexToken) throw new Error('Yandex Disk not connected');
    const yandexService = await getYandexService();
    return await yandexService.getDiskInfo(config.yandexToken);
  }));

  ipcMain.handle('yandex-get-flat-files', wrapIpcHandler(async (event, { limit, offset, media_type }) => {
    const config = await getData('config.json');
    if (!config?.yandexToken) throw new Error('Yandex Disk not connected');
    const yandexService = await getYandexService();
    return await yandexService.getFlatFilesList(config.yandexToken, limit, offset, media_type);
  }));

  ipcMain.handle('yandex-copy-resource', wrapIpcHandler(async (event, { from, toPath, overwrite }) => {
    const config = await getData('config.json');
    if (!config?.yandexToken) throw new Error('Yandex Disk not connected');
    const yandexService = await getYandexService();
    return await yandexService.copyResource(config.yandexToken, from, toPath, overwrite);
  }));

  ipcMain.handle('yandex-move-resource', wrapIpcHandler(async (event, { from, toPath, overwrite }) => {
    const config = await getData('config.json');
    if (!config?.yandexToken) throw new Error('Yandex Disk not connected');
    const yandexService = await getYandexService();
    return await yandexService.moveResource(config.yandexToken, from, toPath, overwrite);
  }));

  ipcMain.handle('yandex-delete-resource', wrapIpcHandler(async (event, { remotePath, permanently }) => {
    const config = await getData('config.json');
    if (!config?.yandexToken) throw new Error('Yandex Disk not connected');
    const yandexService = await getYandexService();
    return await yandexService.deleteResource(config.yandexToken, remotePath, permanently);
  }));

  ipcMain.handle('yandex-create-folder', wrapIpcHandler(async (event, { remotePath }) => {
    const config = await getData('config.json');
    if (!config?.yandexToken) throw new Error('Yandex Disk not connected');
    const yandexService = await getYandexService();
    return await yandexService.createFolder(config.yandexToken, remotePath);
  }));

  ipcMain.handle('yandex-publish-resource', wrapIpcHandler(async (event, { remotePath }) => {
    const config = await getData('config.json');
    if (!config?.yandexToken) throw new Error('Yandex Disk not connected');
    const yandexService = await getYandexService();
    return await yandexService.publishResource(config.yandexToken, remotePath);
  }));

  ipcMain.handle('yandex-unpublish-resource', wrapIpcHandler(async (event, { remotePath }) => {
    const config = await getData('config.json');
    if (!config?.yandexToken) throw new Error('Yandex Disk not connected');
    const yandexService = await getYandexService();
    return await yandexService.unpublishResource(config.yandexToken, remotePath);
  }));

  ipcMain.handle('yandex-get-public-meta', wrapIpcHandler(async (event, { publicKey, relativePath }) => {
    const yandexService = await getYandexService();
    return await yandexService.getPublicResourceMeta(publicKey, relativePath);
  }));

  ipcMain.handle('yandex-download-public-resource', wrapIpcHandler(async (event, { publicKey, relativePath, fileName }) => {
    const targetLocalPath = path.join(dataPath, fileName || 'download');
    const yandexService = await getYandexService();
    await yandexService.downloadPublicResource(publicKey, relativePath, targetLocalPath);
    return targetLocalPath;
  }));

  ipcMain.handle('yandex-save-public-resource', wrapIpcHandler(async (event, { publicKey, relativePath, saveName }) => {
    const config = await getData('config.json');
    if (!config?.yandexToken) throw new Error('Yandex Disk not connected');
    const yandexService = await getYandexService();
    return await yandexService.savePublicResourceToDisk(config.yandexToken, publicKey, relativePath, saveName);
  }));
}

module.exports = { registerSyncHandlers };
