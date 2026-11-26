/**
 * Serviços de backend do JBLGPlayer, servidos pelo próprio servidor do Vite
 * (tanto em `npm run dev` quanto em `npm run preview`):
 *
 *  - /api/stream          → proxy de áudio com suporte a Range (206)
 *  - /api/yt-search       → resolve o melhor vídeo do YouTube para "título artista"
 *  - /api/yt-metadata     → metadados e duração real de um vídeo do YouTube
 *  - /api/yt-captions     → legendas do YouTube convertidas para .lrc
 *  - /api/lyrics          → busca inteligente de letras (LRCLIB + legendas do YouTube)
 *  - /api/spotify-import  → lê álbum/playlist/faixa pública do Spotify
 *  - /api/youtube-import  → lê vídeo ou playlist do YouTube
 *  - /ws-jam              → WebSocket do modo "Ouvir Juntos"
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { WebSocketServer } from 'ws';
import {
  cleanChannelArtist,
  parseYouTubeTrackMetadata,
  scoreLyricsCandidate
} from '../src/utils/youtubeMetadata.js';

const execFileAsync = promisify(execFile);

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const LRCLIB_UA = 'JBLGPlayer/1.0 (https://lrclib.net)';
const LRCLIB_MIN_GAP_MS = 180;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{2,64}$/;
const MAX_QUERY_LENGTH = 300;
const DEFAULT_COVER = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';
const DEFAULT_ALBUM_COVER = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop';

// ==========================================
// CACHES E UTILITÁRIOS
// ==========================================

/** Cache em memória com expiração e limite de tamanho (descarta o mais antigo). */
class TtlCache {
  constructor(maxEntries, defaultTtlMs) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Reinsere para manter a ordem de uso recente (LRU simples)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.map.size > this.maxEntries) {
      this.map.delete(this.map.keys().next().value);
    }
  }

  delete(key) {
    this.map.delete(key);
  }
}

// "título artista" → videoId
const videoIdCache = new TtlCache(1000, 24 * 60 * 60 * 1000);
// videoId → URL direta do googlevideo (expira; o próprio link traz o parâmetro `expire`)
const streamUrlCache = new TtlCache(500, 60 * 60 * 1000);
// videoId → metadados completos do yt-dlp (duração real, faixa/artista YT Music, legendas)
const ytMetadataCache = new TtlCache(500, 12 * 60 * 60 * 1000);
// videoId|manual/auto → legendas convertidas em LRC
const ytCaptionsCache = new TtlCache(300, 12 * 60 * 60 * 1000);
// URL LRCLIB → resposta JSON (evita rajadas repetidas)
const lrclibHttpCache = new TtlCache(800, 6 * 60 * 60 * 1000);
// Chave de busca de letra → resultado consolidado do /api/lyrics
const lyricsResultCache = new TtlCache(800, 6 * 60 * 60 * 1000);

// Requisições em andamento: evita disparar o mesmo yt-dlp/busca várias vezes em paralelo
// (o <audio> do navegador costuma abrir mais de uma requisição Range ao mesmo tempo).
const inflight = new Map();
function dedupe(key, task) {
  if (inflight.has(key)) return inflight.get(key);
  const promise = Promise.resolve()
    .then(task)
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Calcula por quanto tempo uma URL do googlevideo continua válida (com margem de 5 min). */
function streamUrlTtl(url) {
  try {
    const expire = Number(new URL(url).searchParams.get('expire'));
    if (expire > 0) {
      return Math.max(60_000, expire * 1000 - Date.now() - 5 * 60_000);
    }
  } catch {
    // URL sem parâmetro de expiração: usa o padrão
  }
  return 60 * 60 * 1000;
}

let resolvedCookiesPath = null;
function getYtCookiesArgs() {
  if (resolvedCookiesPath === false) return [];
  if (resolvedCookiesPath) return ['--cookies', resolvedCookiesPath];

  const cookiesFile = process.env.YOUTUBE_COOKIES_FILE?.trim();
  if (cookiesFile && fs.existsSync(cookiesFile)) {
    resolvedCookiesPath = cookiesFile;
    return ['--cookies', resolvedCookiesPath];
  }

  const rawCookies = process.env.YOUTUBE_COOKIES?.trim();
  if (rawCookies) {
    try {
      const target = path.join(os.tmpdir(), 'jblg-yt-cookies.txt');
      fs.writeFileSync(target, rawCookies, { encoding: 'utf-8', mode: 0o600 });
      resolvedCookiesPath = target;
      return ['--cookies', resolvedCookiesPath];
    } catch (err) {
      console.warn('[yt-dlp] falha ao gravar YOUTUBE_COOKIES:', err.message);
    }
  }

  resolvedCookiesPath = false;
  return [];
}

function isYouTubeBotBlockError(message = '') {
  return /sign in to confirm|not a bot/i.test(message);
}

/**
 * Executa o yt-dlp forçando saída em UTF-8 (sem isso, no Windows, títulos com
 * acentos, coreano, japonês etc. chegam corrompidos).
 * Sempre passe as URLs/buscas depois de '--' para que nunca sejam lidas como opções.
 */
async function runYtDlp(args, timeout) {
  const { stdout } = await execFileAsync(
    'yt-dlp',
    ['--no-warnings', '--encoding', 'utf-8', ...getYtCookiesArgs(), ...args],
    {
      timeout,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    }
  );
  return stdout;
}

function isOfficialAutoChannel(name) {
  const author = (name || '').toLowerCase();
  // Canais VEVO e "- Topic" costumam bloquear incorporação (modo clipe)
  return author.includes('vevo') || author.includes('- topic') || author.endsWith(' topic');
}

function cleanString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function sendJson(res, status, body) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendText(res, status, text) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}

// ==========================================
// RESOLUÇÃO DE VÍDEOS E ÁUDIO DO YOUTUBE
// ==========================================

async function scrapeSearchResultIds(query) {
  const res = await fetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(query), {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
    },
    signal: AbortSignal.timeout(4000)
  });
  if (!res.ok) return [];
  const html = await res.text();
  const ids = [...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map((m) => m[1]);
  return Array.from(new Set(ids));
}

