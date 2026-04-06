const { ipcMain } = require('electron');
const { 
  getRawSubtitles, 
  saveRawSubtitles, 
  saveTranslatedSubtitles, 
  splitSubsByActor, 
  splitSubsByDubber, 
  exportFullAssWithRoles, 
  extractSignsAss 
} = require('../services/subtitleService.cjs');

function registerSubtitleHandlers() {
  ipcMain.handle('get-raw-subtitles', async (event, filePath) => {
    return await getRawSubtitles(filePath);
  });

  ipcMain.handle('save-raw-subtitles', async (event, { filePath, lines }) => {
    return await saveRawSubtitles(filePath, lines);
  });

  ipcMain.handle('split-subs-by-actor', async (event, { filePath, outputDir }) => {
    return await splitSubsByActor(filePath, outputDir);
  });

  ipcMain.handle('split-subs-by-dubber', async (event, { filePath, outputDir, assignments }) => {
    return await splitSubsByDubber(filePath, outputDir, assignments);
  });

  ipcMain.handle('export-full-ass', async (event, { episode, targetPath }) => {
    return await exportFullAssWithRoles(episode, targetPath);
  });
  
  ipcMain.handle('extract-signs-ass', async (event, { filePath, outputPath }) => {
    return await extractSignsAss(filePath, outputPath);
  });
}

module.exports = { registerSubtitleHandlers };
