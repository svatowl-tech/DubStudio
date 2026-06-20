const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs/promises');
const log = require('electron-log');

// Importing getActiveProcesses, addProcess, removeProcess from ffmpegService is slightly complex if it's cyclic,
// Let's just use fluent-ffmpeg locally and not manage its process in the global list for now, 
// or require ffmpegService properly.
const { addProcess, removeProcess, getVideoMetadata } = require('./ffmpegService.cjs');

const { app } = require('electron');

class WhisperService {
  constructor(baseDir) {
    this.baseDir = baseDir;
    const isDev = !app.isPackaged;
    this.modelsDir = path.join(baseDir, 'models', 'whisper');
    this.bundledModelsDir = process.resourcesPath ? path.join(process.resourcesPath, 'models') : path.join(app.getAppPath(), 'assets', 'models');
    
    log.info('[WhisperService] Constructor initialization');
    log.info(`[WhisperService] baseDir: ${baseDir}`);
    log.info(`[WhisperService] bundledModelsDir: ${this.bundledModelsDir}`);
  }

  async ensureFolder() {
    await fs.mkdir(this.modelsDir, { recursive: true });
  }

  async getModelPath(modelName) {
    const fileName = `ggml-${modelName}.bin`;
    const userPath = path.join(this.modelsDir, fileName);

    try {
      await fs.access(userPath);
      return userPath;
    } catch {
      if (this.bundledModelsDir) {
        const bundledPath = path.join(this.bundledModelsDir, fileName);
        try {
          await fs.access(bundledPath);
          return bundledPath;
        } catch {
          // ignore
        }
      }
      return userPath; // Result path for downloading
    }
  }

  /**
   * Транскрибация видео файла باستخدام FFmpeg whisper (требует FFmpeg 8.0+ с --enable-whisper)
   * @param {string} videoPath - Путь к видео
   * @param {string} language - Код языка (например, 'ja' или 'ru')
   * @param {string} modelName - Название модели (например, 'base', 'small')
   * @param {function} onProgress - Коллбэк для прогресса
   */
  async transcribe(videoPath, language = 'ja', modelName = 'base', onProgress) {
    try {
      await this.ensureFolder();
      const outputDir = path.dirname(videoPath);
      const fileName = path.basename(videoPath, path.extname(videoPath));
      const srtPath = path.join(outputDir, `${fileName}.srt`);

      // Check if video file contains any audio streams to prevent FFmpeg null mapping exception
      let hasAudioStream = false;
      try {
        const metadata = await getVideoMetadata(videoPath);
        if (metadata && metadata.streams) {
          hasAudioStream = metadata.streams.some(s => s.codec_type === 'audio');
        }
      } catch (err) {
        log.error('Failed to probe video file for audio stream in WhisperService:', err);
        // Fallback: assume it has audio if probe fails so we don't break general workflow
        hasAudioStream = true;
      }

      if (!hasAudioStream) {
        log.warn(`Video file ${videoPath} has NO audio track! Creating a dummy subtitles file to prevent FFmpeg crashes.`);
        await fs.writeFile(srtPath, '1\n00:00:01,000 --> 00:00:03,000\n[Без звука / Silent]\n', 'utf-8');
        if (onProgress) onProgress(100);
        return srtPath;
      }

      log.info(`Whisper (FFmpeg): Starting transcription for ${videoPath} [${language}] using model [${modelName}]`);
      
      const modelPath = await this.getModelPath(modelName);
      
      // Check if model exists (optional, ffmpeg will throw if not)
      try {
        await fs.access(modelPath);
      } catch (e) {
        log.warn(`Модель Whisper не найдена по пути: ${modelPath}. FFmpeg может выдать ошибку, если модель не загружена.`);
      }

      // Escape paths for FFmpeg filter
      const escapedModelPath = modelPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");
      const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");

      return new Promise((resolve, reject) => {
        let processId = null;
        let currentCommandLine = '';

        const command = ffmpeg(videoPath)
          .noVideo() // -vn
          .audioFilters(`whisper=model='${escapedModelPath}':language=${language}:destination='${escapedSrtPath}':format=srt`)
          .outputOptions('-f null')
          .output('-') // -f null -
          .on('start', (commandLine) => {
            log.info('FFmpeg Whisper started: ' + commandLine);
            currentCommandLine = commandLine;
            processId = addProcess(commandLine, command);
            if (onProgress) onProgress(0);
          })
          .on('progress', (progress) => {
            if (onProgress && progress.percent !== undefined) {
              // Note: percent might not be completely accurate with whisper filter
              onProgress(Math.round(progress.percent));
            }
          })
          .on('end', () => {
            log.info('FFmpeg Whisper transcription finished successfully');
            if (processId) removeProcess(processId);
            if (onProgress) onProgress(100);
            resolve(srtPath);
          })
          .on('error', (err, stdout, stderr) => {
            log.error('FFmpeg Whisper error: ', err);
            log.error('FFmpeg stderr: ', stderr);
            if (processId) removeProcess(processId);
            reject(new Error(`FFmpeg Whisper Error: ${err.message}\n\nУбедитесь, что ваш FFmpeg >= 8.0 и собран с ключом --enable-whisper\n\nStderr: ${stderr}`));
          });

        command.run();
      });
    } catch (error) {
      log.error('Whisper Transcription failed:', error);
      throw error;
    }
  }
}

module.exports = WhisperService;
