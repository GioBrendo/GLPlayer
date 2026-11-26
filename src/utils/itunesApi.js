/**
 * Integração com a API aberta do iTunes Search para catálogo e capas em alta resolução
 */

/** Texto de busca usado para achar a faixa no YouTube (mesmo formato no cliente e no servidor). */
export function buildTrackQuery(title, artist) {
  return [title, artist].filter(Boolean).join(' ').trim();
}

export async function searchOnlineTracks(query, limit = 25) {
  if (!query || query.trim().length === 0) return [];

  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query.trim())}&entity=song&limit=${limit}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      throw new Error(`Erro na busca: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.results) return [];

    return data.results
      .filter((item) => item.trackName)
      .map((item) => ({
        id: 'itunes-' + item.trackId,
        title: item.trackName,
        artist: item.artistName || '',
        album: item.collectionName || 'Single / Álbum',
        cover: item.artworkUrl100 ? item.artworkUrl100.replace('100x100', '600x600') : '',
        audioUrl: item.previewUrl,
        duration: Math.round(item.trackTimeMillis / 1000) || 210, // Duração real completa da música!
        hasLyrics: false,
        lyricsLrc: '',
        genre: item.primaryGenreName || 'Pop',
        releaseYear: item.releaseDate ? item.releaseDate.substring(0, 4) : ''
      }));
  } catch (err) {
    console.error('Falha ao buscar músicas online:', err);
    return [];
  }
}

/**
 * Resolve o ID do YouTube para tocar a música completa
 */
export async function resolveYouTubeId(title, artist, badId = null) {
  const query = buildTrackQuery(title, artist);
  if (!query) return null;

  try {
    let url = `/api/yt-search?q=${encodeURIComponent(query)}`;
    if (badId) {
      url += `&badId=${encodeURIComponent(badId)}`;
    }
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      return data.videoId || null;
    }
  } catch (err) {
    console.warn('Falha ao resolver vídeo no YouTube:', err);
  }
  return null;
}
