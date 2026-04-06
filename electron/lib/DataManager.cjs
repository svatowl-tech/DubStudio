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
  type: z.enum(["DUBBER_FILE", "FIXES"]),
  path: z.string(),
  uploadedById: z.string(),
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
  assignments: z.array(RoleAssignmentSchema),
  uploads: z.array(UploadedFileSchema),
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
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ConfigSchema = z.object({
  baseDir: z.string().optional().nullable(),
  ffmpegPath: z.string().optional().nullable(),
  useNvenc: z.boolean().optional().nullable(),
  gpuIndex: z.string().optional().nullable(),
  openRouterKey: z.string().optional().nullable(),
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
  }

  /**
   * Initialize DataManager (create necessary directories)
   */
  async init() {
    try {
      await fs.mkdir(this.backupPath, { recursive: true });
      log.info('DataManager initialized. Backup path:', this.backupPath);
    } catch (e) {
      log.error('Failed to initialize DataManager:', e);
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
      await fs.rename(tempPath, filePath);
      
      log.info(`DataManager: Successfully saved ${filename} atomically.`);
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
