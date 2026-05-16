const { exec } = require('child_process');
const path = require('path');
const fs = require('fs/promises');
const log = require('electron-log');

class WhisperService {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.modelsDir = path.join(baseDir, 'models', 'whisper');
    this.binPath = process.platform === 'win32' ? 'whisper.exe' : 'whisper'; // В реальном приложении сюда кладется бинарник whisper.cpp
  }

  async ensureFolder() {
    await fs.mkdir(this.modelsDir, { recursive: true });
  }

  /**
   * Транскрибация видео файла
   * @param {string} videoPath - Путь к видео
   * @param {string} language - Код языка (например, 'ja' или 'ru')
   * @param {function} onProgress - Коллбэк для прогресса
   */
  async transcribe(videoPath, language = 'ja', onProgress) {
    try {
      await this.ensureFolder();
      const outputDir = path.dirname(videoPath);
      const fileName = path.basename(videoPath, path.extname(videoPath));
      const srtPath = path.join(outputDir, `${fileName}.srt`);

      log.info(`Whisper: Starting transcription for ${videoPath} [${language}]`);
      
      // В среде AI Studio мы не можем запустить тяжелый whisper.cpp без предустановленных бинарников.
      // Поэтому мы подготовим архитектуру: бинарник вызывается через exec.
      
      // Пример команды (зависит от того, как упакован whisper.cpp):
      // main -m models/ggml-base.bin -f input.wav -osrt
      
      // Для демонстрации и работы в облаке, мы можем использовать заглушку или API, 
      // но для полноценного десктопа тут будет вызов локального процесса.
      
      return srtPath;
    } catch (error) {
      log.error('Whisper Transcription failed:', error);
      throw error;
    }
  }
}

module.exports = WhisperService;
