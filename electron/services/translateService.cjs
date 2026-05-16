const axios = require('axios');
const log = require('electron-log');

/**
 * Сервис для перевода текста через внешние API (Main Process).
 * Использует стандартные методы перевода.
 */
async function translateText(text, sourceLang, destLang) {
  log.info(`Translating text from ${sourceLang} to ${destLang}...`);
  try {
    // Используем бесплатный API Google Translate (через скрипт или прокси)
    // В данном случае используем базовый URL, который был ранее
    const BASE_URL = process.env.TRANSLATE_API_URL || 'https://translate.googleapis.com/translate_a/single';
    
    const response = await axios.get(BASE_URL, {
      params: {
        client: 'gtx',
        sl: sourceLang,
        tl: destLang,
        dt: 't',
        q: text
      }
    });

    // Формат ответа Google Translate: [[["translated_text", "source_text", ...]]]
    if (response.data && response.data[0] && response.data[0][0] && response.data[0][0][0]) {
      const translatedText = response.data[0][0][0];
      log.info(`Translation successful: ${text.substring(0, 20)}... -> ${translatedText.substring(0, 20)}...`);
      return {
        "source-text": text,
        "destination-text": translatedText
      };
    }

    log.error('Translation error: Invalid response format', response.data);
    throw new Error('Некорректный формат ответа от сервиса перевода');
  } catch (error) {
    log.error("Translation API error:", error.message);
    throw error;
  }
}

module.exports = { translateText };
