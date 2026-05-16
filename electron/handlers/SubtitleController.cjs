const { ipcMain } = require('electron');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const { 
  getRawSubtitles, 
  saveRawSubtitles, 
  saveTranslatedSubtitles, 
  splitSubsByActor, 
  splitSubsByDubber, 
  exportFullAssWithRoles, 
  extractSignsAss 
} = require('../services/subtitleService.cjs');

function registerSubtitleHandlers(getData) {
  ipcMain.handle('get-raw-subtitles', wrapIpcHandler(async (event, filePath) => {
    if (!filePath) throw new Error('Missing file path');
    return await getRawSubtitles(filePath);
  }));

  ipcMain.handle('save-raw-subtitles', wrapIpcHandler(async (event, { filePath, lines }) => {
    if (!filePath || !lines) throw new Error('Missing required parameters');
    return await saveRawSubtitles(filePath, lines);
  }));

  ipcMain.handle('split-subs-by-actor', wrapIpcHandler(async (event, { assFilePath, outputDirectory, options }) => {
    if (!assFilePath || !outputDirectory) throw new Error('Missing required parameters');
    return await splitSubsByActor(assFilePath, outputDirectory, options);
  }));

  ipcMain.handle('split-subs-by-dubber', wrapIpcHandler(async (event, { assFilePath, outputDirectory, assignments, options }) => {
    if (!assFilePath || !outputDirectory || !assignments) throw new Error('Missing required parameters');
    const participantsData = getData ? await getData('participants.json') : [];
    return await splitSubsByDubber(assFilePath, outputDirectory, assignments, participantsData, options);
  }));

  ipcMain.handle('export-full-ass-with-roles', wrapIpcHandler(async (event, { assFilePath, outputPath, assignments }) => {
    if (!assFilePath || !outputPath || !assignments) throw new Error('Missing required parameters');
    const participantsData = getData ? await getData('participants.json') : [];
    const savedPath = await exportFullAssWithRoles(assFilePath, outputPath, assignments, participantsData);
    return { path: savedPath };
  }));
  
  ipcMain.handle('extract-signs-ass', wrapIpcHandler(async (event, { filePath, outputPath }) => {
    if (!filePath || !outputPath) throw new Error('Missing required parameters');
    return await extractSignsAss(filePath, outputPath);
  }));
}

module.exports = { registerSubtitleHandlers };
