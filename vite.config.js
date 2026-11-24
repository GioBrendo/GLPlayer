import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { WebSocketServer } from 'ws';
import { Readable } from 'stream';

const execFileAsync = promisify(execFile);

// Cache em memória para buscas rápidas
const videoIdCache = new Map();
const streamUrlCache = new Map();

// Salas ativas para o modo "Ouvir Juntos" (Jam sincronizado)
const jamRooms = new Map();

async function findBestVideoId(cleanQuery, badIds = []) {
  const searchQueries = [
    `${cleanQuery} letra`,
    `${cleanQuery} lyrics`,
    `${cleanQuery} audio`,
    cleanQuery
  ];

  for (const q of searchQueries) {
    try {
      const ytUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
      const fetchRes = await fetch(ytUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        signal: AbortSignal.timeout(3000)
      });

      if (fetchRes.ok) {
        const html = await fetchRes.text();
        const matches = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map(m => m[1]);
        const uniqueIds = Array.from(new Set(matches));

        for (const candidateId of uniqueIds.slice(0, 5)) {
          if (!candidateId || badIds.includes(candidateId)) continue;

          try {
            const oeRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${candidateId}&format=json`, {
              signal: AbortSignal.timeout(1500)
            });
            if (oeRes.ok) {
              const oe = await oeRes.json();
              const author = (oe.author_name || '').toLowerCase();
              if (author.includes('vevo') || author.includes('- topic') || author.endsWith(' topic')) {
                continue;
              }
              return candidateId;
            }
          } catch (oeErr) {}
        }
      }
    } catch (fetchErr) {}
  }

  // Fallback yt-dlp
  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      '--no-warnings',
      '--no-playlist',
      '--print',
      '%(id)s||%(channel)s',
      `ytsearch6:${cleanQuery} audio`
    ], { timeout: 10000 });

    const lines = stdout.trim().split('\n');
    for (const line of lines) {
      const parts = line.split('||');
      const id = parts[0]?.trim();
      const channel = (parts[1] || '').trim().toLowerCase();

      if (id && id.length >= 11 && !badIds.includes(id)) {
        if (!channel.includes('vevo') && !channel.includes('- topic')) {
          return id;
        }
      }
    }
  } catch (ytdlpErr) {}

  return null;
}

async function getDirectAudioStreamUrl(videoId, fallbackQuery = null) {
  if (videoId && streamUrlCache.has(videoId)) {
    return streamUrlCache.get(videoId);
  }

  // 1. Tenta obter pelo videoId se fornecido
  if (videoId) {
    try {
      const { stdout } = await execFileAsync('yt-dlp', [
        '--no-warnings',
        '--no-playlist',
        '-g',
        '-f', 'bestaudio[ext=m4a]/bestaudio',
        `https://www.youtube.com/watch?v=${videoId}`
      ], { timeout: 12000 });

      const url = stdout.trim().split('\n')[0];
      if (url && url.startsWith('http')) {
        streamUrlCache.set(videoId, url);
        return url;
      }
    } catch (err) {
      console.warn(`yt-dlp falhou para videoId ${videoId}:`, err.message);
    }
  }

  // 2. Se falhar ou não tiver videoId, busca direto por áudio usando fallbackQuery
  if (fallbackQuery) {
    try {
      const { stdout } = await execFileAsync('yt-dlp', [
        '--no-warnings',
        '--no-playlist',
        '-g',
        '-f', 'bestaudio[ext=m4a]/bestaudio',
        `ytsearch1:${fallbackQuery} audio`
      ], { timeout: 15000 });

      const url = stdout.trim().split('\n')[0];
      if (url && url.startsWith('http')) {
        if (videoId) streamUrlCache.set(videoId, url);
        return url;
      }
    } catch (err) {
      console.warn(`yt-dlp busca direta falhou para "${fallbackQuery}":`, err.message);
    }
  }

  return null;
}

