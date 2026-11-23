/**
 * Parser de arquivos e textos LRC (Synchronized Lyrics)
 */

export function parseLrc(lrcText) {
  if (!lrcText || typeof lrcText !== 'string') return [];
  
  const lines = lrcText.split(/\r?\n/);
  const parsed = [];
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Ignora metadados como [ar:Artista], [ti:Titulo], etc.
    if (/^\[(ti|ar|al|by|offset|length):/i.test(trimmed)) {
      continue;
    }

    const matches = [...trimmed.matchAll(timeRegex)];
    if (matches.length > 0) {
      // Remove todas as tags de timestamp para obter o texto
      const text = trimmed.replace(timeRegex, '').trim();
      
      for (const match of matches) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const millis = match[3] ? parseFloat('0.' + match[3]) : 0;
        const totalTime = minutes * 60 + seconds + millis;

        parsed.push({
          time: totalTime,
          text: text || '♪'
        });
      }
    }
  }

  // Ordena cronologicamente
  return parsed.sort((a, b) => a.time - b.time);
}

/**
 * Encontra o índice da linha da letra ativa para um dado tempo de reprodução
 */
export function getActiveLyricIndex(lyricsList, currentTime, offset = 0) {
  if (!lyricsList || lyricsList.length === 0) return -1;
  const targetTime = currentTime + offset;

  let activeIndex = -1;
  for (let i = 0; i < lyricsList.length; i++) {
    if (targetTime >= lyricsList[i].time) {
      activeIndex = i;
    } else {
      break;
    }
  }

  return activeIndex;
}

/**
 * Formata segundos no formato mm:ss
 */
export function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