/** Retorna o nome do canal se o vídeo permite incorporação (oEmbed responde), senão null. */
async function fetchEmbeddableAuthor(videoId) {
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`, {
      signal: AbortSignal.timeout(2500)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.author_name || '';
  } catch {
    return null;
  }
}

async function findBestVideoId(cleanQuery, badIds = []) {
  const searchQueries = [`${cleanQuery} letra`, `${cleanQuery} lyrics`, `${cleanQuery} audio`, cleanQuery];

  for (const q of searchQueries) {
    try {
      const candidates = (await scrapeSearchResultIds(q)).filter((id) => !badIds.includes(id)).slice(0, 5);
      // Consulta os candidatos em paralelo, mas respeita a ordem de relevância da busca
      const authors = await Promise.all(candidates.map(fetchEmbeddableAuthor));
      const index = authors.findIndex((author) => author !== null && !isOfficialAutoChannel(author));
      if (index !== -1) return candidates[index];
    } catch {
      // Busca falhou (timeout/bloqueio): tenta a próxima variação
    }
  }

  // Último recurso: busca pelo yt-dlp
  try {
    const stdout = await runYtDlp(
      ['--flat-playlist', '--print', '%(id)s||%(channel)s', '--', `ytsearch6:${cleanQuery} audio`],
      20000
    );
    for (const line of stdout.trim().split('\n')) {
      const [rawId, rawChannel] = line.split('||');
      const id = rawId?.trim();
      if (id && VIDEO_ID_RE.test(id) && !badIds.includes(id) && !isOfficialAutoChannel(rawChannel)) {
        return id;
      }
    }
  } catch (err) {
    console.warn(`[yt-search] yt-dlp falhou para "${cleanQuery}":`, err.message);
  }

  return null;
}

function findVideoIdForQuery(query, badIds = []) {
  if (badIds.length === 0) {
    const cached = videoIdCache.get(query);
    if (cached) return Promise.resolve(cached);
  }
  return dedupe(`vid:${query}|${badIds.join(',')}`, async () => {
    const id = await findBestVideoId(query, badIds);
    if (id) videoIdCache.set(query, id);
    return id;
  });
}

function getAudioUrlForVideo(videoId, { fresh = false } = {}) {
  if (!fresh) {
    const cached = streamUrlCache.get(videoId);
    if (cached) return Promise.resolve(cached);
  }
  return dedupe(`url:${videoId}`, async () => {
    const stdout = await runYtDlp(
      ['--no-playlist', '-f', 'bestaudio[ext=m4a]/bestaudio', '-g', '--', `https://www.youtube.com/watch?v=${videoId}`],
      20000
    );
    const url = stdout.trim().split('\n')[0];
    if (!url || !url.startsWith('http')) {
      throw new Error('yt-dlp não retornou uma URL de áudio');
    }
    streamUrlCache.set(videoId, url, streamUrlTtl(url));
    return url;
  });
}

function searchAudioUrl(query) {
  return dedupe(`search-url:${query}`, async () => {
    const stdout = await runYtDlp(
      ['--no-playlist', '-f', 'bestaudio[ext=m4a]/bestaudio', '--print', '%(id)s\t%(url)s', '--', `ytsearch1:${query} audio`],
      25000
    );
    const [videoId, url] = stdout.trim().split('\n')[0].split('\t');
    if (!url || !url.startsWith('http')) return null;
    if (VIDEO_ID_RE.test(videoId || '')) {
      streamUrlCache.set(videoId, url, streamUrlTtl(url));
    }
    return { videoId: VIDEO_ID_RE.test(videoId || '') ? videoId : null, url };
  });
}

/**
 * Descobre a URL de áudio a partir de um videoId e/ou de uma busca "título artista".
 * A busca usa a mesma resolução de /api/yt-search, então o áudio e o clipe batem.
 */
async function resolveAudioSource(videoId, query) {
  let id = videoId;
  if (!id && query) {
    id = await findVideoIdForQuery(query).catch(() => null);
  }

  if (id) {
    try {
      return { videoId: id, url: await getAudioUrlForVideo(id) };
    } catch (err) {
      console.warn(`[stream] yt-dlp falhou para ${id}:`, err.message);
      if (isYouTubeBotBlockError(err.message)) {
        return null;
      }
    }
  }

  if (query) {
    try {
      return await searchAudioUrl(query);
    } catch (err) {
      console.warn(`[stream] busca direta falhou para "${query}":`, err.message);
    }
  }

  return null;
}

// ==========================================
// HANDLERS HTTP
// ==========================================

async function handleStream(req, res, urlObj) {
  const videoId = urlObj.searchParams.get('id');
  const query = cleanString(urlObj.searchParams.get('q'), MAX_QUERY_LENGTH) || null;

  if (videoId && !VIDEO_ID_RE.test(videoId)) {
    sendText(res, 400, 'Invalid video id');
    return;
  }
  if (!videoId && !query) {
    sendText(res, 400, 'Missing video id or search query');
    return;
  }

  // Cancela o download do YouTube assim que o navegador fecha a conexão (seek, troca de faixa…)
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  try {
    const source = await resolveAudioSource(videoId, query);
    if (res.destroyed) return;
    if (!source) {
      sendText(res, 502, 'Audio stream unavailable');
      return;
    }

    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;

    let upstream = await fetch(source.url, { headers, signal: controller.signal });

    // Links do googlevideo expiram (~6h). Se o link em cache venceu, gera outro e tenta de novo.
    if ((upstream.status === 403 || upstream.status === 410) && source.videoId) {
      await upstream.body?.cancel().catch(() => {});
      streamUrlCache.delete(source.videoId);
      const freshUrl = await getAudioUrlForVideo(source.videoId, { fresh: true });
      upstream = await fetch(freshUrl, { headers, signal: controller.signal });
    }

    if (upstream.status >= 400 && upstream.status !== 416) {
      await upstream.body?.cancel().catch(() => {});
      if (source.videoId) streamUrlCache.delete(source.videoId);
      sendText(res, 502, `Upstream error ${upstream.status}`);
      return;
    }

    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mp4');
    for (const header of ['content-length', 'content-range']) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'HEAD' || !upstream.body) {
      await upstream.body?.cancel().catch(() => {});
      res.end();
      return;
    }

    // pipeline encerra os dois lados em caso de erro; interrupções do cliente são esperadas
    await pipeline(Readable.fromWeb(upstream.body), res).catch(() => {});
  } catch (err) {
    if (controller.signal.aborted) return;
    console.warn('[stream] erro:', err.message);
    sendText(res, 500, 'Stream error');
  }
}

function handlePrefetch(res, urlObj) {
  const videoId = urlObj.searchParams.get('id');
  const query = cleanString(urlObj.searchParams.get('q'), MAX_QUERY_LENGTH) || null;
  if ((!videoId || !VIDEO_ID_RE.test(videoId)) && !query) {
    sendJson(res, 400, { ok: false });
    return;
  }
  resolveAudioSource(videoId && VIDEO_ID_RE.test(videoId) ? videoId : null, query).catch(() => {});
  sendJson(res, 202, { ok: true });
}

