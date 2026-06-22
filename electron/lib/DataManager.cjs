const fs = require('fs/promises');
const path = require('path');
const { z } = require('zod');
const log = require('electron-log');

// Zod Schemas for validation
const ParticipantSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  telegram: z.string().optional().nullable(),
  tgChannel: z.string().optional().nullable(),
  vkLink: z.string().optional().nullable(),
  roles: z.array(z.string()).optional(),
});

const RoleAssignmentSchema = z.object({
  id: z.string(),
  episodeId: z.string().optional().nullable(),
  characterName: z.string(),
  dubberId: z.string(),
  substituteId: z.string().optional().nullable(),
  status: z.string(),
  comments: z.string().optional().nullable(),
  lineCount: z.number().optional().nullable(),
  isMain: z.boolean().optional().nullable(),
});

const UploadedFileSchema = z.object({
  id: z.string(),
  episodeId: z.string().optional().nullable(),
  assignmentId: z.string().optional().nullable(),
  type: z.enum(["DUBBER_FILE", "FIXES", "SOUND_ENGINEER_FILE"]),
  path: z.string(),
  uploadedById: z.string(),
  role: z.string().optional().nullable(),
  createdAt: z.string(),
});

const EpisodeSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  number: z.number(),
  status: z.enum(["UPLOAD", "ROLES", "RECORDING", "QA", "FIXES", "SOUND_ENGINEERING", "FINISHED"]),
  deadline: z.string().optional().nullable(),
  rawPath: z.string().optional().nullable(),
  subPath: z.string().optional().nullable(),
  isHardsub: z.boolean().optional().nullable(),
  tgPostTemplate: z.string().optional().nullable(),
  vkPostTemplate: z.string().optional().nullable(),
  finalTgPostTemplate: z.string().optional().nullable(),
  linksTemplate: z.string().optional().nullable(),
  startMessageTemplate: z.string().optional().nullable(),
  soundEngineerMessageTemplate: z.string().optional().nullable(),
  fixesMessageTemplate: z.string().optional().nullable(),
  statusMessageTemplate: z.string().optional().nullable(),
  tgPostLink: z.string().optional().nullable(),
  vkPostLink: z.string().optional().nullable(),
  assignments: z.array(RoleAssignmentSchema),
  uploads: z.array(UploadedFileSchema),
  statusHistory: z.array(z.object({ status: z.string(), timestamp: z.string() })).optional().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  originalTitle: z.string().optional().nullable(),
  status: z.enum(["ACTIVE", "COMPLETED"]),
  lastActiveEpisode: z.number(),
  totalEpisodes: z.number(),
  assignedDubberIds: z.array(z.string()),
  soundEngineerId: z.string().optional().nullable(),
  releaseType: z.enum(["VOICEOVER", "RECAST", "REDUB"]).optional().nullable(),
  emoji: z.string().optional().nullable(),
  isOngoing: z.boolean().optional().nullable(),
  synopsis: z.string().optional().nullable(),
  posterUrl: z.string().optional().nullable(),
  links: z.string().optional().nullable(),
  globalMapping: z.string().optional().nullable(),
  characterAliases: z.string().optional().nullable(),
  typeAndSeason: z.string().optional().nullable(),
  tgPostTemplate: z.string().optional().nullable(),
  vkPostTemplate: z.string().optional().nullable(),
  finalTgPostTemplate: z.string().optional().nullable(),
  linksTemplate: z.string().optional().nullable(),
  startMessageTemplate: z.string().optional().nullable(),
  soundEngineerMessageTemplate: z.string().optional().nullable(),
  fixesMessageTemplate: z.string().optional().nullable(),
  statusMessageTemplate: z.string().optional().nullable(),
  nextEpisodeDate: z.string().optional().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ConfigSchema = z.object({
  baseDir: z.string().optional().nullable(),
  ffmpegPath: z.string().optional().nullable(),
  useNvenc: z.boolean().optional().nullable(),
  gpuIndex: z.string().optional().nullable(),
  openRouterKey: z.string().optional().nullable(),
  yandexToken: z.string().optional().nullable(),
  syncEnabled: z.boolean().optional().nullable(),
});

