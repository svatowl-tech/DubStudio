const axios = require('axios');

const BASE_URL = process.env.TRANSLATE_API_URL || 'https://translate.googleapis.com'; // Placeholder, user needs to set this

async function translateText(text, sourceLang, destLang) {
  try {
    const response = await axios.get(`${BASE_URL}/translate`, {
      params: {
        sl: sourceLang,
        dl: destLang,
        text: text
      }
    });
    return response.data;
  } catch (error) {
    console.error("Translation API error:", error);
    throw error;
  }
}

module.exports = { translateText };
