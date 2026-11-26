/**
 * Parser de arquivos e textos LRC (Synchronized Lyrics)
 */

// [mm:ss], [mm:ss.xx], [mm:ss.xxx] e a variante [mm:ss:xx]
const TIME_TAG_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const METADATA_RE = /^\[(ti|ar|al|au|by|length|re|ve|tool|#):/i;
const OFFSET_RE = /^\[offset:\s*([+-]?\d+)\s*\]$/i;

/**
 * Verifica se o texto contém ao menos uma linha sincronizada com timestamp LRC.
 */
export function isSyncedLrc(lrcText) {
  return parseLrc(lrcText).length > 0;
}

/**
 * Faz o parse de letras simples (sem timestamps), ignorando tags de metadados LRC
 * e preservando quebras de estrofe sem linhas vazias consecutivas.
 */
export function parsePlainLyrics(text) {
  if (!text || typeof text !== 'string') return [];

  const rawLines = text.split(/\r?\n/);
  const lines = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (lines.length > 0 && lines[lines.length - 1] !== '') {
        lines.push('');
      }
      continue;
    }

    if (OFFSET_RE.test(trimmed) || METADATA_RE.test(trimmed)) {
      continue;
    }

    const clean = trimmed.replace(TIME_TAG_RE, '').trim();
    if (!clean) {
      if (lines.length > 0 && lines[lines.length - 1] !== '') {
        lines.push('');
      }
      continue;
    }

    lines.push(clean);
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines;
}

export function parseLrc(lrcText) {
  if (!lrcText || typeof lrcText !== 'string') return [];

  const lines = lrcText.split(/\r?\n/);
  const parsed = [];
  let offsetSeconds = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // [offset:+/-ms] — valor positivo faz a letra aparecer antes
    const offsetMatch = trimmed.match(OFFSET_RE);
    if (offsetMatch) {
      offsetSeconds = parseInt(offsetMatch[1], 10) / 1000;
      continue;
    }

    // Ignora metadados como [ar:Artista], [ti:Titulo], etc.
    if (METADATA_RE.test(trimmed)) {
      continue;
    }

    const matches = [...trimmed.matchAll(TIME_TAG_RE)];
    if (matches.length > 0) {
      // Remove todas as tags de timestamp para obter o texto
      const text = trimmed.replace(TIME_TAG_RE, '').trim();

      for (const match of matches) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const fraction = match[3] ? parseFloat('0.' + match[3]) : 0;

        parsed.push({
          time: minutes * 60 + seconds + fraction,
          text: text || '♪'
        });
      }
    }
  }

  if (offsetSeconds !== 0) {
    for (const item of parsed) {
      item.time = Math.max(0, item.time - offsetSeconds);
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
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
