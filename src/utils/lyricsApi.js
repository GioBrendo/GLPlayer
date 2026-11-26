/**
 * Integração com o backend (/api/lyrics) e fallback direto ao LRCLIB
 * para busca e download de letras sincronizadas (.LRC) ou em texto simples.
 */
import { parseYouTubeTrackMetadata, scoreLyricsCandidate } from './youtubeMetadata.js';
import { isSyncedLrc } from './lrcParser.js';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extrai um YouTube videoId válido de uma faixa (seja de `youtubeId` ou `id` "yt-...").
 */
export function extractYoutubeId(track) {
  if (!track || typeof track !== 'object') return null;

  if (typeof track.youtubeId === 'string') {
    const id = track.youtubeId.trim();
    if (VIDEO_ID_RE.test(id)) return id;
  }

  if (typeof track.id === 'string' && track.id.startsWith('yt-')) {
    const id = track.id.slice(3).trim();
    if (VIDEO_ID_RE.test(id)) return id;
  }

  return null;
}

function formatLrclibRecord(raw, sourceTag) {
  const syncedLyrics = typeof raw?.syncedLyrics === 'string' ? raw.syncedLyrics : '';
  const plainLyrics = typeof raw?.plainLyrics === 'string' ? raw.plainLyrics : '';
  const hasSynced = /\[\d{1,3}:\d{2}/.test(syncedLyrics);
  return {
    id: `lrclib-${raw.id}`,
    trackName: raw.trackName || '',
    artistName: raw.artistName || '',
    albumName: raw.albumName || '',
    duration: Number(raw.duration) || 0,
    syncedLyrics,
    plainLyrics,
    source: hasSynced ? sourceTag : 'lrclib-plain',
    isSynced: hasSynced,
    instrumental: Boolean(raw.instrumental),
    score: 0
  };
}

function stripInternalCandidateFields(item) {
  if (!item) return null;
  const { instrumental: _instrumental, ...clean } = item;
  return clean;
}

function normalizeLyricsPayload(data) {
  const status = data?.status || 'not_found';
  const best = data?.best || null;
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  const isSynced = Boolean(best?.isSynced && best?.syncedLyrics);
  const lrc = best ? (isSynced ? best.syncedLyrics : best.plainLyrics || '') : '';

  return {
    status,
    lrc,
    syncedLyrics: best?.syncedLyrics || '',
    plainLyrics: best?.plainLyrics || '',
    isSynced,
    source: best?.source || '',
    trackName: best?.trackName || '',
    artistName: best?.artistName || '',
    albumName: best?.albumName || '',
    duration: Number(best?.duration) || 0,
    best,
    candidates,
    resolvedMeta: data?.resolvedMeta || null
  };
}

/**
 * Tenta consultar o endpoint unificado do backend `/api/lyrics`.
 * Retorna `{ fallback: true }` apenas quando o middleware não está disponível
 * (ex.: build estático, 404 ou falha de conexão com o backend).
 */
async function requestBackendLyrics({ title, artist, duration, youtubeId, mode, durationUnknown }) {
  const params = new URLSearchParams();
  if (title) params.set('title', title);
  if (artist) params.set('artist', artist);
  if (Number.isFinite(duration) && duration > 0) {
    params.set('duration', String(Math.round(duration)));
  }
  if (youtubeId) params.set('youtubeId', youtubeId);
  if (durationUnknown) params.set('durationUnknown', '1');
  params.set('mode', mode === 'search' ? 'search' : 'auto');

  try {
    const res = await fetch(`/api/lyrics?${params.toString()}`, {
      signal: AbortSignal.timeout(25000)
    });

    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    if (res.status === 404 || res.status === 405 || res.status === 501 || (res.ok && !isJson)) {
      return { fallback: true };
    }

    if (!isJson) {
      return { fallback: true };
    }

    const data = await res.json();
    if (!data || typeof data.status !== 'string') {
      return res.ok ? { fallback: true } : { fallback: false, data: { status: 'error', best: null, candidates: [] } };
    }

    return { fallback: false, data };
  } catch (err) {
    // Em ambiente estático/preview sem backend, cai no fallback direto ao navegador
    console.warn('Endpoint /api/lyrics indisponível, usando busca direta:', err?.message || err);
    return { fallback: true };
  }
}

/**
 * Fallback direto no navegador usando `parseYouTubeTrackMetadata` e `scoreLyricsCandidate`
 * caso o middleware `/api/lyrics` não esteja ativo.
 */
async function searchLrclibDirect(title, artist, duration = null, options = {}) {
  const mode = options.mode === 'search' ? 'search' : 'auto';
  const youtubeId = options.youtubeId || null;
  const meta = parseYouTubeTrackMetadata(title, artist);
  const rawDur = Number(duration);
  const effectiveDuration = Number.isFinite(rawDur) && rawDur > 0 ? Math.round(rawDur) : 0;
  const isDurationUnknown =
    Boolean(options.durationUnknown) || effectiveDuration <= 0 || (Boolean(youtubeId) && effectiveDuration === 210);

  const candidateMap = new Map();
  let sawRateLimit = false;
  let sawNetworkError = false;

  const addRecords = (records, sourceTag) => {
    for (const raw of records) {
      if (!raw || (!raw.syncedLyrics && !raw.plainLyrics)) continue;
      const item = formatLrclibRecord(raw, sourceTag);
      item.score = scoreLyricsCandidate(item, meta, effectiveDuration, { durationUnknown: isDurationUnknown });
      const prev = candidateMap.get(item.id);
      if (!prev || item.score > prev.score) {
        candidateMap.set(item.id, item);
      }
    }
  };

  const hasStrongSynced = () => {
    for (const item of candidateMap.values()) {
      if (!item.isSynced || item.score < 70) continue;
      if (effectiveDuration > 0 && !isDurationUnknown && item.duration > 0) {
        const skew = Math.abs(item.duration - effectiveDuration);
        if (meta.isLiveLike && skew > 20) continue;
      }
      return true;
    }
    return false;
  };

  const callLrclib = async (pathAndQuery, sourceTag) => {
    if (sawRateLimit) return;
    try {
      // Sem cabeçalhos customizados: no navegador forçaria preflight CORS no LRCLIB
      const res = await fetch(`https://lrclib.net${pathAndQuery}`, {
        signal: AbortSignal.timeout(8000)
      });
      if (res.status === 429) {
        sawRateLimit = true;
        return;
      }
      if (res.status === 404) return;
      if (!res.ok) {
        if (res.status >= 500) sawNetworkError = true;
        return;
      }
      const data = await res.json();
      const records = Array.isArray(data) ? data : data ? [data] : [];
      addRecords(records, sourceTag);
    } catch {
      sawNetworkError = true;
    }
  };

  // Estágio 1: /api/get direto quando há artista e duração real conhecida
  if (effectiveDuration > 0 && !isDurationUnknown) {
    const getPairs = meta.candidates.filter((c) => c.artistName).slice(0, 2);
    for (const pair of getPairs) {
      if (mode === 'auto' && hasStrongSynced()) break;
      const qs = new URLSearchParams({
        track_name: pair.trackName,
        artist_name: pair.artistName,
        duration: String(effectiveDuration)
      });
      await callLrclib(`/api/get?${qs.toString()}`, 'lrclib-get');
    }
  }

  // Estágio 2: busca estruturada por track_name + artist_name
  if (mode === 'search' || !hasStrongSynced()) {
    const artistPairs = meta.candidates.filter((c) => c.artistName).slice(0, 3);
    for (const pair of artistPairs) {
      if (mode === 'auto' && hasStrongSynced()) break;
      const qs = new URLSearchParams({
        track_name: pair.trackName,
        artist_name: pair.artistName
      });
      await callLrclib(`/api/search?${qs.toString()}`, 'lrclib-search');
    }
  }

  // Estágio 3: busca livre /api/search?q=...
  if (mode === 'search' || !hasStrongSynced()) {
    const seenQ = new Set();
    const freeQueries = [];
    for (const c of meta.candidates) {
      if (c.query && !seenQ.has(c.query.toLowerCase())) {
        seenQ.add(c.query.toLowerCase());
        freeQueries.push(c.query);
      }
    }
    for (const q of freeQueries.slice(0, 2)) {
      if (mode === 'auto' && hasStrongSynced()) break;
      await callLrclib(`/api/search?q=${encodeURIComponent(q)}`, 'lrclib-search');
    }
  }

  const all = Array.from(candidateMap.values()).sort((a, b) => b.score - a.score);
  const bestSynced = all.find((c) => c.isSynced && c.score >= 45) || null;
  const bestPlain = all.find((c) => !c.isSynced && c.plainLyrics && c.score >= 25) || null;
  const best = bestSynced || bestPlain || null;

  const visibleCandidates = all
    .filter((c) => c.score >= (mode === 'search' ? 0 : 20) || c === best)
    .slice(0, 20)
    .map(stripInternalCandidateFields);

  const bestOut = stripInternalCandidateFields(best);

  let status = 'not_found';
  if (bestOut) status = 'found';
  else if (sawRateLimit) status = 'rate_limited';
  else if (sawNetworkError) status = 'error';

  return {
    status,
    best: bestOut,
    candidates: visibleCandidates,
    resolvedMeta: {
      title: meta.displayTitle || '',
      coreTitle: meta.coreTitle || '',
      artist: meta.cleanArtist || '',
      primaryArtist: meta.primaryArtist || '',
      duration: effectiveDuration,
      album: '',
      track: '',
      youtubeId
    }
  };
}

async function queryLyrics(title, artist, duration = null, options = {}, mode = 'auto') {
  const youtubeId = options?.youtubeId || null;
  if (!title && !youtubeId) {
    return normalizeLyricsPayload({ status: 'not_found', best: null, candidates: [] });
  }

  const rawDur = Number(duration);
  const effectiveDuration = Number.isFinite(rawDur) && rawDur > 0 ? Math.round(rawDur) : 0;
  const durationUnknown = Boolean(options?.durationUnknown) || effectiveDuration <= 0;

  const backendRes = await requestBackendLyrics({
    title: title || '',
    artist: artist || '',
    duration: effectiveDuration,
    youtubeId,
    mode,
    durationUnknown
  });

  if (!backendRes.fallback) {
    return normalizeLyricsPayload(backendRes.data);
  }

  const directRes = await searchLrclibDirect(title || '', artist || '', effectiveDuration, {
    mode,
    durationUnknown,
    youtubeId
  });
  return normalizeLyricsPayload(directRes);
}

/**
 * Busca a melhor letra disponível (sincronizada no LRCLIB, legenda do YouTube ou texto simples).
 */
export async function fetchOnlineLyrics(title, artist, duration = null, options = {}) {
  return queryLyrics(title, artist, duration, options, 'auto');
}

/**
 * Busca múltiplos candidatos de letra para seleção manual pelo usuário.
 */
export async function searchOnlineLyricsCandidates(title, artist, duration = null, options = {}) {
  return queryLyrics(title, artist, duration, options, 'search');
}

/**
 * Faz o download do arquivo .lrc (ou .txt se não tiver timestamps) para o computador do usuário.
 */
export function downloadLrcFile(songTitle, artist, lrcContent) {
  if (!lrcContent) return;

  const ext = isSyncedLrc(lrcContent) ? 'lrc' : 'txt';
  const baseName = [artist, songTitle].filter((part) => typeof part === 'string' && part.trim()).join(' - ') || 'letra';
  const sanitizedTitle = baseName.replace(/[/\\?%*:|"<>]/g, '-');
  const filename = `${sanitizedTitle}.${ext}`;

  const blob = new Blob([lrcContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revogar na hora pode cancelar o download em alguns navegadores
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
