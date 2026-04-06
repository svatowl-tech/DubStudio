const axios = require('axios');

const SHIKIMORI_BASE = 'https://shikimori.one/api';
const JIKAN_BASE = 'https://api.jikan.moe/v4';

const axiosInstance = axios.create({
  headers: {
    'User-Agent': 'AnimeDubManager'
  }
});

async function searchAnime(query) {
  try {
    const response = await axiosInstance.get(`${SHIKIMORI_BASE}/animes`, {
      params: {
        search: query,
        limit: 5
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error searching Shikimori in main process:', error.message);
    // Fallback to Jikan
    try {
      const response = await axiosInstance.get(`${JIKAN_BASE}/anime`, {
        params: {
          q: query,
          limit: 5
        }
      });
      return { source: 'mal', data: response.data.data };
    } catch (jikanError) {
      console.error('Error searching Jikan in main process:', jikanError.message);
      return [];
    }
  }
}

async function getAnimeDetails(id, source = 'shikimori') {
  let shikimoriData = null;
  if (source === 'shikimori') {
    try {
      const response = await axiosInstance.get(`${SHIKIMORI_BASE}/animes/${id}`);
      shikimoriData = response.data;
    } catch (error) {
      console.error('Error fetching Shikimori details in main process:', error.message);
    }
  }

  // Fallback to Jikan if needed
  if (!shikimoriData || !shikimoriData.description) {
    try {
      const malId = shikimoriData?.mal_id || id;
      const response = await axiosInstance.get(`${JIKAN_BASE}/anime/${malId}`);
      return { source: 'mal', data: response.data.data, shikimoriData };
    } catch (error) {
      console.error('Error fetching Jikan details in main process:', error.message);
    }
  }

  return { source: 'shikimori', data: shikimoriData };
}

async function getAnimeCharacters(id, source = 'shikimori') {
  let shikimoriChars = [];
  if (source === 'shikimori') {
    try {
      const response = await axiosInstance.get(`${SHIKIMORI_BASE}/animes/${id}/roles`);
      shikimoriChars = response.data;
    } catch (error) {
      console.error('Error fetching Shikimori characters in main process:', error.message);
    }
  }

  if (shikimoriChars.length === 0) {
    try {
      const response = await axiosInstance.get(`${JIKAN_BASE}/anime/${id}/characters`);
      return { source: 'mal', data: response.data.data };
    } catch (error) {
      console.error('Error fetching Jikan characters in main process:', error.message);
    }
  }

  return { source: 'shikimori', data: shikimoriChars };
}

async function getNextEpisodeDate(title) {
  try {
    const response = await axiosInstance.get(`${SHIKIMORI_BASE}/animes`, {
      params: {
        search: title,
        limit: 1
      }
    });
    if (response.data && response.data.length > 0) {
      return response.data[0].aired_on || null;
    }
  } catch (error) {
    console.error('Error fetching Shikimori date in main process:', error.message);
  }

  try {
    const response = await axiosInstance.get(`${JIKAN_BASE}/anime`, {
      params: {
        q: title,
        limit: 1
      }
    });
    if (response.data && response.data.data && response.data.data.length > 0) {
      return response.data.data[0].aired?.from?.split('T')[0] || null;
    }
  } catch (error) {
    console.error('Error fetching Jikan date in main process:', error.message);
  }

  return null;
}

module.exports = {
  searchAnime,
  getAnimeDetails,
  getAnimeCharacters,
  getNextEpisodeDate
};
