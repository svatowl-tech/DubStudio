const axios = require('axios');

/**
 * Сервис для перевода текста через внешние API (Main Process).
 * Использует стандартные методы перевода.
 */
async function translateText(text, sourceLang, destLang) {
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
      return {
        "source-text": text,
        "destination-text": translatedText
      };
    }

    throw new Error('Некорректный формат ответа от сервиса перевода');
  } catch (error) {
    console.error("Translation API error:", error);
    throw error;
  }
}

module.exports = { translateText };