const Schemas = {
  'participants.json': z.array(ParticipantSchema),
  'projects.json': z.array(ProjectSchema),
  'episodes.json': z.array(EpisodeSchema),
  'config.json': ConfigSchema,
};

class DataManager {
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    this.backupPath = path.join(userDataPath, 'backups');
    this.saveQueues = new Map();
    this.baseDir = null;
  }

  /**
   * Initialize DataManager (create necessary directories)
   */
  async init() {
    try {
      await fs.mkdir(this.backupPath, { recursive: true });
      log.info('DataManager initialized. Backup path:', this.backupPath);
      
      // Load config to fetch baseDir
      const config = await this.getData('config.json');
      if (config && config.baseDir) {
        this.baseDir = config.baseDir;
        log.info('DataManager: Loaded baseDir config on startup:', this.baseDir);
        await this.syncAndLoadFromBaseDir();
      }
    } catch (e) {
      log.error('Failed to initialize DataManager:', e);
    }
  }

  async syncAndLoadFromBaseDir() {
    if (!this.baseDir) return;
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
      const files = ['projects.json', 'episodes.json', 'participants.json', 'config.json'];
      
      for (const file of files) {
        const localPath = path.join(this.userDataPath, file);
        const folderPath = path.join(this.baseDir, file);
        
        let folderData = null;
        try {
          const folderContent = await fs.readFile(folderPath, 'utf-8');
          folderData = JSON.parse(folderContent);
        } catch (e) {
          // Folder copy doesn't exist yet, or is invalid
        }
        
        let localData = null;
        try {
          const localContent = await fs.readFile(localPath, 'utf-8');
          localData = JSON.parse(localContent);
        } catch (e) {
          // Local copy doesn't exist yet
        }
        
        if (folderData) {
          if (file === 'config.json') {
            // Merge configs
            const merged = { ...(localData || {}), ...folderData };
            const json = JSON.stringify(merged, null, 2);
            await fs.writeFile(localPath, json, 'utf-8');
          } else {
            // Entities: smart merge prioritizing newer updatedAt
            const mergedList = Array.isArray(localData) ? [...localData] : [];
            const folderList = Array.isArray(folderData) ? folderData : [];
            
            for (const folderItem of folderList) {
              if (!folderItem || !folderItem.id) continue;
              const existingIndex = mergedList.findIndex(item => item && item.id === folderItem.id);
              if (existingIndex === -1) {
                mergedList.push(folderItem);
              } else {
                const localItem = mergedList[existingIndex];
                const localUpdate = localItem && localItem.updatedAt ? new Date(localItem.updatedAt).getTime() : 0;
                const folderUpdate = folderItem.updatedAt ? new Date(folderItem.updatedAt).getTime() : 0;
                
                if (folderUpdate > localUpdate) {
                  mergedList[existingIndex] = { ...localItem, ...folderItem };
                } else {
                  mergedList[existingIndex] = { ...folderItem, ...localItem };
                }
              }
            }
            
            const json = JSON.stringify(mergedList, null, 2);
            await fs.writeFile(localPath, json, 'utf-8');
            await fs.writeFile(folderPath, json, 'utf-8');
          }
        } else if (localData) {
          // If no folder data but local data exists, copy it to the folder
          const json = JSON.stringify(localData, null, 2);
          await fs.writeFile(folderPath, json, 'utf-8');
        }
      }
      log.info('DataManager: Successfully synced local databases with working directory:', this.baseDir);
    } catch (err) {
      log.error('DataManager: Failed during syncAndLoadFromBaseDir:', err);
    }
  }

  /**
   * Read data from JSON file
   */
  async getData(filename) {
    const filePath = path.join(this.userDataPath, filename);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      log.warn(`File ${filename} not found or corrupted. Returning default.`);
      return filename.endsWith('s.json') ? [] : null;
    }
  }

  /**
   * Save data to JSON file using Atomic Write pattern
   */
  async saveData(filename, data) {
    if (!this.saveQueues.has(filename)) {
      this.saveQueues.set(filename, Promise.resolve());
    }

    const queue = this.saveQueues.get(filename);
    const newQueue = queue.then(() => this._performSave(filename, data)).catch(() => this._performSave(filename, data));
    this.saveQueues.set(filename, newQueue);
    return newQueue;
  }

  async _performSave(filename, data) {
    const filePath = path.join(this.userDataPath, filename);
    const tempPath = `${filePath}.tmp`;

    try {
      // 1. Validate data against Zod schema
      if (Schemas[filename]) {
        Schemas[filename].parse(data);
      }

      // 2. Create a backup before overwriting
      await this.createBackup(filename);

      // 3. Atomic Write: Write to a temporary file first
      // Circular references are assumed to be handled by the caller (as per project state)
      const json = JSON.stringify(data, null, 2);
      await fs.writeFile(tempPath, json, 'utf-8');

      // 4. Atomic Write: Rename temp file to original file (OS-level atomic operation)
      // Retry logic for EPERM on Windows (often caused by Antivirus locks or short-lived open handles)
      let renameSuccess = false;
      let retries = 5;
      while (!renameSuccess && retries > 0) {
        try {
          await fs.rename(tempPath, filePath);
          renameSuccess = true;
        } catch (renameErr) {
          if (renameErr.code === 'EPERM' && retries > 1) {
            retries--;
            await new Promise(resolve => setTimeout(resolve, 50));
          } else {
            throw renameErr;
          }
        }
      }
      
      log.info(`DataManager: Successfully saved ${filename} atomically.`);

      // If config.json is saved, update internal baseDir reference dynamically
      if (filename === 'config.json') {
        this.baseDir = data ? data.baseDir : null;
        log.info('DataManager: Dynamically updated baseDir to:', this.baseDir);
      }
      
      // If baseDir is configured, duplicate/sync the file as requested!
      if (this.baseDir) {
        try {
          await fs.mkdir(this.baseDir, { recursive: true });
          const targetFolderPath = path.join(this.baseDir, filename);
          const json = JSON.stringify(data, null, 2);
          await fs.writeFile(targetFolderPath, json, 'utf-8');
          log.info(`DataManager: Duplicated/Synced ${filename} to working directory: ${targetFolderPath}`);
        } catch (syncErr) {
          log.error(`DataManager: Failed to sync ${filename} to working directory:`, syncErr);
        }
      }
    } catch (e) {
      log.error(`DataManager: Failed to save ${filename}:`, e);
      
      // Cleanup temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch (unlinkError) {
        // Ignore unlink errors
      }
      
      throw e;
    }
  }

  /**
   * Create a timestamped backup of the file
   */
  async createBackup(filename) {
    const filePath = path.join(this.userDataPath, filename);
    try {
      // Check if original file exists before backing up
      await fs.access(filePath);
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(this.backupPath, `${filename}.${timestamp}.bak`);
      
      await fs.copyFile(filePath, backupFile);
      
      // Keep only the last 5 versions
      await this.rotateBackups(filename);
    } catch (e) {
      // File doesn't exist yet, skip backup
    }
  }

  /**
   * Keep only the last 5 backups for a specific file
   */
  async rotateBackups(filename) {
    try {
      const files = await fs.readdir(this.backupPath);
      const backups = files
        .filter(f => f.startsWith(filename) && f.endsWith('.bak'))
        .sort()
        .reverse();

      if (backups.length > 5) {
        const toDelete = backups.slice(5);
        for (const file of toDelete) {
          await fs.unlink(path.join(this.backupPath, file));
        }
      }
    } catch (e) {
      log.error(`DataManager: Failed to rotate backups for ${filename}:`, e);
    }
  }
}

module.exports = DataManager;
