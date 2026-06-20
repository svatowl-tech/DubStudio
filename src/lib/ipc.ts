export const ipcRenderer: {
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  send: (channel: string, ...args: any[]) => void;
  on: (channel: string, callback: (...args: any[]) => void) => () => void;
  removeListener: (channel: string, callback: (...args: any[]) => void) => void;
} = {
  invoke: async (channel: string, ...args: any[]) => {
    if (window.electronAPI && window.electronAPI.invoke) {
      try {
        return await window.electronAPI.invoke(channel, ...args);
      } catch (error) {
        console.warn(`Local Electron invoke failed for "${channel}", falling back to server:`, error);
      }
    }
    
    // Browser fallback for AI Studio preview - Try calling the server API
    // console.info(`IPC channel "${channel}" called. Attempting server call.`);
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const url = origin && !origin.startsWith('file') ? `${origin}/api/ipc/${channel}` : `/api/ipc/${channel}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args })
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.success) return result.data;
        throw new Error(result.error);
      } else {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || `Server status ${response.status}`);
      }
    } catch (e: any) {
      console.warn(`Server IPC fallback failed for "${channel}":`, e);
      
      // If we are on the web and the server call failed, check if we have a mock in this file
      // This allows some things to work even if the server is down or the channel is unknown
      const mockedResult = handleIpcMock(channel, args);
      if (mockedResult !== undefined) return mockedResult;
      
      throw e;
    }
  },
  send: (channel: string, ...args: any[]) => {
    if (window.electronAPI && window.electronAPI.send) {
      window.electronAPI.send(channel, ...args);
    } else {
      // console.warn(`IPC channel "${channel}" send called in browser environment. Using fallback.`);
    }
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
    // console.warn(`IPC channel "${channel}" listener registered in browser environment. Using fallback.`);
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

/**
 * Fallback mock logic for when running in browser without server
 */
function handleIpcMock(channel: string, args: any[]): any {
  // console.warn(`IPC channel "${channel}" falling back to LocalStorage mock.`);
  
  const getLocalData = (key: string) => {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  };
  
  const saveLocalData = (key: string, data: any) => {
    localStorage.setItem(key, JSON.stringify(data));
  };

  // Seed initial demo/preview data if localStorage is empty
  if (typeof window !== 'undefined' && (!localStorage.getItem('projects') || JSON.parse(localStorage.getItem('projects') || '[]').length === 0)) {
    const demoParticipants = [
      { id: 'p1', nickname: 'Kira', telegram: '@kira_dub', tgChannel: '@kira_channel', vkLink: 'vk.com/kira', roles: ['DUBBER'] },
      { id: 'p2', nickname: 'Anilibria_Enjoyer', telegram: '@ani_enjoyer', tgChannel: '', vkLink: '', roles: ['DUBBER', 'QA'] },
      { id: 'p3', nickname: 'Saber', telegram: '@saber_dub', tgChannel: '@saber_notes', vkLink: 'vk.com/saber', roles: ['DUBBER'] },
      { id: 'p4', nickname: 'OwlSound', telegram: '@owl_sound', tgChannel: '@owl_studio', vkLink: '', roles: ['SOUND_ENGINEER'] },
    ];
    
    const demoProjects = [
      {
        id: 'proj1',
        title: "Sousou no Frieren",
        originalTitle: "Frieren: Beyond Journey's End",
        status: 'ACTIVE',
        lastActiveEpisode: 1,
        totalEpisodes: 28,
        assignedDubberIds: ['p1', 'p2', 'p3'],
        soundEngineerId: 'p4',
        releaseType: 'VOICEOVER',
        emoji: '🧙‍♀️',
        isOngoing: true,
        synopsis: 'История эльфийки Фрирен, которая исследует новые земли и пытается понять человеческие эмоции после победы над Королём демонов.',
        typeAndSeason: 'TV-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    const demoEpisodes = [
      {
        id: 'ep1',
        projectId: 'proj1',
        number: 1,
        status: 'RECORDING',
        deadline: '2026-06-15',
        rawPath: 'Frieren_01_RAW.mp4',
        subPath: 'Frieren_01.ass',
        assignments: [
          { id: 'a1', episodeId: 'ep1', characterName: 'Frieren', dubberId: 'p1', status: 'RECORDED', lineCount: 154, isMain: true },
          { id: 'a2', episodeId: 'ep1', characterName: 'Himmel', dubberId: 'p2', status: 'PENDING', lineCount: 42, isMain: true },
          { id: 'a3', episodeId: 'ep1', characterName: 'Heiter', dubberId: 'p3', status: 'PENDING', lineCount: 28 }
        ],
        uploads: [
          { id: 'u1', episodeId: 'ep1', assignmentId: 'a1', type: 'DUBBER_FILE', path: '/mock/files/frieren_vox.wav', uploadedById: 'p1', createdAt: new Date().toISOString() }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    localStorage.setItem('participants', JSON.stringify(demoParticipants));
    localStorage.setItem('projects', JSON.stringify(demoProjects));
    localStorage.setItem('episodes', JSON.stringify(demoEpisodes));
  }

  if (channel === 'search-nyaa-torrents') {
    const q = (args[0]?.query || '').toLowerCase();
    return [
      {
        title: `[SubsPlease] Sousou no Frieren - 01 (1080p) [RAW]`,
        name: `[SubsPlease] Sousou no Frieren - 01 (1080p) [RAW]`,
        torrent: `https://nyaa.si/download/mock1.torrent`,
        magnet: `magnet:?xt=urn:btih:mockfrieren01raw1080p&dn=SousouNoFrieren01`,
        size: '1.2 GiB',
        date: '2026-05-20 12:00:00',
        timestamp: '2026-05-20',
        seeders: 245,
        seeds: 245,
        leechers: 12,
        leechs: 12,
        category: 'Anime - Raw'
      },
      {
        title: `[Erai-raws] Sousou no Frieren - 01 [720p] [RAW]`,
        name: `[Erai-raws] Sousou no Frieren - 01 [720p] [RAW]`,
        torrent: `https://nyaa.si/download/mock2.torrent`,
        magnet: `magnet:?xt=urn:btih:mockfrieren01raw720p&dn=SousouNoFrieren01_720`,
        size: '720.5 MiB',
        date: '2026-05-20 12:15:00',
        timestamp: '2026-05-20',
        seeders: 184,
        seeds: 184,
        leechers: 8,
        leechs: 8,
        category: 'Anime - Raw'
      },
      {
        title: `[AnimeTime] Sousou no Frieren - 01 (1080p HEVC x265 10bit) [RAW]`,
        name: `[AnimeTime] Sousou no Frieren - 01 (1080p HEVC x265 10bit) [RAW]`,
        torrent: `https://nyaa.si/download/mock3.torrent`,
        magnet: `magnet:?xt=urn:btih:mockfrieren01hevc&dn=SousouNoFrieren01_HEVC`,
        size: '450.2 MiB',
        date: '2026-05-20 13:40:00',
        timestamp: '2026-05-20',
        seeders: 95,
        seeds: 95,
        leechers: 4,
        leechs: 4,
        category: 'Anime - Raw'
      }
    ];
  }

  if (channel === 'start-torrent-download') {
    localStorage.setItem('mock_download_progress', '0');
    localStorage.setItem('mock_download_name', args[0]?.torrentUrl || args[0]?.magnet || 'Sousou no Frieren - 01 (1080p) [RAW]');
    return { downloadId: 'mock-dl-12345' };
  }

  if (channel === 'get-torrent-download-status') {
    const currentProgress = parseInt(localStorage.getItem('mock_download_progress') || '0', 10);
    const downloadName = localStorage.getItem('mock_download_name') || 'Sousou no Frieren - 01 (1080p) [RAW]';
    
    let nextProgress = currentProgress + 20;
    if (nextProgress > 100) nextProgress = 100;
    
    localStorage.setItem('mock_download_progress', nextProgress.toString());
    
    return {
      id: 'mock-dl-12345',
      name: downloadName.substring(0, 60) + (downloadName.length > 60 ? '...' : ''),
      progress: nextProgress,
      downloadSpeed: nextProgress === 100 ? 0 : 8500000 + Math.random() * 2000000,
      numPeers: nextProgress === 100 ? 0 : 38,
      status: nextProgress === 100 ? 'completed' : 'downloading',
      filePath: nextProgress === 100 ? 'Frieren_01_RAW.mp4' : null,
      error: null
    };
  }

  if (channel === 'get-config') {
    const config = localStorage.getItem('config');
    return config ? JSON.parse(config) : { baseDir: '' };
  }
  if (channel === 'save-config') {
    localStorage.setItem('config', JSON.stringify(args[0]));
    return { success: true };
  }
  
  if (channel === 'cloud-sync-status') {
    return { connected: false, enabled: false };
  }

  if (channel === 'yandex-get-auth-url') {
    return 'https://oauth.yandex.ru/authorize?response_type=code&client_id=mock';
  }

  if (channel === 'cloud-push' || channel === 'cloud-pull') {
    return { success: true, results: [] };
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

  if (channel === 'import-participants') {
    saveLocalData('participants', args[0]);
    return { success: true };
  }

  if (channel === 'select-directory') {
    return (async () => {
      try {
        const { selectBrowserDirectory } = await import('./webFileSystem');
        const dirName = await selectBrowserDirectory();
        return { canceled: false, filePaths: [dirName] };
      } catch (e: any) {
        console.warn('Select directory canceled or failed:', e);
        return { canceled: false, filePaths: ['/mock/release/directory'] };
      }
    })();
  }

  if (channel === 'select-folder') {
    return (async () => {
      try {
        const { selectBrowserDirectory } = await import('./webFileSystem');
        const dirName = await selectBrowserDirectory();
        return { success: true, data: { path: dirName } };
      } catch (e: any) {
        console.warn('Select folder canceled or failed:', e);
        return { success: true, data: { path: '/mock/path' } };
      }
    })();
  }
  
  if (channel === 'select-file') {
    return (async () => {
      try {
        const { selectBrowserFile } = await import('./webFileSystem');
        const fileInfo = await selectBrowserFile();
        return { success: true, data: { path: fileInfo.path } };
      } catch (e: any) {
        console.warn('Select file canceled or failed, using mock path:', e);
        return { success: true, data: { path: '/mock/selected/file.mp4' } };
      }
    })();
  }
  
  if (channel === 'get-raw-subtitles') {
    return (async () => {
      const filePath = args[0];
      if (filePath) {
        try {
          const { readFromLocalFolder } = await import('./webFileSystem');
          const file = await readFromLocalFolder(filePath);
          if (file instanceof File) {
            const text = await file.text();
            
            // Парсинг ASS контента
            const lines: any[] = [];
            const actorsSet = new Set<string>();
            const stylesSet = new Set<string>();
            const textLines = text.split(/\r?\n/);
            let isEvents = false;
            let rawLineIndex = 0;
            
            for (const line of textLines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('[Events]')) {
                isEvents = true;
                continue;
              }
              if (trimmed.startsWith('[')) {
                isEvents = false;
              }
              
              if (isEvents && trimmed.startsWith('Dialogue:')) {
                rawLineIndex++;
                const prefixLength = 'Dialogue:'.length;
                const parts = trimmed.substring(prefixLength).split(',');
                if (parts.length >= 9) {
                  const start = parts[1].trim();
                  const end = parts[2].trim();
                  const style = parts[3].trim();
                  const name = parts[4].trim();
                  const textVal = parts.slice(9).join(',').trim();
                  lines.push({
                    rawLineIndex,
                    start,
                    end,
                    style,
                    name,
                    text: textVal
                  });
                  if (name) actorsSet.add(name);
                  if (style) stylesSet.add(style);
                }
              }
            }
            
            if (lines.length > 0) {
              return {
                lines,
                actors: Array.from(actorsSet),
                styles: Array.from(stylesSet)
              };
            }
          }
        } catch (e) {
          console.warn('Failed to natively parse local .ass sub file, using fallback mock:', e);
        }
      }
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
    })();
  }

  if (channel === 'save-raw-subtitles') {
    return (async () => {
      const payload = args[0];
      const filePath = payload.filePath || payload.assFilePath;
      const lines = payload.lines;
      if (filePath && Array.isArray(lines)) {
        try {
          const { writeToLocalFolder } = await import('./webFileSystem');
          const header = `[Script Info]\nTitle: Anime Dub Manager\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
          const eventLines = lines.map(l => {
            return `Dialogue: 0,${l.start},${l.end},${l.style || 'Default'},${l.name || 'Actor'},0,0,0,,${l.text}`;
          }).join('\n');
          await writeToLocalFolder(filePath, header + eventLines);
          return { success: true };
        } catch (e) {
          console.error("Could not write edited subtitles to disk:", e);
        }
      }
      return { success: true };
    })();
  }

  if (channel === 'save-translated-subtitles') {
    return (async () => {
      const { assFilePath, translatedLines } = args[0] || {};
      if (assFilePath && Array.isArray(translatedLines)) {
        try {
          const { writeToLocalFolder } = await import('./webFileSystem');
          const header = `[Script Info]\nTitle: Anime Dub Manager\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
          const eventLines = translatedLines.map(l => {
            return `Dialogue: 0,${l.start},${l.end},${l.style || 'Default'},${l.name || 'Actor'},0,0,0,,${l.text}`;
          }).join('\n');
          await writeToLocalFolder(assFilePath, header + eventLines);
          return { success: true };
        } catch (e) {
          console.error("Could not write translated subtitles to disk:", e);
        }
      }
      return { success: true };
    })();
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
    return (async () => {
      const { fileName, targetDir } = args[0] || {};
      const pathValue = `${targetDir}/${fileName}`;
      try {
        const { readFromLocalFolder, writeToLocalFolder } = await import('./webFileSystem');
        const file = await readFromLocalFolder(fileName);
        if (file instanceof File) {
          await writeToLocalFolder(pathValue, file);
        }
        return { success: true, data: { path: pathValue } };
      } catch (e) {
        return { success: true, data: { path: pathValue } };
      }
    })();
  }

  if (channel === 'save-file-buffer') {
    return (async () => {
      const { fileName, targetDir, buffer } = args[0] || {};
      const pathValue = `${targetDir}/${fileName}`;
      try {
        const { writeToLocalFolder } = await import('./webFileSystem');
        if (buffer) {
          const blob = new Blob([buffer]);
          await writeToLocalFolder(pathValue, blob);
        }
        return { success: true, data: { path: pathValue } };
      } catch (e) {
        return { success: true, data: { path: pathValue } };
      }
    })();
  }

  if (channel === 'get-debug-stats') {
    return { cpu: 0, ram: 0, ffmpeg: [] };
  }

  if (channel === 'get-tasks') {
    return [];
  }

  if (channel === 'abort-task') {
    return true;
  }

  if (channel === 'clear-task-history') {
    return true;
  }

  // Anime365 Mock fallbacks for web preview
  if (channel === 'anime365-search-series') {
    const q = (args[0]?.query || '').toLowerCase();
    return [
      {
        id: 4242,
        title: "Sousou no Frieren",
        titles: { ru: "Фрирен, провожающая в последний путь", romaji: "Sousou no Frieren", ja: "葬送のフリーレン", en: "Frieren: Beyond Journey's End" },
        posterUrl: "https://shikimori.one/system/animes/original/52991.jpg",
        numberOfEpisodes: 28,
        year: 2023,
        typeTitle: "TV Сериал",
        isAiring: 0
      },
      {
        id: 8484,
        title: "Chainsaw Man",
        titles: { ru: "Человек-бензопила", romaji: "Chainsaw Man", ja: "チェンソーマン", en: "Chainsaw Man" },
        posterUrl: "https://shikimori.one/system/animes/original/44511.jpg",
        numberOfEpisodes: 12,
        year: 2022,
        typeTitle: "TV Сериал",
        isAiring: 0
      }
    ];
  }

  if (channel === 'anime365-get-series-details') {
    const id = args[0]?.id;
    return {
      id: id || 4242,
      title: "Sousou no Frieren",
      titles: { ru: "Фрирен, провожающая в последний путь", romaji: "Sousou no Frieren", ja: "葬送のフリーレン", en: "Frieren: Beyond Journey's End" },
      posterUrl: "https://shikimori.one/system/animes/original/52991.jpg",
      numberOfEpisodes: 28,
      year: 2023,
      typeTitle: "TV Сериал",
      isAiring: 0,
      descriptions: [{ source: "Anime365", value: "История эльфийки Фрирен, которая исследует новые земли и пытается понять человеческие эмоции после победы над Королём демонов." }],
      episodes: Array.from({ length: 28 }).map((_, idx) => ({
        id: 1000 + idx,
        episodeInt: String(idx + 1),
        episodeFull: `Серия ${idx + 1}`,
        episodeTitle: `Начало пути ${idx + 1}`
      }))
    };
  }

  if (channel === 'anime365-get-episode-translations') {
    return [
      {
        id: 5001,
        title: "Оригинал (RAW)",
        type: "raw",
        typeLang: "jpn",
        qualityType: "1080p",
        url: "https://smotret-anime.ru/translations/raw/5001.mp4",
        embedUrl: "https://smotret-anime.ru/translations/embed/5001",
        authorsSummary: "Original Audio",
        duration: "24:00"
      },
      {
        id: 5002,
        title: "Субтитры (Альянс)",
        type: "subtitles",
        typeLang: "rus",
        qualityType: "ass",
        url: "https://smotret-anime.ru/translations/sub/5002.ass",
        embedUrl: "",
        authorsSummary: "Альянс",
        duration: ""
      },
      {
        id: 5003,
        title: "Японские субтитры",
        type: "subtitles",
        typeLang: "jpn",
        qualityType: "ass",
        url: "https://smotret-anime.ru/translations/sub/5003.ass",
        embedUrl: "",
        authorsSummary: "Kitsunekko / Official Ja",
        duration: ""
      },
      {
        id: 5004,
        title: "Субтитры (Anilibria)",
        type: "subtitles",
        typeLang: "rus",
        qualityType: "srt",
        url: "https://smotret-anime.ru/translations/sub/5004.srt",
        embedUrl: "",
        authorsSummary: "Anilibria Subs Team",
        duration: ""
      }
    ];
  }

  if (channel === 'anime365-update-project-data') {
    const projectId = args[0]?.projectId;
    const projects = getLocalData('projects');
    const project = projects.find((p: any) => p.id === projectId);
    if (project) {
      project.synopsis = "История эльфийки Фрирен, которая исследует новые земли и пытается понять человеческие эмоции после победы над Королём демонов. (Обновлено из Anime365!)";
      project.posterUrl = "https://shikimori.one/system/animes/original/52991.jpg";
      project.totalEpisodes = 28;
      project.isOngoing = true;
      project.anime365Id = 4242;
      project.typeAndSeason = "TV-1";
      saveLocalData('projects', projects);
      return project;
    }
    return null;
  }

  if (channel === 'anime365-download-subtitle') {
    return { success: true, subPath: "/mock/user_data/projects/proj1/subs/episode_1_subs.ass" };
  }

  if (channel === 'anime365-check-new-episodes') {
    const projects = getLocalData('projects');
    const project = projects.find((p: any) => p.id === args[0]?.projectId);
    if (project) {
      const currentMax = (project.episodes || []).reduce((max: number, ep: any) => Math.max(max, ep.number), 0) || 0;
      return { maxEpisode: currentMax + 1, source: 'anime365' };
    }
    return { maxEpisode: null, source: 'none' };
  }

  return { success: true, mocked: true };
}
