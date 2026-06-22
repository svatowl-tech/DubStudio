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

  ipcMain.handle('open-path', wrapIpcHandler(async (event, filePath) => {
    if (!filePath) throw new Error('Missing path');
    const config = (await getData('config.json')) || {};
    const baseDir = config.baseDir || app.getPath('userData');
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);
    await shell.openPath(fullPath);
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
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.focus();
    }
    if (result.canceled) throw new Error('Selection canceled');
    return { path: result.filePaths[0] };
  }));

  ipcMain.handle('select-file', wrapIpcHandler(async (event, options) => {
    if (!mainWindow) throw new Error('No main window');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      ...options
    });
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.focus();
    }
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
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.focus();
    }
    if (result.canceled) throw new Error('Selection canceled');
    return result;
  }));

  ipcMain.handle('get-tasks', wrapIpcHandler(async () => taskQueue.getTasksSummary()));
  ipcMain.handle('abort-task', wrapIpcHandler(async (event, taskId) => taskQueue.abort(taskId)));
  ipcMain.handle('clear-task-history', wrapIpcHandler(async () => taskQueue.clearHistory()));

  // Search Nyaa Torrents
  ipcMain.handle('search-nyaa-torrents', wrapIpcHandler(async (event, { query, category = 'anime', subCategory = 'raw', sort = 'seeders', order = 'desc' }) => {
    if (!query) throw new Error('Query is required');
    log.info(`Searching Nyaa & others for: "${query}", category: "${category}", subCategory: "${subCategory}", sort: "${sort}", order: "${order}"`);
    
    let results = [];
    
    // 1. Search Nyaa
    try {
      const url = new URL('https://nyaaapi.onrender.com/nyaa');
      url.searchParams.append('q', query);
      if (category) url.searchParams.append('category', category);
      if (subCategory) url.searchParams.append('sub_category', subCategory);
      if (sort) url.searchParams.append('sort', sort);
      if (order) url.searchParams.append('order', order);

      const res = await fetch(url.toString(), {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0'
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) results.push(...data);
        else if (data && Array.isArray(data.torrents)) results.push(...data.torrents);
        else if (data && typeof data === 'object') {
          for (const key of Object.keys(data)) {
            if (Array.isArray(data[key])) { results.push(...data[key]); break; }
          }
        }
      }
    } catch (err) {
      log.error('Nyaa search error:', err.message);
    }
    
    // 2. Search TokyoTosho
    try {
      if (category === 'anime' || !category) {
        const ttUrl = `https://www.tokyotosho.info/rss.php?terms=${encodeURIComponent(query)}&type=1&searchName=true&searchFile=true`;
        const resTT = await fetch(ttUrl);
        if (resTT.ok) {
          const xml = await resTT.text();
          const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
          items.forEach(item => {
            const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
            const linkMatch = item.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>/) || item.match(/<link>(.*?)<\/link>/);
            const descMatch = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || item.match(/<description>([\s\S]*?)<\/description>/);
            
            if (titleMatch && linkMatch) {
              const info = descMatch ? descMatch[1] : '';
              const sizeMatch = info.match(/Size: ([\d.,]+\s*[A-Za-z]+)/);
              const seedersMatch = info.match(/Seeders: (\d+)/);
              const leechersMatch = info.match(/Leechers: (\d+)/);
              
              results.push({
                name: '[TokyoTosho] ' + titleMatch[1],
                title: '[TokyoTosho] ' + titleMatch[1],
                link: linkMatch[1],
                magnet: linkMatch[1].startsWith('magnet') ? linkMatch[1] : null,
                torrent: linkMatch[1].endsWith('.torrent') ? linkMatch[1] : null,
                size: sizeMatch ? sizeMatch[1] : 'Unknown',
                seeders: seedersMatch ? parseInt(seedersMatch[1]) : 0,
                leechers: leechersMatch ? parseInt(leechersMatch[1]) : 0,
                category: 'Anime (TokyoTosho)'
              });
            }
          });
        }
      }
    } catch (err) {
      log.error('TokyoTosho search error:', err.message);
    }

    // 3. Search SubsPlease / Erai-Raws via Subsplease RSS directly if applicable
    try {
      if (query.toLowerCase().includes('subsplease')) {
         const spUrl = `https://subsplease.org/rss/?r=1080`;
         const resSP = await fetch(spUrl);
         if (resSP.ok) {
            const xml = await resSP.text();
            const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
            items.forEach(item => {
              const titleMatch = item.match(/<title>(.*?)<\/title>/);
              const linkMatch = item.match(/<link>(.*?)<\/link>/);
              if (titleMatch && linkMatch && titleMatch[1].toLowerCase().includes(query.toLowerCase().replace('subsplease','').trim())) {
                results.push({
                  name: '[SubsPlease RSS] ' + titleMatch[1],
                  title: '[SubsPlease RSS] ' + titleMatch[1],
                  link: linkMatch[1],
                  magnet: linkMatch[1], 
                  size: '1080p',
                  seeders: '-',
                  leechers: '-',
                  category: 'Anime (SubsPlease)'
                });
              }
            });
         }
      }
    } catch (err) {
      log.error('SubsPlease search error:', err.message);
    }
    
    // Sort combined results by Seeders desc
    results.sort((a, b) => {
      const sA = (a.seeders === '-' ? 0 : parseInt(a.seeders) || 0);
      const sB = (b.seeders === '-' ? 0 : parseInt(b.seeders) || 0);
      return sB - sA;
    });

    if (results.length === 0) {
      log.warn(`No results found on any tracker for ${query}`);
    }
    
    return results;
  }));

  ipcMain.handle('get-torrent-metadata', wrapIpcHandler(async (event, { torrentUrl, magnet }) => {
    const torrentId = magnet || torrentUrl;
    if (!torrentId) throw new Error('Torrent URL or Magnet is required');
    const client = await getTorrentClient();
    
    return new Promise(async (resolve, reject) => {
      let resolved = false;
      
      const WELL_KNOWN_TRACKERS = [
        'http://nyaa.tracker.wf:7777/announce',
        'udp://open.stealth.si:80/announce',
        'udp://tracker.opentrackr.org:1337/announce',
        'udp://tracker.openbittorrent.com:80/announce',
        'udp://tracker.coppersurfer.tk:6969/announce',
        'udp://tracker.leechers-paradise.org:6969/announce',
        'udp://p4p.arenabg.com:1337/announce',
        'udp://tracker.internetwarriors.net:1337/announce',
        'udp://tracker.torrent.eu.org:451/announce',
        'udp://exodus.desync.com:6969/announce',
        'wss://tracker.openwebtorrent.com',
        'wss://tracker.btorrent.xyz',
        'wss://tracker.fastcast.nz'
      ];
      
      const onMetadata = (t) => {
        if (resolved) return;
        resolved = true;
        
        const hasActiveSessions = Array.from(activeDownloads.values()).some(d => 
          (d.status === 'downloading' || d.status === 'completed') && 
          (d.torrentId === torrentId || d.torrentId === t.infoHash || d.torrentId === t.magnetURI)
        );
        if (!hasActiveSessions) {
          t.files.forEach(f => f.deselect());
        }
        
        resolve({
          name: t.name,
          files: t.files.map((f, i) => ({
            index: i,
            name: f.name,
            path: f.path,
            length: f.length
          }))
        });
      };
      
      const config = await getData('config.json') || {};
      const baseDir = config.baseDir || app.getPath('userData');
      const torrentsDir = path.join(baseDir, 'torrents_temp');
      
      try {
        const torrent = await getOrAddTorrent(client, torrentId, { path: torrentsDir, announce: WELL_KNOWN_TRACKERS });
        
        if (torrent.ready) {
          onMetadata(torrent);
        } else {
          torrent.on('metadata', () => onMetadata(torrent));
        }
        
        torrent.on('error', (err) => { 
          if (!resolved) { 
            resolved = true; 
            reject(err); 
          } 
        });
        
        // Timeout after 25s
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            reject(new Error('Время ожидания метаданных торрента истекло (25с). Пиры не найдены.'));
          }
        }, 25000);
        
      } catch (e) {
        if (!resolved) {
          resolved = true;
          reject(e);
        }
      }
    });
  }));

  // Start Torrent Download
  ipcMain.handle('start-torrent-download', wrapIpcHandler(async (event, { torrentUrl, magnet, fileIndex }) => {
    const torrentId = magnet || torrentUrl;
    if (!torrentId) throw new Error('Torrent URL or Magnet is required');

    const dlId = `dl-${Date.now()}-${++downloadCounter}`;
    const config = await getData('config.json') || {};
    const baseDir = config.baseDir || app.getPath('userData');
    const torrentsDir = path.join(baseDir, 'torrents_temp');
    
    await fs.mkdir(torrentsDir, { recursive: true });

    // Set initial state
    activeDownloads.set(dlId, {
      id: dlId,
      torrentId: torrentId,
      fileIndex: fileIndex,
      name: 'Инициализация...',
      progress: 0,
      downloadSpeed: 0,
      numPeers: 0,
      status: 'downloading',
      filePath: null,
      error: null
    });
    saveTorrentsState();

    try {
      const client = await getTorrentClient();
      
      const WELL_KNOWN_TRACKERS = [
        'http://nyaa.tracker.wf:7777/announce',
        'udp://open.stealth.si:80/announce',
        'udp://tracker.opentrackr.org:1337/announce',
        'udp://tracker.openbittorrent.com:80/announce',
        'udp://tracker.coppersurfer.tk:6969/announce',
        'udp://tracker.leechers-paradise.org:6969/announce',
        'udp://p4p.arenabg.com:1337/announce',
        'udp://tracker.internetwarriors.net:1337/announce',
        'udp://tracker.torrent.eu.org:451/announce',
        'udp://exodus.desync.com:6969/announce',
        'wss://tracker.openwebtorrent.com',
        'wss://tracker.btorrent.xyz',
        'wss://tracker.fastcast.nz'
      ];
      
      const torrent = await getOrAddTorrent(client, torrentId, { path: torrentsDir, announce: WELL_KNOWN_TRACKERS });
      setupTorrentHandlers(dlId, torrentId, fileIndex, torrent, torrentsDir);
      
    } catch (err) {
      log.error(`Failed to start WebTorrent download:`, err);
      const state = activeDownloads.get(dlId);
      if (state) {
        state.status = 'error';
        state.error = err.message || String(err);
        activeDownloads.set(dlId, state);
        saveTorrentsState();
      }
    }

    return { downloadId: dlId };
  }));

  // Get Torrent Download Status
  ipcMain.handle('get-torrent-download-status', wrapIpcHandler(async (event, { downloadId }) => {
    if (!downloadId) throw new Error('Download ID is required');
    const state = activeDownloads.get(downloadId);
    if (!state) throw new Error('Download session not found');
    return state;
  }));

  // Get All Active Downloads (for UI monitor)
  ipcMain.handle('get-active-downloads', wrapIpcHandler(async () => {
    return Array.from(activeDownloads.values());
  }));

  // Trigger loading state background
  loadTorrentsState();
}

