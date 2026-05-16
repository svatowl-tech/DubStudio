const axios = require('axios');
const { ipcMain } = require('electron');
const log = require('electron-log');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const { translateText } = require('../services/translateService.cjs');
const { searchAnime, getAnimeDetails, getAnimeCharacters, getNextEpisodeDate } = require('../services/animeApiService.cjs');
const AISubtitleProcessor = require('../services/AISubtitleProcessor.cjs');

function registerApiHandlers(getData) {
  ipcMain.handle('translate-text', wrapIpcHandler(async (event, { text, sourceLang, destLang }) => {
    if (!text) throw new Error('Missing text to translate');
    return await translateText(text, sourceLang, destLang);
  }));

  ipcMain.handle('search-anime', wrapIpcHandler(async (event, { query }) => {
    if (!query) throw new Error('Missing search query');
    return await searchAnime(query);
  }));

  ipcMain.handle('get-anime-details', wrapIpcHandler(async (event, { id, source }) => {
    if (!id || !source) throw new Error('Missing required parameters');
    return await getAnimeDetails(id, source);
  }));

  ipcMain.handle('get-anime-characters', wrapIpcHandler(async (event, { id, source }) => {
    if (!id || !source) throw new Error('Missing required parameters');
    return await getAnimeCharacters(id, source);
  }));

  ipcMain.handle('get-next-episode-date', wrapIpcHandler(async (event, { title }) => {
    if (!title) throw new Error('Missing anime title');
    return await getNextEpisodeDate(title);
  }));

  ipcMain.handle('ai-process-subtitles', wrapIpcHandler(async (event, { lines, glossary }) => {
    if (!lines || !Array.isArray(lines)) throw new Error('Missing or invalid subtitle lines');
    log.info(`AI processing started for ${lines.length} lines.`);
    
    const config = await getData('config.json');
    const provider = config?.aiProvider || 'openrouter';
    
    let apiKey = config?.openRouterKey;
    let model = config?.aiModel || 'google/gemini-2.0-flash-lite-preview-02-05:free';
    let baseUrl = null;

    if (provider === 'ollama') {
      apiKey = 'ollama'; // Dummy key for internal checks
      model = config?.ollamaModel || 'llama3';
      const ollamaUrl = config?.ollamaUrl || 'http://localhost:11434';
      baseUrl = `${ollamaUrl}/v1/chat/completions`;
    }
    
    if (provider === 'openrouter' && !apiKey) {
      log.warn('AI processing: OpenRouter selected but no API key provided. Falling back to Google Translate.');
      // No API key - immediately fallback to Google Translate
      const { translateText } = require('../services/translateService.cjs');
      const processed = [];
      for (const line of lines) {
        try {
          const result = await translateText(line.text, 'ja', 'ru');
          processed.push({ ...line, text: result['destination-text'] });
        } catch (e) {
          processed.push({ ...line });
        }
      }
      return processed;
    }

    try {
      const processor = new AISubtitleProcessor(apiKey, glossary || {}, model, baseUrl);
      return await processor.processSubtitles(lines);
    } catch (error) {
      log.warn('AI Translation failed, using fallback Google Translate:', error.message);
      
      const { translateText } = require('../services/translateService.cjs');
      const processed = [];
      
      // Fallback: translate line by line
      for (const line of lines) {
        try {
          const result = await translateText(line.text, 'ja', 'ru');
          processed.push({ ...line, text: result['destination-text'] });
        } catch (err) {
          log.error('Fallback translation failed for line:', line.text, err.message);
          processed.push({ ...line }); // Keep original if even fallback fails
        }
      }
      return processed;
    }
  }));

  ipcMain.handle('save-translated-subtitles', wrapIpcHandler(async (event, { assFilePath, translatedLines }) => {
    if (!assFilePath || !translatedLines) throw new Error('Missing required parameters');
    const { saveTranslatedSubtitles } = require('../services/subtitleService.cjs');
    return await saveTranslatedSubtitles(assFilePath, translatedLines);
  }));

  ipcMain.handle('get-ollama-models', wrapIpcHandler(async (event, { url }) => {
    const ollamaUrl = url || 'http://localhost:11434';
    log.info(`Fetching Ollama models from ${ollamaUrl}...`);
    try {
      const response = await axios.get(`${ollamaUrl}/api/tags`);
      return response.data?.models || [];
    } catch (error) {
      log.error('Failed to fetch Ollama models:', error.message);
      return [];
    }
  }));
}

module.exports = { registerApiHandlers };
