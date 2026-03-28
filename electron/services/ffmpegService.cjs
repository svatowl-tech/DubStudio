const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

// Настройка пути к FFmpeg для работы в составе Electron
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
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
function bakeSubtitles(videoPath, finalAssPath, outputPath, onProgress, options = {}) {
  return new Promise((resolve, reject) => {
    let command = ffmpeg(videoPath);
    
    // Apply hardware acceleration if requested
    if (options.useNvenc) {
      command = command
        .inputOptions('-hwaccel cuda')
        .videoCodec('h264_nvenc')
        .outputOptions(`-gpu ${options.gpuIndex || 0}`);
    } else {
      command = command.videoCodec('libx264');
    }

    command
      // Добавляем видеофильтр для наложения ASS субтитров
      // Путь к файлу субтитров нужно экранировать для FFmpeg
      .videoFilters(`ass='${finalAssPath.replace(/\\/g, '/')}'`)
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('FFmpeg started with command: ' + commandLine);
        onProgress(0);
      })
      .on('progress', (progress) => {
        // progress.percent может быть undefined в начале
        if (progress.percent !== undefined) {
          onProgress(Math.round(progress.percent));
        }
      })
      .on('end', () => {
        console.log('FFmpeg processing finished successfully');
        onProgress(100);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('FFmpeg processing error: ', err);
        reject(err);
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
function transcodeToMp4(videoPath, outputPath, onProgress, options = {}) {
  return new Promise((resolve, reject) => {
    let command = ffmpeg(videoPath);

    if (options.useNvenc) {
      command = command
        .inputOptions('-hwaccel cuda')
        .videoCodec('h264_nvenc')
        .outputOptions(`-gpu ${options.gpuIndex || 0}`);
    } else {
      command = command.videoCodec('libx264');
    }

    command
      .output(outputPath)
      .audioCodec('aac')
      .on('start', (commandLine) => {
        console.log('FFmpeg transcode started: ' + commandLine);
        onProgress(0);
      })
      .on('progress', (progress) => {
        if (progress.percent !== undefined) {
          onProgress(Math.round(progress.percent));
        }
      })
      .on('end', () => {
        console.log('FFmpeg transcode finished');
        onProgress(100);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('FFmpeg transcode error: ', err);
        reject(err);
      })
      .run();
  });
}

module.exports = {
  bakeSubtitles,
  transcodeToMp4
};