const activeDownloads = new Map();
const addingTorrents = new Map();
let downloadCounter = 0;
let torrentClientInstance = null;

function parseInfoHash(id) {
  if (!id || typeof id !== 'string') return null;
  if (/^[0-9a-fA-F]{40}$/.test(id)) {
    return id.toLowerCase();
  }
  const match = id.match(/xt=urn:btih:([0-9a-fA-F]{40})/i);
  if (match) return match[1].toLowerCase();
  return null;
}

async function getOrAddTorrent(client, torrentId, options) {
  // 1. Check if it's already in client.torrents
  const hash = parseInfoHash(torrentId);
  let torrent = client.torrents.find(t => {
    if (t.destroyed) return false;
    return (hash && t.infoHash === hash) ||
           t.magnetURI === torrentId ||
           (typeof torrentId === 'string' && t.infoHash === torrentId.toLowerCase());
  });
  if (torrent) {
    return torrent;
  }
  
  // 2. Check if there's already an active add operation for this exact torrentId / key
  if (addingTorrents.has(torrentId)) {
    log.info(`[getOrAddTorrent] Reusing in-progress addition promise for: ${torrentId}`);
    return addingTorrents.get(torrentId);
  }
  
  // 3. Create a unified add promise
  const addPromise = (async () => {
    try {
      log.info(`[getOrAddTorrent] Adding new torrent to client: ${torrentId}`);
      const t = client.add(torrentId, options);
      
      const onReady = () => {
        if (t.infoHash) {
          addingTorrents.set(t.infoHash.toLowerCase(), Promise.resolve(t));
        }
      };
      if (t.ready) {
        onReady();
      } else {
        t.once('ready', onReady);
      }
      
      return t;
    } catch (err) {
      if (err.message && err.message.includes('duplicate torrent')) {
        log.warn(`[getOrAddTorrent] Caught sync duplicate torrent error for ${torrentId}: ${err.message}. Retrying extraction.`);
        const match = err.message.match(/([0-9a-fA-F]{40})/);
        const resolvedHash = match ? match[1].toLowerCase() : null;
        const found = client.torrents.find(t => {
          if (t.destroyed) return false;
          return (resolvedHash && t.infoHash === resolvedHash) || 
                 t.magnetURI === torrentId || 
                 (typeof torrentId === 'string' && t.infoHash === torrentId.toLowerCase());
        }) || client.get(torrentId) || client.get(resolvedHash);
        
        if (found) return found;
      }
      throw err;
    }
  })();
  
  addingTorrents.set(torrentId, addPromise);
  if (hash) {
    addingTorrents.set(hash, addPromise);
  }
  
  try {
    const t = await addPromise;
    return t;
  } catch (err) {
    addingTorrents.delete(torrentId);
    if (hash) addingTorrents.delete(hash);
    throw err;
  }
}