function broadcastToRoom(roomId, senderWs, messageObj) {
  if (!jamRooms.has(roomId)) return;
  const room = jamRooms.get(roomId);
  const jsonStr = JSON.stringify(messageObj);
  for (const [clientWs] of room.clients) {
    if (clientWs !== senderWs && clientWs.readyState === 1) { // 1 = OPEN
      clientWs.send(jsonStr);
    }
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'music-player-backend-services',
      configureServer(server) {
        // ==========================================
        // 1. WEBSOCKET PARA OUVIR JUNTOS SINCRONIZADO
        // ==========================================
        if (server.httpServer) {
          const wss = new WebSocketServer({ noServer: true });

          server.httpServer.on('upgrade', (req, socket, head) => {
            try {
              const url = new URL(req.url, 'http://localhost');
              if (url.pathname === '/ws-jam') {
                wss.handleUpgrade(req, socket, head, (ws) => {
                  wss.emit('connection', ws, req);
                });
              }
            } catch (err) {
              // Deixa outros listeners de upgrade (como o Vite HMR) seguirem
            }
          });

          wss.on('connection', (ws) => {
            let userRoomId = null;
            let userName = 'Ouvinte';

            ws.on('message', (messageRaw) => {
              try {
                const data = JSON.parse(messageRaw.toString());

                if (data.type === 'JOIN') {
                  userRoomId = data.roomId.toUpperCase().trim();
                  userName = data.username || 'Amigo';

                  if (!jamRooms.has(userRoomId)) {
                    jamRooms.set(userRoomId, {
                      clients: new Map(),
                      state: data.initialState || {
                        track: null,
                        isPlaying: false,
                        currentTime: 0,
                        updatedAt: Date.now()
                      }
                    });
                  }

                  const room = jamRooms.get(userRoomId);
                  room.clients.set(ws, userName);

                  // Envia estado atual para o novo integrante
                  ws.send(JSON.stringify({
                    type: 'ROOM_SYNC',
                    state: room.state,
                    userCount: room.clients.size,
                    users: Array.from(room.clients.values())
                  }));

                  // Notifica os outros integrantes
                  broadcastToRoom(userRoomId, ws, {
                    type: 'USER_JOINED',
                    username: userName,
                    userCount: room.clients.size,
                    users: Array.from(room.clients.values())
                  });
                } else if (data.type === 'SYNC_ACTION') {
                  if (!userRoomId || !jamRooms.has(userRoomId)) return;
                  const room = jamRooms.get(userRoomId);

                  if (data.action === 'PLAY') {
                    room.state.isPlaying = true;
                    room.state.currentTime = data.currentTime;
                    room.state.updatedAt = Date.now();
                  } else if (data.action === 'PAUSE') {
                    room.state.isPlaying = false;
                    room.state.currentTime = data.currentTime;
                    room.state.updatedAt = Date.now();
                  } else if (data.action === 'SEEK') {
                    room.state.currentTime = data.currentTime;
                    room.state.updatedAt = Date.now();
                  } else if (data.action === 'CHANGE_TRACK') {
                    room.state.track = data.track;
                    room.state.currentTime = 0;
                    room.state.isPlaying = true;
                    room.state.updatedAt = Date.now();
                  }

                  broadcastToRoom(userRoomId, ws, {
                    type: 'SYNC_ACTION',
                    action: data.action,
                    payload: data,
                    from: userName
                  });
                } else if (data.type === 'REACTION') {
                  if (!userRoomId) return;
                  broadcastToRoom(userRoomId, null, {
                    type: 'REACTION',
                    reaction: data.reaction,
                    from: userName
                  });
                }
              } catch (err) {
                console.error('Erro no WebSocket Jam:', err);
              }
            });

            ws.on('close', () => {
              if (userRoomId && jamRooms.has(userRoomId)) {
                const room = jamRooms.get(userRoomId);
                room.clients.delete(ws);
                if (room.clients.size === 0) {
                  jamRooms.delete(userRoomId);
                } else {
                  broadcastToRoom(userRoomId, null, {
                    type: 'USER_LEFT',
                    username: userName,
                    userCount: room.clients.size,
                    users: Array.from(room.clients.values())
                  });
                }
              }
            });
          });
        }

        // ==========================================
        // MIDDLEWARE UNIFICADO DE SERVIÇOS BACKEND
        // ==========================================
        server.middlewares.use(async (req, res, next) => {
          let urlObj;
          try {
            urlObj = new URL(req.url, 'http://localhost');
          } catch (e) {
            return next();
          }

          const pathname = urlObj.pathname.replace(/\/+$/, '');

          if (pathname.startsWith('/api/')) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
            if (req.method === 'OPTIONS') {
              res.statusCode = 200;
              res.end();
              return;
            }
          }

          // 1. STREAMING UNIVERSAL DE ÁUDIO (/api/stream)
          if (pathname === '/api/stream') {
            try {
              let videoId = urlObj.searchParams.get('id');
              const query = urlObj.searchParams.get('q');

              if (!videoId && !query) {
                res.statusCode = 400;
                res.end('Missing video id or search query');
                return;
              }

              if (!videoId && query) {
                const cleanQ = query.trim();
                if (videoIdCache.has(cleanQ)) {
                  videoId = videoIdCache.get(cleanQ);
                }
              }

              const audioUrl = await getDirectAudioStreamUrl(videoId, query);
              if (!audioUrl) {
                res.statusCode = 502;
                res.end('Audio stream unavailable');
                return;
              }

              const fetchHeaders = {};
              if (req.headers.range) {
                fetchHeaders['Range'] = req.headers.range;
              }

              const upstream = await fetch(audioUrl, {
                headers: fetchHeaders,
                signal: AbortSignal.timeout(30000)
              });

              res.statusCode = upstream.status;
              res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mp4');
              if (upstream.headers.has('content-length')) {
                res.setHeader('Content-Length', upstream.headers.get('content-length'));
              }
              if (upstream.headers.has('content-range')) {
                res.setHeader('Content-Range', upstream.headers.get('content-range'));
              }
              res.setHeader('Accept-Ranges', 'bytes');
              res.setHeader('Access-Control-Allow-Origin', '*');

              if (req.method === 'HEAD') {
                res.end();
                return;
              }

              if (upstream.body) {
                const stream = Readable.fromWeb(upstream.body);
                req.on('close', () => {
                  try { stream.destroy(); } catch (e) {}
                });
                stream.pipe(res);
              } else {
                res.end();
              }
            } catch (err) {
              console.warn('Erro no /api/stream:', err.message);
              if (!res.headersSent) {
                res.statusCode = 500;
                res.end(err.message);
              }
            }
            return;
          }

          // 2. BUSCA DE ÁUDIO NO YOUTUBE (/api/yt-search)
          if (pathname === '/api/yt-search') {
            try {
              const query = urlObj.searchParams.get('q');
              const badId = urlObj.searchParams.get('badId');
              if (!query) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Missing query parameter q' }));
                return;
              }

              const cleanQuery = query.trim();

              if (badId) {
                videoIdCache.delete(cleanQuery);
              } else if (videoIdCache.has(cleanQuery)) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ videoId: videoIdCache.get(cleanQuery), cached: true }));
                return;
              }

              const badIds = badId ? [badId] : [];
              const foundId = await findBestVideoId(cleanQuery, badIds);

              if (foundId) {
                videoIdCache.set(cleanQuery, foundId);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ videoId: foundId, success: true }));
              } else {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ videoId: null, message: 'Vídeo não encontrado' }));
              }
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
            return;
          }

          // 3. IMPORTAÇÃO DO SPOTIFY (/api/spotify-import)
          if (pathname === '/api/spotify-import') {
            try {
              const spotifyUrl = urlObj.searchParams.get('url');
              if (!spotifyUrl) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Parâmetro url ausente' }));
                return;
              }

              const match = spotifyUrl.match(/open\.spotify\.com\/(album|playlist|track)\/([a-zA-Z0-9]+)/);
              if (!match) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ 
                  error: 'Link inválido. O formato deve ser https://open.spotify.com/album/[ID] ou https://open.spotify.com/playlist/[ID]' 
                }));
                return;
              }

              const type = match[1];
              const id = match[2];
              const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;

              const fetchRes = await fetch(embedUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                  'Accept-Language': 'en-US,en;q=0.5'
                }
              });

              if (!fetchRes.ok) {
                throw new Error(`Falha ao acessar Spotify (${fetchRes.status}: ${fetchRes.statusText})`);
              }

              const html = await fetchRes.text();
              const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
              if (!nextDataMatch) {
                throw new Error('Não foi possível ler as faixas deste link do Spotify.');
              }

              const data = JSON.parse(nextDataMatch[1]);
              const entity = data.props?.pageProps?.state?.data?.entity;
              if (!entity) {
                throw new Error('Álbum ou Playlist não encontrado no Spotify. Verifique se o link está correto.');
              }

              const title = entity.title || entity.name || 'Álbum Importado';
              const artist = entity.subtitle || entity.authors?.[0]?.name || 'Spotify';
              const cover = 
                entity.visualIdentity?.image?.[1]?.url || 
                entity.visualIdentity?.image?.[0]?.url || 
                entity.coverArt?.sources?.[0]?.url || 
                'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop';

              const tracks = (entity.trackList || []).map((t, idx) => ({
                id: 'sp-' + (t.uid || (t.uri ? t.uri.replace('spotify:track:', '') : `${id}-${idx}`)),
                title: t.title,
                artist: t.subtitle || artist,
                album: title,
                cover: cover,
                duration: Math.round((t.duration || 210000) / 1000),
                hasLyrics: false,
                lyricsLrc: ''
              }));

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                success: true,
                playlist: {
                  id: `pl-sp-${id}`,
                  name: title,
                  description: `${type === 'album' ? 'Álbum' : 'Playlist'} do Spotify • ${artist} • ${tracks.length} músicas`,
                  cover: cover,
                  tracks: tracks
                }
              }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
            return;
          }

          // 4. IMPORTAÇÃO DO YOUTUBE (/api/youtube-import)
          if (pathname === '/api/youtube-import') {
            try {
              const ytUrl = urlObj.searchParams.get('url');
              if (!ytUrl) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Parâmetro url ausente' }));
                return;
              }

              const cleanUrl = ytUrl.trim();
              const isPlaylist = cleanUrl.includes('list=') || cleanUrl.includes('/playlist');

              if (isPlaylist) {
                const { stdout } = await execFileAsync('yt-dlp', [
                  '--no-warnings',
                  '--flat-playlist',
                  '--playlist-end', '100',
                  '--print', '%(playlist_title)s\t%(id)s\t%(title)s\t%(uploader)s\t%(duration)s',
                  cleanUrl
                ], { timeout: 25000 });

                const lines = stdout.trim().split('\n').filter(Boolean);
                if (lines.length === 0) {
                  throw new Error('Nenhuma faixa encontrada nesta playlist do YouTube.');
                }

                let playlistTitle = 'Playlist do YouTube';
                const tracks = [];

                for (const line of lines) {
                  const parts = line.split('\t');
                  const plTitle = parts[0]?.trim();
                  const videoId = parts[1]?.trim();
                  const trackTitle = parts[2]?.trim();
                  const uploader = parts[3]?.trim();
                  const durationSec = parseInt(parts[4], 10);

                  if (plTitle && plTitle !== 'NA' && playlistTitle === 'Playlist do YouTube') {
                    playlistTitle = plTitle;
                  }

                  if (videoId && videoId.length >= 11) {
                    tracks.push({
                      id: 'yt-' + videoId,
                      youtubeId: videoId,
                      title: trackTitle || 'Música do YouTube',
                      artist: uploader || 'YouTube',
                      album: playlistTitle,
                      cover: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                      duration: !isNaN(durationSec) && durationSec > 0 ? durationSec : 210,
                      hasLyrics: false,
                      lyricsLrc: ''
                    });
                  }
                }

                if (tracks.length === 0) {
                  throw new Error('Não foi possível extrair faixas válidas desta playlist.');
                }

                const playlistIdMatch = cleanUrl.match(/list=([a-zA-Z0-9_-]+)/);
                const playlistId = playlistIdMatch ? playlistIdMatch[1] : 'yt-' + Date.now();

                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                  success: true,
                  type: 'playlist',
                  playlist: {
                    id: `pl-yt-${playlistId}`,
                    name: playlistTitle,
                    description: `Playlist do YouTube • ${tracks.length} músicas`,
                    cover: tracks[0]?.cover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop',
                    tracks: tracks
                  }
                }));
                return;
              }

              const videoIdMatch = cleanUrl.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
              if (!videoIdMatch) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ 
                  error: 'Link inválido. Insira um link de vídeo ou playlist do YouTube.' 
                }));
                return;
              }

              const videoId = videoIdMatch[1];
              let title = 'Música do YouTube';
              let artist = 'YouTube';
              let duration = 210;

              try {
                const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
                  signal: AbortSignal.timeout(3500)
                });
                if (oembedRes.ok) {
                  const oembed = await oembedRes.json();
                  if (oembed.title) title = oembed.title;
                  if (oembed.author_name) artist = oembed.author_name;
                }
              } catch (oeErr) {}

              if (title === 'Música do YouTube') {
                try {
                  const { stdout } = await execFileAsync('yt-dlp', [
                    '--no-warnings',
                    '--no-playlist',
                    '--print', '%(title)s\t%(uploader)s\t%(duration)s',
                    `https://www.youtube.com/watch?v=${videoId}`
                  ], { timeout: 8000 });

                  const parts = stdout.trim().split('\t');
                  if (parts[0]) title = parts[0].trim();
                  if (parts[1]) artist = parts[1].trim();
                  const dur = parseInt(parts[2], 10);
                  if (!isNaN(dur) && dur > 0) duration = dur;
                } catch (ytdlpErr) {}
              }

              const track = {
                id: 'yt-' + videoId,
                youtubeId: videoId,
                title: title,
                artist: artist,
                album: 'YouTube',
                cover: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                duration: duration,
                hasLyrics: false,
                lyricsLrc: ''
              };

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                success: true,
                type: 'track',
                track: track
              }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
            return;
          }

          next();
        });
      }
    }
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    cors: true
  }
});