async function handleYtSearch(res, urlObj) {
  const query = cleanString(urlObj.searchParams.get('q'), MAX_QUERY_LENGTH);
  const badId = urlObj.searchParams.get('badId');

  if (!query) {
    sendJson(res, 400, { error: 'Missing query parameter q' });
    return;
  }

  const badIds = badId && VIDEO_ID_RE.test(badId) ? [badId] : [];
  if (badIds.length > 0) {
    videoIdCache.delete(query);
  }

  try {
    const videoId = await findVideoIdForQuery(query, badIds);
    if (videoId) {
      sendJson(res, 200, { videoId, success: true });
    } else {
      sendJson(res, 200, { videoId: null, message: 'Vídeo não encontrado' });
    }
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

/** Aceita open.spotify.com/{album|playlist|track}/ID (inclusive /intl-pt/… e /embed/…) e spotify:tipo:ID */
function parseSpotifyLink(raw) {
  const text = (raw || '').trim();
  const uriMatch = text.match(/^spotify:(album|playlist|track):([A-Za-z0-9]{10,40})$/);
  if (uriMatch) return { type: uriMatch[1], id: uriMatch[2] };

  const urlMatch = text.match(
    /open\.spotify\.com\/(?:intl-[A-Za-z-]+\/)?(?:embed\/)?(album|playlist|track)\/([A-Za-z0-9]{10,40})/
  );
  return urlMatch ? { type: urlMatch[1], id: urlMatch[2] } : null;
}

async function handleSpotifyImport(res, urlObj) {
  const link = parseSpotifyLink(urlObj.searchParams.get('url'));
  if (!link) {
    sendJson(res, 400, {
      error:
        'Link inválido. Use um link como https://open.spotify.com/album/[ID], /playlist/[ID] ou /track/[ID].'
    });
    return;
  }

  const { type, id } = link;

  try {
    const fetchRes = await fetch(`https://open.spotify.com/embed/${type}/${id}`, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      signal: AbortSignal.timeout(12000)
    });

    if (!fetchRes.ok) {
      throw new Error(`Falha ao acessar o Spotify (${fetchRes.status}: ${fetchRes.statusText})`);
    }

    const html = await fetchRes.text();
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
    if (!nextDataMatch) {
      throw new Error('Não foi possível ler as faixas deste link do Spotify.');
    }

    const data = JSON.parse(nextDataMatch[1]);
    const entity = data.props?.pageProps?.state?.data?.entity;
    if (!entity) {
      throw new Error('Álbum, playlist ou faixa não encontrado no Spotify. Verifique se o link está correto.');
    }

    const title = entity.title || entity.name || 'Álbum Importado';
    const artist =
      entity.subtitle ||
      entity.artists?.map((a) => a.name).filter(Boolean).join(', ') ||
      entity.authors?.[0]?.name ||
      'Spotify';
    const cover =
      entity.visualIdentity?.image?.[1]?.url ||
      entity.visualIdentity?.image?.[0]?.url ||
      entity.coverArt?.sources?.[0]?.url ||
      DEFAULT_ALBUM_COVER;

    // Faixa avulsa: a própria entidade é a música
    const rawTracks = Array.isArray(entity.trackList) && entity.trackList.length > 0
      ? entity.trackList
      : type === 'track'
        ? [{ ...entity, title, subtitle: artist }]
        : [];

    const tracks = rawTracks
      .filter((t) => t && (t.title || t.name))
      .map((t, idx) => {
        const spotifyTrackId = typeof t.uri === 'string' ? t.uri.replace('spotify:track:', '') : '';
        return {
          id: 'sp-' + (spotifyTrackId || t.uid || `${id}-${idx}`),
          title: t.title || t.name,
          artist: t.subtitle || artist,
          album: type === 'track' ? 'Spotify' : title,
          cover,
          duration: Math.round((t.duration || 210000) / 1000),
          hasLyrics: false,
          lyricsLrc: ''
        };
      });

    if (tracks.length === 0) {
      throw new Error('Nenhuma faixa encontrada neste link do Spotify.');
    }

    const kindLabel = type === 'album' ? 'Álbum' : type === 'playlist' ? 'Playlist' : 'Faixa';
    sendJson(res, 200, {
      success: true,
      playlist: {
        id: `pl-sp-${id}`,
        name: title,
        description: `${kindLabel} do Spotify • ${artist} • ${tracks.length} ${tracks.length === 1 ? 'música' : 'músicas'}`,
        cover,
        tracks
      }
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

/** Valida o link e extrai videoId/playlistId. Só aceita domínios do YouTube. */
function parseYouTubeLink(raw) {
  let url;
  try {
    url = new URL((raw || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  if (host !== 'youtube.com' && host !== 'youtu.be' && host !== 'youtube-nocookie.com') return null;

  let videoId = null;
  if (host === 'youtu.be') {
    videoId = url.pathname.split('/')[1] || null;
  } else if (url.searchParams.get('v')) {
    videoId = url.searchParams.get('v');
  } else {
    const pathMatch = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    if (pathMatch) videoId = pathMatch[1];
  }
  if (videoId && !VIDEO_ID_RE.test(videoId)) videoId = null;

  const list = url.searchParams.get('list');
  const playlistId = list && PLAYLIST_ID_RE.test(list) ? list : null;

  if (!videoId && !playlistId) return null;
  return { videoId, playlistId };
}

async function importYouTubePlaylist(res, { videoId, playlistId }) {
  // Mixes (RD…) só funcionam a partir de um vídeo; playlists comuns pela URL canônica
  const canonicalUrl =
    playlistId.startsWith('RD') && videoId
      ? `https://www.youtube.com/watch?v=${videoId}&list=${playlistId}`
      : `https://www.youtube.com/playlist?list=${playlistId}`;

  const stdout = await runYtDlp(
    [
      '--flat-playlist',
      '--playlist-end', '100',
      '--dump-single-json',
      '--',
      canonicalUrl
    ],
    40000
  );

  const data = JSON.parse(stdout);
  const playlistTitle =
    cleanString(data?.title, 200) && data.title !== 'NA' ? cleanString(data.title, 200) : 'Playlist do YouTube';
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  const tracks = [];
  const seen = new Set();

  for (const entry of entries) {
    const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
    if (!id || !VIDEO_ID_RE.test(id) || seen.has(id)) continue;

    const rawTitle = cleanString(entry.title, 300);
    const rawUploader = cleanString(entry.channel || entry.uploader, 300);
    // Ignora vídeos removidos/privados sem metadados utilizáveis
    if ((!rawTitle || rawTitle === '[Deleted video]' || rawTitle === '[Private video]') && !rawUploader) {
      continue;
    }

    seen.add(id);
    const durationNum = Math.round(Number(entry.duration));
    const parsed = parseYouTubeTrackMetadata(rawTitle || 'Música do YouTube', rawUploader);

    tracks.push({
      id: 'yt-' + id,
      youtubeId: id,
      title: parsed.displayTitle || rawTitle || 'Música do YouTube',
      artist: parsed.cleanArtist || cleanChannelArtist(rawUploader) || 'YouTube',
      album: playlistTitle,
      cover: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      duration: Number.isFinite(durationNum) && durationNum > 0 ? durationNum : 210,
      hasLyrics: false,
      lyricsLrc: ''
    });
  }

  if (tracks.length === 0) {
    throw new Error('Nenhuma faixa encontrada nesta playlist do YouTube.');
  }

  sendJson(res, 200, {
    success: true,
    type: 'playlist',
    playlist: {
      id: `pl-yt-${playlistId}`,
      name: playlistTitle,
      description: `Playlist do YouTube • ${tracks.length} músicas`,
      cover: tracks[0]?.cover || DEFAULT_COVER,
      tracks
    }
  });
}

/**
 * Obtém metadados completos de um vídeo via yt-dlp (duração real, tags track/artist/album
 * do YouTube Music e URLs de legendas), mantendo em cache.
 */
async function fetchYouTubeFullInfo(videoId) {
  const cached = ytMetadataCache.get(videoId);
  if (cached) return cached;

  return dedupe(`ytmeta:${videoId}`, async () => {
    const stdout = await runYtDlp(
      ['--no-playlist', '--dump-single-json', '--', `https://www.youtube.com/watch?v=${videoId}`],
      20000
    );
    const d = JSON.parse(stdout);
    const ytTrack = cleanString(d?.track, 300);
    const ytArtist =
      cleanString(d?.artist, 300) ||
      (Array.isArray(d?.artists) ? cleanString(d.artists.filter(Boolean).join(', '), 300) : '') ||
      cleanString(d?.creator, 300);
    const channel = cleanString(d?.channel || d?.uploader, 300);
    const rawVideoTitle = cleanString(d?.title, 300);
    const parsed = parseYouTubeTrackMetadata(ytTrack || rawVideoTitle, ytArtist || channel);
    const dur = Math.round(Number(d?.duration));
    const subtitles = d?.subtitles && typeof d.subtitles === 'object' ? d.subtitles : {};
    const automaticCaptions =
      d?.automatic_captions && typeof d.automatic_captions === 'object' ? d.automatic_captions : {};

    const info = {
      youtubeId: videoId,
      title: parsed.displayTitle || ytTrack || rawVideoTitle || 'Música do YouTube',
      coreTitle: parsed.coreTitle || '',
      artist: parsed.cleanArtist || cleanChannelArtist(ytArtist || channel) || 'YouTube',
      track: ytTrack,
      ytArtist,
      album: cleanString(d?.album, 300),
      channel,
      rawTitle: rawVideoTitle,
      rawArtist: channel,
      duration: Number.isFinite(dur) && dur > 0 ? dur : 0,
      hasSubtitles: Object.keys(subtitles).some((k) => k !== 'live_chat' && Array.isArray(subtitles[k]) && subtitles[k].length > 0),
      hasAutoCaptions: Object.keys(automaticCaptions).some(
        (k) => Array.isArray(automaticCaptions[k]) && automaticCaptions[k].length > 0
      ),
      subtitles,
      automaticCaptions
    };
    ytMetadataCache.set(videoId, info);
    return info;
  });
}

function publicYouTubeMetadata(info) {
  return {
    youtubeId: info.youtubeId,
    title: info.title,
    artist: info.artist,
    track: info.track,
    album: info.album,
    channel: info.channel,
    duration: info.duration,
    hasSubtitles: info.hasSubtitles,
    hasAutoCaptions: info.hasAutoCaptions
  };
}

async function importYouTubeVideo(res, videoId) {
  let title = 'Música do YouTube';
  let artist = 'YouTube';
  let album = 'YouTube';
  let duration = 210;

  try {
    const info = await fetchYouTubeFullInfo(videoId);
    if (info.title) title = info.title;
    if (info.artist) artist = info.artist;
    if (info.album) album = info.album;
    if (info.duration > 0) duration = info.duration;
  } catch (err) {
    console.warn(`[youtube-import] yt-dlp falhou para ${videoId}, tentando oEmbed:`, err.message);
    try {
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`, {
        signal: AbortSignal.timeout(3500)
      });
      if (oembedRes.ok) {
        const oembed = await oembedRes.json();
        const parsed = parseYouTubeTrackMetadata(oembed.title || '', oembed.author_name || '');
        title = parsed.displayTitle || oembed.title || title;
        artist = parsed.cleanArtist || cleanChannelArtist(oembed.author_name) || oembed.author_name || artist;
      }
    } catch {
      // Sem metadados externos disponíveis; mantém os padrões
    }
  }

  sendJson(res, 200, {
    success: true,
    type: 'track',
    track: {
      id: 'yt-' + videoId,
      youtubeId: videoId,
      title,
      artist,
      album,
      cover: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      duration,
      hasLyrics: false,
      lyricsLrc: ''
    }
  });
}

// ==========================================
// LEGENDAS DO YOUTUBE E BUSCA DE LETRAS
// ==========================================

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function cleanCaptionLineText(raw) {
  return decodeHtmlEntities(String(raw || ''))
    .replace(/<\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?>/g, '')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatLrcTimestamp(ms) {
  const safeMs = Math.max(0, Math.round(Number(ms) || 0));
  const totalSec = Math.floor(safeMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const centis = Math.floor((safeMs % 1000) / 10);
  return `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}]`;
}

function parseTimestampMs(raw) {
  const match = String(raw || '').trim().match(/^(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  if (!match) return null;
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const mins = parseInt(match[2], 10);
  const secs = parseInt(match[3], 10);
  const ms = parseInt(match[4], 10);
  return ((hours * 60 + mins) * 60 + secs) * 1000 + ms;
}

const NON_LYRIC_CUE_RE =
  /^(?:[\s♪♫♬♩\-–—.*]+|(?:\[|\()(?:music|m[uú]sica|applause|aplausos|cheering|laughter|risos|audience[^)\]]*|instrumental|silence|sil[eê]ncio|som|background)(?:\]|\)))$/i;

function finalizeCaptionCues(rawCues, isAuto) {
  const deduped = [];
  for (const cue of rawCues) {
    const text = cleanCaptionLineText(cue.text);
    if (!text) continue;
    if (isAuto && NON_LYRIC_CUE_RE.test(text)) continue;

    const prev = deduped[deduped.length - 1];
    if (prev) {
      if (prev.text === text && Math.abs(cue.ms - prev.ms) < 5000) continue;
      // Em legendas automáticas progressivas, a linha seguinte costuma estender a anterior
      if (isAuto && Math.abs(cue.ms - prev.ms) < 2500 && text.startsWith(prev.text + ' ')) {
        prev.text = text;
        continue;
      }
    }
    deduped.push({ ms: cue.ms, text });
  }

  const lyricLines = deduped.filter((c) => !NON_LYRIC_CUE_RE.test(c.text));
  const alnumChars = lyricLines
    .map((c) => c.text.replace(/[♪♫♬♩]/g, '').replace(/[^\p{L}\p{N}]/gu, ''))
    .join('').length;

  const minLines = isAuto ? 4 : 3;
  const minChars = isAuto ? 50 : 30;
  if (lyricLines.length < minLines || alnumChars < minChars) {
    return null;
  }

  // Se houver apenas notas musicais/ruído fora das falas, em legendas manuais mantemos o fluxo;
  // caso o texto só tenha marcadores, já foi barrado acima.
  const lines = deduped.map((c) => `${formatLrcTimestamp(c.ms)} ${c.text}`);
  return {
    lrc: lines.join('\n'),
    plainText: lyricLines.map((c) => c.text).join('\n'),
    lineCount: lines.length
  };
}

function parseJson3Captions(rawText, isAuto) {
  const data = JSON.parse(rawText);
  const events = Array.isArray(data?.events) ? data.events : [];
  const cues = [];
  for (const ev of events) {
    if (!Array.isArray(ev?.segs) || !Number.isFinite(ev?.tStartMs)) continue;
    const joined = ev.segs.map((s) => s?.utf8 || '').join('');
    if (!joined.trim()) continue;
    cues.push({ ms: ev.tStartMs, text: joined });
  }
  return finalizeCaptionCues(cues, isAuto);
}

function parseVttOrSrtCaptions(rawText, isAuto) {
  const blocks = String(rawText || '').replace(/\r/g, '').split(/\n{2,}/);
  const cues = [];
  let prevLastSubLine = '';

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (/^(?:WEBVTT|NOTE|STYLE|Kind:|Language:)/i.test(lines[0])) continue;

    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx === -1) continue;
    const startPart = lines[timeIdx].split('-->')[0].trim().split(/\s+/)[0];
    const ms = parseTimestampMs(startPart);
    if (ms === null) continue;

    let textLines = lines.slice(timeIdx + 1).map(cleanCaptionLineText).filter(Boolean);
    if (textLines.length === 0) continue;

    // Remove linha superior repetida típica do scroll de 2 linhas do WebVTT do YouTube
    if (textLines.length > 1 && prevLastSubLine && textLines[0] === prevLastSubLine) {
      textLines = textLines.slice(1);
    }
    prevLastSubLine = textLines[textLines.length - 1] || prevLastSubLine;

    const combined = textLines.join(' ').trim();
    if (combined) cues.push({ ms, text: combined });
  }

  return finalizeCaptionCues(cues, isAuto);
}

function selectCaptionEntry(trackMap, preferredLang, isAuto) {
  if (!trackMap || typeof trackMap !== 'object') return null;
  const entries = Object.entries(trackMap).filter(
    ([lang, formats]) => lang !== 'live_chat' && Array.isArray(formats) && formats.length > 0
  );
  if (entries.length === 0) return null;

  const prefLower = (preferredLang || '').toLowerCase();
  const scoreEntry = ([lang, formats]) => {
    const langLower = lang.toLowerCase();
    const hasOriginalUrl = formats.some((f) => typeof f?.url === 'string' && !f.url.includes('tlang='));
    let s = 0;
    if (prefLower && (langLower === prefLower || langLower.startsWith(prefLower + '-'))) s += 100;
    if (langLower.endsWith('-orig')) s += 60;
    if (!isAuto || hasOriginalUrl) s += 40;
    if (/^(en|pt|es)(?:-|$)/i.test(langLower)) s += 20;
    return s;
  };

  entries.sort((a, b) => scoreEntry(b) - scoreEntry(a));
  const [chosenLang, formats] = entries[0];
  const chosenFormat =
    formats.find((f) => f.ext === 'json3' && f.url) ||
    formats.find((f) => f.ext === 'vtt' && f.url) ||
    formats.find((f) => f.ext === 'srt' && f.url);

  return chosenFormat ? { language: chosenLang, ext: chosenFormat.ext, url: chosenFormat.url } : null;
}

async function downloadAndParseCaption(selected, isAuto) {
  const res = await fetch(selected.url, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.trim()) return null;

  const parsed =
    selected.ext === 'json3' ? parseJson3Captions(text, isAuto) : parseVttOrSrtCaptions(text, isAuto);
  if (!parsed) return null;

  return {
    language: selected.language,
    isAuto,
    ...parsed
  };
}

async function getYouTubeCaptions(videoId, { allowAuto = false, onlyManual = false, lang = '' } = {}) {
  const cacheKey = `${videoId}|${onlyManual ? 'manual' : allowAuto ? 'auto' : 'manual'}|${lang}`;
  const cached = ytCaptionsCache.get(cacheKey);
  if (cached) return cached;

  return dedupe(`ytcap:${cacheKey}`, async () => {
    const info = await fetchYouTubeFullInfo(videoId);

    const manualSelected = selectCaptionEntry(info.subtitles, lang, false);
    if (manualSelected) {
      const parsed = await downloadAndParseCaption(manualSelected, false).catch(() => null);
      if (parsed) {
        const result = { found: true, youtubeId: videoId, ...parsed };
        ytCaptionsCache.set(cacheKey, result);
        return result;
      }
    }

    if (!onlyManual && allowAuto) {
      const autoSelected = selectCaptionEntry(info.automaticCaptions, lang, true);
      if (autoSelected) {
        const parsed = await downloadAndParseCaption(autoSelected, true).catch(() => null);
        if (parsed) {
          const result = { found: true, youtubeId: videoId, ...parsed };
          ytCaptionsCache.set(cacheKey, result);
          return result;
        }
      }
    }

    const empty = { found: false, youtubeId: videoId, language: '', isAuto: false, lrc: '', plainText: '', lineCount: 0 };
    ytCaptionsCache.set(cacheKey, empty, 30 * 60 * 1000);
    return empty;
  });
}

// Cliente LRCLIB com User-Agent, cache e espaçamento mínimo entre requisições
let lrclibChain = Promise.resolve();
let lastLrclibAt = 0;
let lrclibCooldownUntil = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLrclibJson(pathAndQuery) {
  const cached = lrclibHttpCache.get(pathAndQuery);
  if (cached) return cached;

  return dedupe(`lrclib:${pathAndQuery}`, async () => {
    const result = await (lrclibChain = lrclibChain.then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, lrclibCooldownUntil - now, lastLrclibAt + LRCLIB_MIN_GAP_MS - now);
      if (waitMs > 0) await sleep(waitMs);
      lastLrclibAt = Date.now();

      try {
        const res = await fetch(`https://lrclib.net${pathAndQuery}`, {
          headers: { 'User-Agent': LRCLIB_UA },
          signal: AbortSignal.timeout(8000)
        });
        if (res.status === 429) {
          lrclibCooldownUntil = Date.now() + 1500;
          return { ok: false, status: 429, rateLimited: true, data: null };
        }
        if (res.status === 404) {
          const notFound = { ok: false, status: 404, rateLimited: false, data: null };
          lrclibHttpCache.set(pathAndQuery, notFound, 30 * 60 * 1000);
          return notFound;
        }
        if (!res.ok) {
          return { ok: false, status: res.status, rateLimited: false, data: null };
        }
        const data = await res.json();
        const okRes = { ok: true, status: 200, rateLimited: false, data };
        lrclibHttpCache.set(pathAndQuery, okRes);
        return okRes;
      } catch (err) {
        return { ok: false, status: 0, rateLimited: false, error: err.message, data: null };
      }
    }));
    return result;
  });
}

