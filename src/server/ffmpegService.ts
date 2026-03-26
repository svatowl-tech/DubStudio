import ffmpeg from 'fluent-ffmpeg';

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
export function bakeSubtitles(
  videoPath: string,
  finalAssPath: string,
  outputPath: string,
  onProgress: (percent: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    // В реальном приложении здесь можно указать путь к бинарнику ffmpeg,
    // если он поставляется вместе с приложением (например, через ffmpeg-static)
    // ffmpeg.setFfmpegPath(require('ffmpeg-static'));

    ffmpeg(videoPath)
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
