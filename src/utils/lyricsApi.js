/**
 * Integração com a API aberta do LRCLIB para busca e download de letras sincronizadas (.LRC)
 */

export async function fetchOnlineLyrics(title, artist, duration = null) {
  if (!title || !artist) return null;

  // Limpa o título de informações extras como (Taylor's Version), (Official Audio), feat, etc.
  const cleanTitle = title
    .replace(/\s*\(.*?version.*?\)/gi, '')
    .replace(/\s*\(.*?feat.*?\)/gi, '')
    .replace(/\s*\(.*?from.*?\)/gi, '')
    .replace(/\s*\[.*?\]/gi, '')
    .trim();

  const cleanArtist = artist.split(',')[0].trim(); // Pega o artista principal

  // Tentativa 1: Endpoint direto /api/get
  try {
    let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
    if (duration && duration > 0) {
      url += `&duration=${Math.round(duration)}`;
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'SoundWaveMusicPlayer/1.0 (https://github.com/soundwave)'
      }
    });

    if (res.ok) {
      const data = await res.json();
      if (data.syncedLyrics) {
        return {
          syncedLyrics: data.syncedLyrics,
          plainLyrics: data.plainLyrics || '',
          source: 'lrclib-direct'
        };
      }
    }
  } catch (err) {
    console.warn('Busca direta de letras falhou, tentando busca geral:', err);
  }

  // Tentativa 2: Endpoint de busca geral /api/search
  try {
    const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle + ' ' + cleanArtist)}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'SoundWaveMusicPlayer/1.0'
      }
    });

    if (searchRes.ok) {
      const results = await searchRes.json();
      if (Array.isArray(results) && results.length > 0) {
        // Encontra o primeiro resultado com letra sincronizada
        const match = results.find((r) => r.syncedLyrics);
        if (match) {
          return {
            syncedLyrics: match.syncedLyrics,
            plainLyrics: match.plainLyrics || '',
            source: 'lrclib-search'
          };
        }
      }
    }
  } catch (err) {
    console.warn('Busca geral de letras falhou:', err);
  }

  return null;
}

/**
 * Faz o download do arquivo .lrc para o computador do usuário
 */
export function downloadLrcFile(songTitle, artist, lrcContent) {
  if (!lrcContent) return;

  const sanitizedTitle = `${artist} - ${songTitle}`.replace(/[/\\?%*:|"<>]/g, '-');
  const filename = `${sanitizedTitle}.lrc`;

  const blob = new Blob([lrcContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