function formatLrclibRecord(r, sourceTag) {
  const syncedLyrics = typeof r?.syncedLyrics === 'string' ? r.syncedLyrics : '';
  const plainLyrics = typeof r?.plainLyrics === 'string' ? r.plainLyrics : '';
  const hasSynced = /\[\d{1,3}:\d{2}/.test(syncedLyrics);
  return {
    id: `lrclib-${r.id}`,
    trackName: r.trackName || '',
    artistName: r.artistName || '',
    albumName: r.albumName || '',
    duration: Number(r.duration) || 0,
    syncedLyrics,
    plainLyrics,
    source: hasSynced ? sourceTag : 'lrclib-plain',
    isSynced: hasSynced,
    instrumental: Boolean(r.instrumental),
    score: 0
  };
}

function stripInternalCandidateFields(item) {
  if (!item) return null;
  const { instrumental: _instrumental, ...clean } = item;
  return clean;
}

async function searchLyricsUnified({ title, artist, duration, youtubeId, mode = 'auto', durationUnknown = false }) {
  let meta = parseYouTubeTrackMetadata(title, artist);
  let effectiveDuration = Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0;
  let ytInfo = null;
  let sawRateLimit = false;
  let sawNetworkError = false;

  const isPlaceholder210 = Boolean(youtubeId) && effectiveDuration === 210;
  let isDurationUnknown = durationUnknown || effectiveDuration <= 0 || isPlaceholder210;

  const enrichFromYouTube = async () => {
    if (!youtubeId || ytInfo) return;
    try {
      ytInfo = await fetchYouTubeFullInfo(youtubeId);
      if (ytInfo.duration > 0 && (effectiveDuration <= 0 || isPlaceholder210)) {
        effectiveDuration = ytInfo.duration;
        isDurationUnknown = false;
      }
      // Se o título original veio vazio ou o YT Music trouxe track/artist limpos, incorpora aos candidatos
      if (!meta.rawTitle && ytInfo.rawTitle) {
        meta = parseYouTubeTrackMetadata(ytInfo.track || ytInfo.rawTitle, ytInfo.ytArtist || ytInfo.channel);
      } else if (ytInfo.track || ytInfo.ytArtist) {
        const ytParsed = parseYouTubeTrackMetadata(ytInfo.track || ytInfo.rawTitle, ytInfo.ytArtist || ytInfo.channel);
        const existingKeys = new Set(meta.candidates.map((c) => `${c.trackName.toLowerCase()}||${c.artistName.toLowerCase()}`));
        const extra = ytParsed.candidates.filter(
          (c) => c.artistName && !existingKeys.has(`${c.trackName.toLowerCase()}||${c.artistName.toLowerCase()}`)
        );
        if (extra.length > 0) {
          meta = {
            ...meta,
            cleanArtist: meta.cleanArtist || ytParsed.cleanArtist,
            primaryArtist: meta.primaryArtist || ytParsed.primaryArtist,
            candidates: [...extra, ...meta.candidates]
          };
        }
      }
    } catch (err) {
      console.warn(`[lyrics] falha ao enriquecer metadados YT (${youtubeId}):`, err.message);
    }
  };

  // Se falta duração real ou artista, busca metadados do vídeo antes da consulta ao LRCLIB
  if (youtubeId && (isDurationUnknown || !meta.cleanArtist || !meta.rawTitle)) {
    await enrichFromYouTube();
  }

  const candidateMap = new Map();
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

  const hasStrongSyncedLrclib = () => {
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
    const res = await fetchLrclibJson(pathAndQuery);
    if (res.rateLimited) {
      sawRateLimit = true;
      return;
    }
    if (!res.ok) {
      if (res.status === 0 || res.status >= 500) sawNetworkError = true;
      return;
    }
    const records = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
    addRecords(records, sourceTag);
  };

  // Estágio 1: /api/get direto quando há artista e duração real conhecida (tenta displayTitle e coreTitle)
  if (effectiveDuration > 0 && !isDurationUnknown) {
    const getPairs = meta.candidates.filter((c) => c.artistName).slice(0, 2);
    for (const pair of getPairs) {
      if (mode === 'auto' && hasStrongSyncedLrclib()) break;
      const qs = new URLSearchParams({
        track_name: pair.trackName,
        artist_name: pair.artistName,
        duration: String(effectiveDuration)
      });
      await callLrclib(`/api/get?${qs.toString()}`, 'lrclib-get');
    }
  }

  // Estágio 2: /api/search estruturado por track_name + artist_name (pega todas as versões/durações)
  if (mode === 'search' || !hasStrongSyncedLrclib()) {
    const artistPairs = meta.candidates.filter((c) => c.artistName).slice(0, 3);
    for (const pair of artistPairs) {
      if (mode === 'auto' && hasStrongSyncedLrclib()) break;
      const qs = new URLSearchParams({
        track_name: pair.trackName,
        artist_name: pair.artistName
      });
      await callLrclib(`/api/search?${qs.toString()}`, 'lrclib-search');
    }
  }

  // Estágio 3: busca livre /api/search?q=... se ainda não achou letra sincronizada forte
  if (mode === 'search' || !hasStrongSyncedLrclib()) {
    const freeQueries = [];
    const seenQ = new Set();
    for (const c of meta.candidates) {
      if (c.query && !seenQ.has(c.query.toLowerCase())) {
        seenQ.add(c.query.toLowerCase());
        freeQueries.push(c.query);
      }
    }
    for (const q of freeQueries.slice(0, 2)) {
      if (mode === 'auto' && hasStrongSyncedLrclib()) break;
      await callLrclib(`/api/search?q=${encodeURIComponent(q)}`, 'lrclib-search');
    }
  }

  // Se falhou em achar synced forte e temos youtubeId ainda não enriquecido, tenta enriquecer via YT Music
  if (youtubeId && !ytInfo && !hasStrongSyncedLrclib()) {
    const prevCount = meta.candidates.length;
    await enrichFromYouTube();
    if (meta.candidates.length > prevCount && !sawRateLimit) {
      const extraPair = meta.candidates[0];
      if (extraPair?.artistName) {
        const qs = new URLSearchParams({
          track_name: extraPair.trackName,
          artist_name: extraPair.artistName
        });
        await callLrclib(`/api/search?${qs.toString()}`, 'lrclib-search');
      }
    }
  }

  const allLrclib = Array.from(candidateMap.values()).sort((a, b) => b.score - a.score);
  const bestLrclibSynced = allLrclib.find((c) => c.isSynced && c.score >= 45) || null;
  const bestLrclibPlain = allLrclib.find((c) => !c.isSynced && c.plainLyrics && c.score >= 25) || null;

  const lrclibSkew =
    bestLrclibSynced && effectiveDuration > 0 && !isDurationUnknown && bestLrclibSynced.duration > 0
      ? Math.abs(bestLrclibSynced.duration - effectiveDuration)
      : 0;
  const hasHighConfidenceSynced =
    Boolean(bestLrclibSynced) && bestLrclibSynced.score >= 65 && !(meta.isLiveLike && lrclibSkew > 20);

  // Estágio 4: Legendas do YouTube (manuais primeiro; automáticas só se nada mais existir)
  let ytManualCandidate = null;
  let ytAutoCandidate = null;
  if (youtubeId && (!hasHighConfidenceSynced || mode === 'search')) {
    const manualCap = await getYouTubeCaptions(youtubeId, { onlyManual: true }).catch(() => null);
    if (manualCap?.found) {
      ytManualCandidate = {
        id: `yt-sub-${youtubeId}-${manualCap.language || 'orig'}`,
        trackName: meta.displayTitle || ytInfo?.title || 'Música do YouTube',
        artistName: meta.cleanArtist || ytInfo?.artist || 'YouTube',
        albumName: ytInfo?.album || `YouTube Legendas (${manualCap.language})`,
        duration: effectiveDuration || ytInfo?.duration || 0,
        syncedLyrics: manualCap.lrc,
        plainLyrics: manualCap.plainText,
        source: 'youtube-subtitles',
        isSynced: true,
        // Prioriza sobre LRCLIB ausente ou com grande desvio de duração em vídeo ao vivo
        score: !bestLrclibSynced || (meta.isLiveLike && lrclibSkew > 20) ? 115 : 85
      };
    } else if (!bestLrclibSynced && !bestLrclibPlain) {
      const autoCap = await getYouTubeCaptions(youtubeId, { allowAuto: true }).catch(() => null);
      if (autoCap?.found) {
        ytAutoCandidate = {
          id: `yt-auto-${youtubeId}-${autoCap.language || 'orig'}`,
          trackName: meta.displayTitle || ytInfo?.title || 'Música do YouTube',
          artistName: meta.cleanArtist || ytInfo?.artist || 'YouTube',
          albumName: ytInfo?.album || `YouTube Legendas Automáticas (${autoCap.language})`,
          duration: effectiveDuration || ytInfo?.duration || 0,
          syncedLyrics: autoCap.lrc,
          plainLyrics: autoCap.plainText,
          source: 'youtube-auto-captions',
          isSynced: true,
          score: 35
        };
      }
    }
  }

  // Ordem de prioridade final para `best`:
  // 1) LRCLIB sincronizada de alta confiança
  // 2) Legenda manual do YouTube (.vtt/.json3 -> .lrc)
  // 3) LRCLIB sincronizada secundária (se passou do corte)
  // 4) LRCLIB plainLyrics
  // 5) Legenda automática do YouTube (com texto real não-[Music])
  let best = null;
  if (hasHighConfidenceSynced) {
    best = bestLrclibSynced;
  } else if (ytManualCandidate) {
    best = ytManualCandidate;
  } else if (bestLrclibSynced) {
    best = bestLrclibSynced;
  } else if (bestLrclibPlain) {
    best = bestLrclibPlain;
  } else if (ytAutoCandidate) {
    best = ytAutoCandidate;
  }

  const filteredLrclib = allLrclib.filter((c) => c.score >= (mode === 'search' ? 0 : 20) || c === best);
  const maxLrclib = ytManualCandidate || ytAutoCandidate ? 18 : 20;
  const combined = [...filteredLrclib.slice(0, maxLrclib)];
  if (ytManualCandidate && !combined.includes(ytManualCandidate)) combined.push(ytManualCandidate);
  if (ytAutoCandidate && !combined.includes(ytAutoCandidate)) combined.push(ytAutoCandidate);
  combined.sort((a, b) => b.score - a.score);

  const visibleCandidates = combined
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
      title: meta.displayTitle || ytInfo?.title || '',
      coreTitle: meta.coreTitle || '',
      artist: meta.cleanArtist || ytInfo?.artist || '',
      primaryArtist: meta.primaryArtist || '',
      duration: effectiveDuration,
      album: ytInfo?.album || '',
      track: ytInfo?.track || '',
      youtubeId: youtubeId || null
    }
  };
}