function setupTorrentHandlers(dlId, torrentId, fileIndex, torrent, torrentsDir) {
  const handleMetadata = () => {
    log.info(`Torrent metadata loaded for session: ${dlId} / Name: ${torrent.name}`);
    const state = activeDownloads.get(dlId);
    if (state) {
      state.name = torrent.name;
      activeDownloads.set(dlId, state);
    }
    
    if (torrent.files) {
      torrent.files.forEach((file, index) => {
        // Select file if ANY active downloading or completed session of this torrent wants it
        const anyoneWants = Array.from(activeDownloads.values()).some(d => 
          d.status === 'downloading' && 
          (d.torrentId === torrentId || d.torrentId === torrent.infoHash || d.torrentId === torrent.magnetURI) && 
          d.fileIndex === index
        );
        if (anyoneWants) {
          file.select();
        } else {
          file.deselect();
        }
      });
    }
  };

  if (torrent.ready) {
    handleMetadata();
  } else {
    torrent.on('metadata', handleMetadata);
  }

  const updateProgress = () => {
    const state = activeDownloads.get(dlId);
    if (state && state.status === 'downloading') {
      let progress = 0;
      let speed = torrent.downloadSpeed;
      let peers = torrent.numPeers;
      
      if (torrent.files && fileIndex !== undefined && fileIndex >= 0 && fileIndex < torrent.files.length) {
        const f = torrent.files[fileIndex];
        progress = f.length > 0 ? Math.round((f.downloaded / f.length) * 100) : 0;
      } else {
        progress = Math.round(torrent.progress * 100);
      }
      
      state.progress = progress;
      state.downloadSpeed = speed;
      state.numPeers = peers;
      activeDownloads.set(dlId, state);
    }
  };

  const checkCompletion = async () => {
    const state = activeDownloads.get(dlId);
    if (!state || state.status !== 'downloading') return;
    
    let isDone = false;
    let targetFile = null;
    
    if (torrent.files) {
      if (fileIndex !== undefined && fileIndex >= 0 && fileIndex < torrent.files.length) {
        targetFile = torrent.files[fileIndex];
        if (targetFile && targetFile.downloaded === targetFile.length) {
          isDone = true;
        }
      } else {
        isDone = torrent.progress === 1;
        if (isDone) {
          let maxSize = 0;
          for (const file of torrent.files) {
            if (file.length > maxSize) {
              maxSize = file.length;
              targetFile = file;
            }
          }
        }
      }
    }
    
    if (isDone && targetFile) {
      log.info(`Torrent download complete for session ${dlId}: ${targetFile.path}`);
      state.progress = 100;
      state.status = 'completed';
      state.filePath = path.join(torrentsDir, targetFile.path);
      
      activeDownloads.set(dlId, state);
      saveTorrentsState();
    }
  };

  torrent.on('download', () => {
    updateProgress();
    checkCompletion();
  });

  torrent.on('done', async () => {
    log.info(`Torrent done event received for session ${dlId}`);
    updateProgress();
    await checkCompletion();
  });

  torrent.on('error', (err) => {
    log.error(`Torrent runtime error [Session: ${dlId} / Torrent: ${torrent.name}]:`, err);
    const state = activeDownloads.get(dlId);
    if (state) {
      state.status = 'error';
      state.error = err.message || String(err);
      activeDownloads.set(dlId, state);
      saveTorrentsState();
    }
  });

  // Run immediate checks in case the file is already fully loaded
  updateProgress();
  checkCompletion();
}

