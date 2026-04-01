const SHIKIMORI_BASE = 'https://shikimori.one/api';
const JIKAN_BASE = 'https://api.jikan.moe/v4';

export const searchAnime = async (query: string) => {
  let shikimoriData = [];
  try {
    const response = await fetch(`${SHIKIMORI_BASE}/animes?search=${encodeURIComponent(query)}&limit=5`, {
      headers: { 'User-Agent': 'AnimeDubManager' }
    });
    shikimoriData = await response.json();
  } catch (error) {
    console.error('Error searching Shikimori:', error);
  }

  if (Array.isArray(shikimoriData) && shikimoriData.length > 0) {
    return shikimoriData.map((anime: any) => ({
      id: anime.id,
      mal_id: anime.id, // Shikimori ID is used here, but we'll try to find real mal_id if needed
      title: anime.russian || anime.name,
      original_title: anime.name, // Romaji
      image: anime.image ? `https://shikimori.one${anime.image.original}` : '',
      images: {
        jpg: {
          image_url: anime.image ? `https://shikimori.one${anime.image.original}` : '',
          small_image_url: anime.image ? `https://shikimori.one${anime.image.preview}` : '',
          large_image_url: anime.image ? `https://shikimori.one${anime.image.original}` : '',
        }
      },
      status: anime.status === 'ongoing' ? 'Currently Airing' : anime.status === 'released' ? 'Finished Airing' : anime.status,
      source: 'shikimori'
    }));
  }

  // Fallback to Jikan (MAL)
  try {
    const response = await fetch(`${JIKAN_BASE}/anime?q=${encodeURIComponent(query)}&limit=5`);
    const jikanData = await response.json();
    if (jikanData && jikanData.data) {
      return jikanData.data.map((anime: any) => ({
        id: anime.mal_id,
        mal_id: anime.mal_id,
        title: anime.title_english || anime.title,
        original_title: anime.title, // Romaji
        image: anime.images?.jpg?.image_url || '',
        images: anime.images,
        status: anime.status,
        source: 'mal'
      }));
    }
  } catch (error) {
    console.error('Error searching Jikan:', error);
  }

  return [];
};

export const getAnimeDetails = async (id: number, source: string = 'shikimori') => {
  let shikimoriData: any = null;
  if (source === 'shikimori') {
    try {
      const response = await fetch(`${SHIKIMORI_BASE}/animes/${id}`, {
        headers: { 'User-Agent': 'AnimeDubManager' }
      });
      shikimoriData = await response.json();
    } catch (error) {
      console.error('Error fetching Shikimori details:', error);
    }
  }

  // If we have Shikimori data but it's missing description or other info, or if we don't have it at all
  if (!shikimoriData || !shikimoriData.description || !shikimoriData.image) {
    try {
      // If we have shikimoriData, we might have mal_id. If not, we use the provided id.
      const malId = shikimoriData?.mal_id || id;
      const response = await fetch(`${JIKAN_BASE}/anime/${malId}`);
      const jikanData = await response.json();
      
      if (jikanData && jikanData.data) {
        const anime = jikanData.data;
        // Merge or return Jikan data
        return {
          id: shikimoriData?.id || anime.mal_id,
          name: anime.title, // Romaji
          russian: shikimoriData?.russian || anime.title_english || anime.title,
          image: {
            original: shikimoriData?.image?.original ? `https://shikimori.one${shikimoriData.image.original}` : (anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url),
            preview: shikimoriData?.image?.preview ? `https://shikimori.one${shikimoriData.image.preview}` : anime.images?.jpg?.small_image_url
          },
          status: shikimoriData?.status || anime.status,
          episodes: shikimoriData?.episodes || anime.episodes,
          aired_on: shikimoriData?.aired_on || anime.aired?.from?.split('T')[0],
          description: shikimoriData?.description || anime.synopsis,
          source: shikimoriData ? 'shikimori+mal' : 'mal'
        };
      }
    } catch (error) {
      console.error('Error fetching Jikan details:', error);
    }
  }

  return shikimoriData;
};

export const getAnimeCharacters = async (id: number, source: string = 'shikimori') => {
  let shikimoriChars: any[] = [];
  if (source === 'shikimori') {
    try {
      const response = await fetch(`${SHIKIMORI_BASE}/animes/${id}/roles`, {
        headers: { 'User-Agent': 'AnimeDubManager' }
      });
      const data = await response.json();
      if (Array.isArray(data)) {
        shikimoriChars = data
          .filter((role: any) => role && role.character)
          .map((role: any) => ({
            id: role.character.id,
            name: role.character.russian || role.character.name,
            original_name: role.character.name,
            image: role.character.image ? `https://shikimori.one${role.character.image.original}` : ''
          }));
      }
    } catch (error) {
      console.error('Error fetching Shikimori characters:', error);
    }
  }

  // If Shikimori returned no characters, try Jikan
  if (shikimoriChars.length === 0) {
    try {
      const response = await fetch(`${JIKAN_BASE}/anime/${id}/characters`);
      const data = await response.json();
      if (data && data.data) {
        return data.data.map((item: any) => ({
          id: item.character.mal_id,
          name: item.character.name,
          original_name: item.character.name,
          image: item.character.images?.jpg?.image_url || ''
        }));
      }
    } catch (error) {
      console.error('Error fetching Jikan characters:', error);
    }
  }
  return shikimoriChars;
};

export const getNextEpisodeDate = async (title: string): Promise<string | null> => {
  try {
    const response = await fetch(`${SHIKIMORI_BASE}/animes?search=${encodeURIComponent(title)}&limit=1`, {
      headers: { 'User-Agent': 'AnimeDubManager' }
    });
    const data = await response.json();
    if (data && data.length > 0) {
      const anime = data[0];
      if (anime.aired_on) return anime.aired_on;
    }
  } catch (error) {
    console.error('Error fetching Shikimori date:', error);
  }

  // Fallback to Jikan
  try {
    const response = await fetch(`${JIKAN_BASE}/anime?q=${encodeURIComponent(title)}&limit=1`);
    const data = await response.json();
    if (data && data.data && data.data.length > 0) {
      const anime = data.data[0];
      return anime.aired?.from?.split('T')[0] || null;
    }
  } catch (error) {
    console.error('Error fetching Jikan date:', error);
  }
  return null;
};