async function handleYtMetadata(res, urlObj) {
  const videoId = cleanString(urlObj.searchParams.get('id'), 20);
  if (!videoId || !VIDEO_ID_RE.test(videoId)) {
    sendJson(res, 400, { error: 'Invalid or missing video id' });
    return;
  }
  try {
    const info = await fetchYouTubeFullInfo(videoId);
    sendJson(res, 200, publicYouTubeMetadata(info));
  } catch (err) {
    sendJson(res, 502, { error: err.message });
  }
}

async function handleYtCaptions(res, urlObj) {
  const videoId = cleanString(urlObj.searchParams.get('id'), 20);
  if (!videoId || !VIDEO_ID_RE.test(videoId)) {
    sendJson(res, 400, { error: 'Invalid or missing video id' });
    return;
  }
  const allowAuto = urlObj.searchParams.get('auto') === '1';
  const lang = cleanString(urlObj.searchParams.get('lang'), 20);

  try {
    const result = await getYouTubeCaptions(videoId, { allowAuto, lang });
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 502, { found: false, youtubeId: videoId, error: err.message });
  }
}

async function handleLyrics(res, urlObj) {
  const title = cleanString(urlObj.searchParams.get('title'), MAX_QUERY_LENGTH);
  const artist = cleanString(urlObj.searchParams.get('artist'), MAX_QUERY_LENGTH);
  const rawYoutubeId = cleanString(urlObj.searchParams.get('youtubeId'), 20);
  const youtubeId = rawYoutubeId && VIDEO_ID_RE.test(rawYoutubeId) ? rawYoutubeId : '';
  const duration = Number(urlObj.searchParams.get('duration'));
  const durationUnknown = urlObj.searchParams.get('durationUnknown') === '1';
  const mode = urlObj.searchParams.get('mode') === 'search' ? 'search' : 'auto';

  if (!title && !youtubeId) {
    sendJson(res, 400, { error: 'Missing title or youtubeId' });
    return;
  }

  const cacheKey = `${mode}|${title.toLowerCase()}|${artist.toLowerCase()}|${Number.isFinite(duration) ? Math.round(duration) : 0}|${youtubeId}|${durationUnknown ? 1 : 0}`;
  const cached = lyricsResultCache.get(cacheKey);
  if (cached) {
    sendJson(res, 200, cached);
    return;
  }

  try {
    const result = await dedupe(`lyrics:${cacheKey}`, () =>
      searchLyricsUnified({ title, artist, duration, youtubeId, mode, durationUnknown })
    );
    if (result.status === 'found') {
      lyricsResultCache.set(cacheKey, result);
    } else if (result.status === 'not_found') {
      lyricsResultCache.set(cacheKey, result, 10 * 60 * 1000);
    }
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { status: 'error', best: null, candidates: [], error: err.message });
  }
}

