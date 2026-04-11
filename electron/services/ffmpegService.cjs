const ffmpeg = require('fluent-ffmpeg');
let ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');
const log = require('electron-log');

let activeProcesses = [];
let processIdCounter = 0;

function addProcess(commandLine) {
  const id = ++processIdCounter;
  activeProcesses.push({ id, commandLine });
  return id;
}

function removeProcess(id) {
  activeProcesses = activeProcesses.filter(p => p.id !== id);
}

function getActiveProcesses() {
  return activeProcesses;
}

// Настройка пути к FFmpeg для работы в составе Electron
// Если путь находится внутри app.asar, заменяем его на app.asar.unpacked
if (ffmpegPath) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  
  if (fs.existsSync(ffmpegPath)) {
    console.log('FFmpeg found at:', ffmpegPath);
    ffmpeg.setFfmpegPath(ffmpegPath);
  } else {
    log.error('FFmpeg NOT found at:', ffmpegPath, '- attempting to use system ffmpeg');
    // Fallback to system ffmpeg if static binary is missing
    try {
      const { execSync } = require('child_process');
      const systemFfmpeg = execSync('which ffmpeg').toString().trim();
      if (systemFfmpeg && fs.existsSync(systemFfmpeg)) {
        console.log('Using system FFmpeg at:', systemFfmpeg);
        ffmpeg.setFfmpegPath(systemFfmpeg);
      }
    } catch (e) {
      log.error('System FFmpeg not found in path');
    }
  }
}

/**
 * Функция для хардсаба субтитров в видеофайл (Main Process).
 * Использует fluent-ffmpeg для наложения .ass файла на видео.
 * 
 * @param videoPath Путь к исходному видеофайлу (например, .mp4)
 * @param finalAssPath Путь к финальному файлу субтитров (.ass)
 * @param outputPath Путь для сохранения готового видео
 * @param onProgress Коллбэк для отправки прогресса (в процентах) на фронтенд
 * @returns Promise с путем к готовому файлу
 */
