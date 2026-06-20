const { ipcMain, app } = require('electron');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const DiarizationService = require('../services/DiarizationService.cjs');
const log = require('electron-log');

let diarizationService = null;

function getDiarizationService() {
  if (!diarizationService) {
    diarizationService = DiarizationService.getInstance(app.getPath('userData'));
  }
  return diarizationService;
}

function registerDiarizationHandlers() {
  ipcMain.handle('run-diarization', wrapIpcHandler(async (event, { videoPath, subtitleLines, expectedSpeakersCount }) => {
    log.info(`IPC: starting diarization for track: ${videoPath}, lines index size: ${subtitleLines?.length || 0}`);
    const service = getDiarizationService();
    
    return await service.diarize(videoPath, subtitleLines, expectedSpeakersCount, (progress) => {
      try {
        event.sender.send('diarization-step', progress);
      } catch (err) {
        log.warn('Could not emit diarization-step progress:', err.message);
      }
    });
  }));

  ipcMain.handle('load-diarization-model', wrapIpcHandler(async (event) => {
    log.info('IPC: requesting model loading for pyannote-segmentation-3.0');
    const service = getDiarizationService();
    await service.ensureFolder();
    return await service.loadModel((percent) => {
      try {
        event.sender.send('diarization-download-progress', { percent });
      } catch (err) {
        log.warn('Could not emit diarization-download-progress:', err.message);
      }
    });
  }));

  ipcMain.handle('check-diarization-status', wrapIpcHandler(async () => {
    const service = getDiarizationService();
    return {
      isLoaded: !!(service.model && service.processor),
      isLoading: service.isLoading,
      modelName: service.modelName,
      downloadProgress: service.downloadProgress,
      loadingStatus: service.loadingStatus
    };
  }));
}

module.exports = { registerDiarizationHandlers };