async function handleYouTubeImport(res, urlObj) {
  const link = parseYouTubeLink(urlObj.searchParams.get('url'));
  if (!link) {
    sendJson(res, 400, { error: 'Link inválido. Insira um link de vídeo ou playlist do YouTube.' });
    return;
  }

  try {
    if (link.playlistId) {
      await importYouTubePlaylist(res, link);
    } else {
      await importYouTubeVideo(res, link.videoId);
    }
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

function createApiMiddleware() {
  return async function apiMiddleware(req, res, next) {
    if (!req.url || !req.url.startsWith('/api/')) {
      next();
      return;
    }

    let urlObj;
    try {
      urlObj = new URL(req.url, 'http://localhost');
    } catch {
      next();
      return;
    }

    const pathname = urlObj.pathname.replace(/\/+$/, '');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      switch (pathname) {
        case '/api/stream':
          await handleStream(req, res, urlObj);
          return;
        case '/api/prefetch':
          handlePrefetch(res, urlObj);
          return;
        case '/api/yt-search':
          await handleYtSearch(res, urlObj);
          return;
        case '/api/yt-metadata':
          await handleYtMetadata(res, urlObj);
          return;
        case '/api/yt-captions':
          await handleYtCaptions(res, urlObj);
          return;
        case '/api/lyrics':
          await handleLyrics(res, urlObj);
          return;
        case '/api/spotify-import':
          await handleSpotifyImport(res, urlObj);
          return;
        case '/api/youtube-import':
          await handleYouTubeImport(res, urlObj);
          return;
        default:
          next();
      }
    } catch (err) {
      console.error(`[api] erro inesperado em ${pathname}:`, err);
      sendJson(res, 500, { error: 'Erro interno' });
    }
  };
}

// ==========================================
// WEBSOCKET "OUVIR JUNTOS" (JAM)
// ==========================================

const ROOM_ID_RE = /^[A-Z0-9]{3,16}$/;
const MAX_WS_PAYLOAD = 64 * 1024;
const HEARTBEAT_MS = 30_000;

// roomId → { clients: Map<ws, username>, state }
const jamRooms = new Map();

function cleanTime(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 24 * 60 * 60) : 0;
}