function bakeSubtitles(videoPath, finalAssPath, outputPath, onProgress, onCommand, options = {}) {
  return new Promise((resolve, reject) => {
    // Normalize paths for Windows
    const vPath = path.resolve(videoPath);
    const aPath = path.resolve(finalAssPath);
    const oPath = path.resolve(outputPath);

    let currentCommandLine = '';
    let processId = null;
    let command = ffmpeg(vPath).outputOptions('-y');
    
    if (onCommand) onCommand(command);
    // Apply hardware acceleration if requested
    if (options.useNvenc) {
      command = command
        .inputOptions('-hwaccel cuda')
        .videoCodec('h264_nvenc')
        .outputOptions(`-gpu ${options.gpuIndex || 0}`)
        .outputOptions('-preset slow')
        .outputOptions(`-cq ${options.crf || 23}`);
    } else {
      command = command
        .videoCodec('libx264')
        .outputOptions(`-crf ${options.crf || 23}`)
        .outputOptions('-preset medium');
    }

    // FFmpeg 'ass' filter path escaping on Windows:
    // 1. Use forward slashes
    // 2. Escape colon with a single backslash (C\:...)
    // 3. Wrap in single quotes
    const escapedAssPath = aPath
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:')
      .replace(/'/g, "'\\''");

    command
      .videoFilters(`ass=filename='${escapedAssPath}'`)
      .output(oPath)
      .format('mp4')
      .outputOptions('-pix_fmt yuv420p')
      .outputOptions('-strict -2') // For compatibility with some AAC encoders
      .on('start', (commandLine) => {
        console.log('FFmpeg started with command: ' + commandLine);
        currentCommandLine = commandLine;
        processId = addProcess(commandLine);
        onProgress(0);
      })
      .on('progress', (progress) => {
        if (progress.percent !== undefined) {
          onProgress(Math.round(progress.percent));
        }
      })
      .on('end', () => {
        console.log('FFmpeg processing finished successfully');
        if (processId) removeProcess(processId);
        onProgress(100);
        resolve(oPath);
      })
      .on('error', (err, stdout, stderr) => {
        log.error('FFmpeg processing error: ', err);
        log.error('FFmpeg stderr: ', stderr);
        if (processId) removeProcess(processId);
        reject(new Error(`FFmpeg Error: ${err.message}\n\nCommand: ${currentCommandLine}\n\nStderr: ${stderr}`));
      })
      .run();
  });
}

/**
 * Функция для перекодирования видео в MP4 (Main Process).
 * 
 * @param videoPath Путь к исходному видеофайлу
 * @param outputPath Путь для сохранения готового видео
 * @param onProgress Коллбэк для отправки прогресса
 * @param options Опции (например, использование NVENC)
 * @returns Promise с путем к готовому файлу
 */
function transcodeToMp4(videoPath, outputPath, onProgress, onCommand, options = {}) {
  return new Promise((resolve, reject) => {
    const vPath = path.resolve(videoPath);
    const oPath = path.resolve(outputPath);

    let currentCommandLine = '';
    let processId = null;
    let command = ffmpeg(vPath).outputOptions('-y');

    if (onCommand) onCommand(command);
    if (options.useNvenc) {
      command = command
        .inputOptions('-hwaccel cuda')
        .videoCodec('h264_nvenc')
        .outputOptions(`-gpu ${options.gpuIndex || 0}`)
        .outputOptions('-preset slow')
        .outputOptions(`-cq ${options.crf || 23}`);
    } else {
      command = command
        .videoCodec('libx264')
        .outputOptions(`-crf ${options.crf || 23}`)
        .outputOptions('-preset medium');
    }

    command
      .output(oPath)
      .format('mp4')
      .audioCodec('aac')
      .outputOptions('-pix_fmt yuv420p')
      .outputOptions('-strict -2')
      .on('start', (commandLine) => {
        console.log('FFmpeg transcode started: ' + commandLine);
        currentCommandLine = commandLine;
        processId = addProcess(commandLine);
        onProgress(0);
      })
      .on('progress', (progress) => {
        if (progress.percent !== undefined) {
          onProgress(Math.round(progress.percent));
        }
      })
      .on('end', () => {
        console.log('FFmpeg transcode finished');
        if (processId) removeProcess(processId);
        onProgress(100);
        resolve(oPath);
      })
      .on('error', (err, stdout, stderr) => {
        log.error('FFmpeg transcode error: ', err);
        log.error('FFmpeg stderr: ', stderr);
        if (processId) removeProcess(processId);
        reject(new Error(`FFmpeg Transcode Error: ${err.message}\n\nCommand: ${currentCommandLine}\n\nStderr: ${stderr}`));
      })
      .run();
  });
}

function setCustomFfmpegPath(path) {
  if (path && fs.existsSync(path)) {
    ffmpeg.setFfmpegPath(path);
    console.log('Custom FFmpeg path set:', path);
    return true;
  }
  return false;
}

/**
 * Функция для сборки финального релиза (Main Process).
 * Объединяет видео, аудио от звукорежиссера и (опционально) субтитры надписей.
 * 
 * @param videoPath Путь к исходному видео
 * @param audioPath Путь к аудиофайлу от звукорежиссера
 * @param signsAssPath Путь к файлу субтитров с надписями (опционально)
 * @param outputPath Путь для сохранения результата
 * @param onProgress Коллбэк для прогресса
 * @returns Promise с путем к готовому файлу
 */
function muxRelease(videoPath, audioPath, signsAssPath, outputPath, onProgress, onCommand) {
  return new Promise((resolve, reject) => {
    const vPath = path.resolve(videoPath);
    const aPath = path.resolve(audioPath);
    const oPath = path.resolve(outputPath);

    let currentCommandLine = '';
    let processId = null;
    let command = ffmpeg(vPath).input(aPath).outputOptions('-y');

    if (onCommand) onCommand(command);
    // Если есть надписи, накладываем их хардсабом (требует перекодирования видео)
    if (signsAssPath && fs.existsSync(signsAssPath)) {
      const sPath = path.resolve(signsAssPath);
      const escapedAssPath = sPath
        .replace(/\\/g, '/')
        .replace(/:/g, '\\:')
        .replace(/'/g, "'\\''");

      command = command
        .videoFilters(`ass=filename='${escapedAssPath}'`)
        .videoCodec('libx264')
        .outputOptions('-crf 18')
        .outputOptions('-preset slow');
    } else {
      // Если надписей нет, просто копируем видеопоток для скорости и качества
      command = command.videoCodec('copy');
    }

    command
      .audioCodec('aac')
      .outputOptions('-pix_fmt yuv420p')
      .outputOptions('-map 0:v:0') // Видео из первого входа
      .outputOptions('-map 1:a:0') // Аудио из второго входа
      .on('start', (commandLine) => {
        console.log('Muxing started: ' + commandLine);
        currentCommandLine = commandLine;
        processId = addProcess(commandLine);
        onProgress(0);
      })
      .on('progress', (progress) => {
        if (progress.percent !== undefined) {
          onProgress(Math.round(progress.percent));
        }
      })
      .on('end', () => {
        console.log('Muxing finished');
        if (processId) removeProcess(processId);
        onProgress(100);
        resolve(oPath);
      })
      .on('error', (err, stdout, stderr) => {
        log.error('Muxing error: ', err);
        log.error('FFmpeg stderr: ', stderr);
        if (processId) removeProcess(processId);
        reject(new Error(`Muxing Error: ${err.message}\n\nCommand: ${currentCommandLine}\n\nStderr: ${stderr}`));
      })
      .save(oPath);
  });
}

/**
 * Функция для извлечения кадра из видео (Main Process).
 * 
 * @param videoPath Путь к исходному видеофайлу
 * @param timestamp Время в секундах или формат 'HH:MM:SS'
 * @param outputPath Путь для сохранения изображения
 * @returns Promise с путем к готовому файлу
 */
function takeScreenshot(videoPath, timestamp, outputPath) {
  return new Promise((resolve, reject) => {
    const vPath = path.resolve(videoPath);
    const oPath = path.resolve(outputPath);

    let processId = null;

    ffmpeg(vPath)
      .seekInput(timestamp)
      .frames(1)
      .output(oPath)
      .on('start', (commandLine) => {
        processId = addProcess(commandLine);
      })
      .on('end', () => {
        if (processId) removeProcess(processId);
        resolve(oPath);
      })
      .on('error', (err) => {
        if (processId) removeProcess(processId);
        reject(err);
      })
      .run();
  });
}

function getVideoMetadata(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata);
    });
  });
}

function extractSubtitleTrack(videoPath, outputPath, streamIndex) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions(`-map 0:${streamIndex}`)
      .save(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err));
  });
}

module.exports = {
  bakeSubtitles,
  transcodeToMp4,
  muxRelease,
  takeScreenshot,
  getVideoMetadata,
  extractSubtitleTrack,
  setCustomFfmpegPath,
  getActiveProcesses
};