async function saveTorrentsState() {
  try {
    const data = Array.from(activeDownloads.values())
      .filter(d => d.status !== 'completed' && d.status !== 'error')
      .map(d => ({
        id: d.id,
        torrentId: d.torrentId,
        fileIndex: d.fileIndex
      }));
    await fs.writeFile(path.join(app.getPath('userData'), 'torrents_state.json'), JSON.stringify(data, null, 2));
  } catch (err) {
    log.error('Failed to save torrents state:', err);
  }
}

async function loadTorrentsState() {
  try {
    const p = path.join(app.getPath('userData'), 'torrents_state.json');
    const exists = await fs.access(p).then(()=>true).catch(()=>false);
    if (!exists) return;
    const raw = await fs.readFile(p, 'utf-8');
    const data = JSON.parse(raw);
    for (const d of data) {
      if (d.torrentId) {
        log.info('Restoring resilient torrent download:', d.torrentId);
        // recreate activeDownload state
        activeDownloads.set(d.id, {
          id: d.id,
          torrentId: d.torrentId,
          fileIndex: d.fileIndex,
          name: 'Возобновление...',
          progress: 0,
          downloadSpeed: 0,
          numPeers: 0,
          status: 'downloading',
          filePath: null,
          error: null
        });

        // Initialize download
        try {
          const client = await getTorrentClient();
          const WELL_KNOWN_TRACKERS = [
            'http://nyaa.tracker.wf:7777/announce',
            'udp://open.stealth.si:80/announce',
            'udp://tracker.opentrackr.org:1337/announce',
            'udp://tracker.openbittorrent.com:80/announce',
            'udp://tracker.coppersurfer.tk:6969/announce',
            'udp://tracker.leechers-paradise.org:6969/announce',
            'udp://p4p.arenabg.com:1337/announce',
            'udp://tracker.internetwarriors.net:1337/announce',
            'udp://tracker.torrent.eu.org:451/announce',
            'udp://exodus.desync.com:6969/announce',
            'wss://tracker.openwebtorrent.com',
            'wss://tracker.btorrent.xyz',
            'wss://tracker.fastcast.nz'
          ];
          const config = await getData('config.json') || {};
          const baseDir = config.baseDir || app.getPath('userData');
          const torrentsDir = path.join(baseDir, 'torrents_temp');
          await fs.mkdir(torrentsDir, { recursive: true });

          const torrent = await getOrAddTorrent(client, d.torrentId, { path: torrentsDir, announce: WELL_KNOWN_TRACKERS });
          setupTorrentHandlers(d.id, d.torrentId, d.fileIndex, torrent, torrentsDir);
          
        } catch(e) {
           log.error('Failed restoring torrent:', e);
           const state = activeDownloads.get(d.id);
           if (state) {
              state.status = 'error';
              state.error = e.message;
              activeDownloads.set(d.id, state);
              saveTorrentsState();
           }
        }
      }
    }
  } catch(err) {
    log.error('Failed to load torrents state:', err);
  }
}

async function getTorrentClient() {
  if (!torrentClientInstance) {
    try {
      const WebTorrentModule = await import('webtorrent');
      const WebTorrent = WebTorrentModule.default || WebTorrentModule;
      torrentClientInstance = new WebTorrent({
        maxConns: 500,
        dht: true,
        lsd: true,
        tracker: true,
        webSeeds: true
      });
      // Handle the global client-level errors to prevent unhandled node exceptions
      torrentClientInstance.on('error', (err) => {
        log.error('WebTorrent client encountered a general error:', err);
      });
    } catch (e) {
      log.error('Failed to load WebTorrent inside helper:', e);
      throw new Error(`Поддержка BitTorrent не установлена или не поддерживается на данной платформе: ${e.message}`);
    }
  }
  return torrentClientInstance;
}

module.exports = { registerSystemHandlers };