/** Mantém só os campos necessários para tocar a faixa do outro lado. */
function sanitizeTrack(track) {
  if (!track || typeof track !== 'object') return null;
  const id = cleanString(track.id, 200);
  const title = cleanString(track.title, 300);
  if (!id || !title) return null;

  const cover = cleanString(track.cover, 2000);
  const lyricsLrc = typeof track.lyricsLrc === 'string' ? track.lyricsLrc.slice(0, 40_000) : '';
  const sanitized = {
    id,
    title,
    artist: cleanString(track.artist, 300),
    album: cleanString(track.album, 300),
    cover: /^https?:\/\//i.test(cover) ? cover : '',
    duration: cleanTime(track.duration) || 210,
    hasLyrics: Boolean(lyricsLrc.trim()),
    lyricsLrc
  };
  if (typeof track.youtubeId === 'string' && VIDEO_ID_RE.test(track.youtubeId)) {
    sanitized.youtubeId = track.youtubeId;
  }
  return sanitized;
}

/** Estado da sala com o tempo de reprodução atualizado até agora. */
function currentRoomState(state) {
  if (!state.isPlaying) return state;
  const elapsed = (Date.now() - state.updatedAt) / 1000;
  return { ...state, currentTime: state.currentTime + elapsed, updatedAt: Date.now() };
}

