const SHIKIMORI_BASE = 'https://shikimori.one/api';
const JIKAN_BASE = 'https://api.jikan.moe/v4';

const isShikimoriPlaceholder = (url: string | undefined | null) => {
  if (!url) return true;
  const lowerUrl = url.toLowerCase();
  return lowerUrl.includes('missing_original.png') || 
         lowerUrl.includes('missing_preview.png') || 
         lowerUrl.includes('missing.png') || 
         lowerUrl.includes('main.png') ||
         lowerUrl.includes('missing_original.jpg') ||
         lowerUrl.includes('missing_preview.jpg') ||
         lowerUrl.includes('missing.jpg');
};

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
    return shikimoriData.map((anime: any) => {
      const isPlaceholder = isShikimoriPlaceholder(anime.image?.original);
      return {
        id: anime.id,
        mal_id: anime.id, // Shikimori ID is used here, but we'll try to find real mal_id if needed
        title: anime.russian || anime.name,
        original_title: anime.name, // Romaji
        image: anime.image && !isPlaceholder ? `https://shikimori.one${anime.image.original}` : '',
        images: {
          jpg: {
            image_url: anime.image && !isPlaceholder ? `https://shikimori.one${anime.image.original}` : '',
            small_image_url: anime.image && !isPlaceholder ? `https://shikimori.one${anime.image.preview}` : '',
            large_image_url: anime.image && !isPlaceholder ? `https://shikimori.one${anime.image.original}` : '',
          }
        },
        status: anime.status === 'ongoing' ? 'Currently Airing' : anime.status === 'released' ? 'Finished Airing' : anime.status,
        source: 'shikimori'
      };
    });
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

  // If we have Shikimori data but it's missing description or other info, or if we don't have it at all, or if image is placeholder
  const isPlaceholder = shikimoriData?.image?.original ? isShikimoriPlaceholder(shikimoriData.image.original) : true;
  
  if (!shikimoriData || !shikimoriData.description || !shikimoriData.image || isPlaceholder) {
    try {
      // If we have shikimoriData, we might have mal_id. If not, we use the provided id.
      const malId = shikimoriData?.mal_id || id;
      const response = await fetch(`${JIKAN_BASE}/anime/${malId}`);
      const jikanData = await response.json();
      
      if (jikanData && jikanData.data) {
        const anime = jikanData.data;
        // Merge or return Jikan data
        const shikimoriImageOriginal = shikimoriData?.image?.original;
        const shikimoriImagePreview = shikimoriData?.image?.preview;
        
        const finalImageOriginal = (shikimoriImageOriginal && !isShikimoriPlaceholder(shikimoriImageOriginal)) 
          ? `https://shikimori.one${shikimoriImageOriginal}` 
          : (anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url);
          
        const finalImagePreview = (shikimoriImagePreview && !isShikimoriPlaceholder(shikimoriImagePreview)) 
          ? `https://shikimori.one${shikimoriImagePreview}` 
          : anime.images?.jpg?.small_image_url;

        return {
          id: shikimoriData?.id || anime.mal_id,
          name: anime.title, // Romaji
          russian: shikimoriData?.russian || anime.title_english || anime.title,
          image: {
            original: finalImageOriginal,
            preview: finalImagePreview
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
            image: role.character.image && !isShikimoriPlaceholder(role.character.image.original) 
              ? `https://shikimori.one${role.character.image.original}` 
              : ''
          }));
      }
    } catch (error) {
      console.error('Error fetching Shikimori characters:', error);
    }
  }

  // If Shikimori returned no characters or some have placeholder images, try Jikan to fill the gaps
  if (shikimoriChars.length === 0 || shikimoriChars.some(c => !c.image)) {
    try {
      // We need a mal_id for Jikan. 
      const response = await fetch(`${JIKAN_BASE}/anime/${id}/characters`);
      const data = await response.json();
      if (data && data.data) {
        const jikanChars = data.data;
        
        if (shikimoriChars.length === 0) {
          return jikanChars.map((item: any) => ({
            id: item.character.mal_id,
            name: item.character.name,
            original_name: item.character.name,
            image: item.character.images?.jpg?.image_url || ''
          }));
        } else {
          // Merge images from Jikan into Shikimori characters where they are missing
          return shikimoriChars.map(sc => {
            if (!sc.image) {
              const match = jikanChars.find((jc: any) => 
                jc.character.name.toLowerCase() === sc.original_name.toLowerCase() ||
                jc.character.name.toLowerCase().includes(sc.original_name.toLowerCase()) ||
                sc.original_name.toLowerCase().includes(jc.character.name.toLowerCase())
              );
              if (match) {
                return { ...sc, image: match.character.images?.jpg?.image_url || '' };
              }
            }
            return sc;
          });
        }
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
