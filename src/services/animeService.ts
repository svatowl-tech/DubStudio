export const searchAnime = async (query: string) => {
  try {
    const response = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=5`);
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error searching anime:', error);
    return [];
  }
};

export const getAnimeCharacters = async (malId: number) => {
  try {
    const response = await fetch(`https://api.jikan.moe/v4/anime/${malId}/characters`);
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching characters:', error);
    return [];
  }
};

export const getNextEpisodeDate = async (title: string): Promise<string | null> => {
  try {
    // Using Jikan API (MyAnimeList unofficial API)
    const response = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=1`);
    const data = await response.json();
    if (data.data && data.data.length > 0) {
      const anime = data.data[0];
      // This is a simplified approach, Jikan API might need more specific queries
      return anime.aired.string;
    }
    return null;
  } catch (error) {
    console.error('Error fetching anime date:', error);
    return null;
  }
};