function sendWs(ws, message) {
  if (ws.readyState === 1) {
    ws.send(typeof message === 'string' ? message : JSON.stringify(message));
  }
}

function broadcastToRoom(room, exceptWs, message) {
  const json = JSON.stringify(message);
  for (const clientWs of room.clients.keys()) {
    if (clientWs !== exceptWs) sendWs(clientWs, json);
  }
}

function roomUsers(room) {
  return Array.from(room.clients.values());
}

function leaveRoom(ws, ctx) {
  const roomId = ctx.roomId;
  if (!roomId) return;
  ctx.roomId = null;

  const room = jamRooms.get(roomId);
  if (!room || !room.clients.delete(ws)) return;

  if (room.clients.size === 0) {
    jamRooms.delete(roomId);
    return;
  }

  broadcastToRoom(room, null, {
    type: 'USER_LEFT',
    username: ctx.name,
    userCount: room.clients.size,
    users: roomUsers(room)
  });
}

function handleJamMessage(ws, ctx, data) {
  if (data.type === 'JOIN') {
    const roomId = cleanString(data.roomId, 16).toUpperCase();
    if (!ROOM_ID_RE.test(roomId)) {
      sendWs(ws, { type: 'ERROR', message: 'Código de sala inválido.' });
      return;
    }

    // Se o cliente já estava em outra sala, sai dela antes
    leaveRoom(ws, ctx);
    ctx.roomId = roomId;
    ctx.name = cleanString(data.username, 32) || 'Amigo';

    let room = jamRooms.get(roomId);
    if (!room) {
      const initial = data.initialState && typeof data.initialState === 'object' ? data.initialState : {};
      const track = sanitizeTrack(initial.track);
      room = {
        clients: new Map(),
        state: {
          track,
          isPlaying: Boolean(track && initial.isPlaying),
          currentTime: cleanTime(initial.currentTime),
          updatedAt: Date.now()
        }
      };
      jamRooms.set(roomId, room);
    }

    room.clients.set(ws, ctx.name);
    const users = roomUsers(room);

    sendWs(ws, { type: 'ROOM_SYNC', state: currentRoomState(room.state), userCount: users.length, users });
    broadcastToRoom(room, ws, { type: 'USER_JOINED', username: ctx.name, userCount: users.length, users });
    return;
  }

  const room = ctx.roomId ? jamRooms.get(ctx.roomId) : null;
  if (!room) return;

  if (data.type === 'SYNC_ACTION') {
    const state = room.state;
    const now = Date.now();

    if (data.action === 'PLAY' || data.action === 'PAUSE' || data.action === 'SEEK') {
      const currentTime = cleanTime(data.currentTime);
      state.currentTime = currentTime;
      state.updatedAt = now;
      if (data.action !== 'SEEK') state.isPlaying = data.action === 'PLAY';

      broadcastToRoom(room, ws, { type: 'SYNC_ACTION', action: data.action, payload: { currentTime }, from: ctx.name });
    } else if (data.action === 'CHANGE_TRACK') {
      const track = sanitizeTrack(data.track);
      if (!track) return;
      Object.assign(state, { track, currentTime: 0, isPlaying: true, updatedAt: now });

      // Também volta para quem trocou: se duas pessoas trocarem de faixa ao mesmo tempo
      // (ex.: fim da música com modo aleatório), todos aplicam na mesma ordem e terminam iguais.
      const message = { type: 'SYNC_ACTION', action: 'CHANGE_TRACK', payload: { track }, from: ctx.name };
      broadcastToRoom(room, ws, message);
      sendWs(ws, { ...message, self: true });
    }
    return;
  }

  if (data.type === 'REACTION') {
    const reaction = cleanString(data.reaction, 16);
    if (!reaction) return;
    broadcastToRoom(room, null, { type: 'REACTION', reaction, from: ctx.name });
  }
}

/** Bloqueia conexões WebSocket abertas por outros sites (Cross-Site WebSocket Hijacking). */
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // clientes que não são navegador
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function installJamWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD });

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      return; // deixa outros listeners de upgrade (ex.: HMR do Vite) seguirem
    }
    if (pathname !== '/ws-jam') return;

    if (!isSameOrigin(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    const ctx = { roomId: null, name: 'Amigo' };
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!data || typeof data !== 'object') return;
      try {
        handleJamMessage(ws, ctx, data);
      } catch (err) {
        console.error('[jam] erro ao processar mensagem:', err);
      }
    });

    ws.on('close', () => leaveRoom(ws, ctx));
    ws.on('error', () => {});
  });

  // Derruba conexões mortas (celular que bloqueou a tela, Wi-Fi caiu…) para liberar as salas
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        // conexão já fechando
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  httpServer.on('close', () => {
    clearInterval(heartbeat);
    wss.close();
  });
}

// ==========================================
// PLUGIN DO VITE
// ==========================================

function installBackend(server) {
  if (server.httpServer) {
    installJamWebSocket(server.httpServer);
  }
  server.middlewares.use(createApiMiddleware());
}

export { createApiMiddleware, installJamWebSocket };

export function musicPlayerBackend() {
  return {
    name: 'music-player-backend-services',
    configureServer: installBackend,
    configurePreviewServer: installBackend
  };
}
