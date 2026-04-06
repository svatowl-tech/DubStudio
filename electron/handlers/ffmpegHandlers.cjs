const { ipcMain } = require('electron');
const { bakeSubtitles, transcodeToMp4, muxRelease, takeScreenshot, getVideoMetadata, setCustomFfmpegPath, getActiveProcesses } = require('../services/ffmpegService.cjs');

function registerFfmpegHandlers(getData, mainWindow) {
  ipcMain.handle('bake-subtitles', async (event, { videoPath, finalAssPath, outputPath }) => {
    const config = await getData('config.json');
    const baseDir = config.baseDir || require('electron').app.getPath('userData');
    
    const absVideoPath = require('path').isAbsolute(videoPath) ? videoPath : require('path').join(baseDir, videoPath);
    const absAssPath = require('path').isAbsolute(finalAssPath) ? finalAssPath : require('path').join(baseDir, finalAssPath);
    const absOutputPath = require('path').isAbsolute(outputPath) ? outputPath : require('path').join(baseDir, outputPath);

    require('fs/promises').mkdir(require('path').dirname(absOutputPath), { recursive: true });

    const options = {
      useNvenc: config.useNvenc,
      gpuIndex: config.gpuIndex
    };

    return await bakeSubtitles(absVideoPath, absAssPath, absOutputPath, (percent) => {
      if (mainWindow) {
        mainWindow.webContents.send('ffmpeg-progress', percent);
      }
    }, options);
  });

  ipcMain.handle('transcode-video', async (event, { videoPath, outputPath }) => {
    const config = await getData('config.json');
    const options = {
      useNvenc: config.useNvenc,
      gpuIndex: config.gpuIndex
    };
    return await transcodeToMp4(videoPath, outputPath, (percent) => {
      if (mainWindow) {
        mainWindow.webContents.send('ffmpeg-progress', percent);
      }
    }, options);
  });
  
  // ... остальные ffmpeg обработчики ...
}

module.exports = { registerFfmpegHandlers };
