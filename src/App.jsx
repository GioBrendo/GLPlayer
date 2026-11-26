import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { Users } from 'lucide-react';
import { initialTracks } from './data/tracks';
import { defaultPlaylists } from './data/defaultPlaylists';
import Sidebar from './components/Sidebar';
import PlayerBar from './components/PlayerBar';
import LyricsView from './components/LyricsView';
import TrackList from './components/TrackList';
import OnlineSearch from './components/OnlineSearch';
import HomeView from './components/HomeView';
import YouTubePlayer from './components/YouTubePlayer';
import PlaylistModal from './components/PlaylistModal';
import AddToPlaylistModal from './components/AddToPlaylistModal';
import JamModal from './components/JamModal';
import FloatingReactions from './components/FloatingReactions';
import { resolveYouTubeId, buildTrackQuery } from './utils/itunesApi';
import { jamSocket } from './utils/jamSocket';
import { loadJSON, loadString, saveJSON, saveString } from './utils/storage';
import './App.css';

const DEFAULT_COVER = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';
const MAX_CONSECUTIVE_ERRORS = 3;
const JAM_DRIFT_TOLERANCE = 1.5; // segundos de diferença tolerados entre ouvintes
const AUDIO_FILE_RE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i;

const initialTracksById = new Map(initialTracks.map((t) => [t.id, t]));

/** Faixa tocada a partir de um arquivo do computador (URL blob: só vale nesta aba). */
const isLocalFileTrack = (track) => !!track?.audioUrl?.startsWith('blob:');

function buildStreamSrc(track) {
  const params = new URLSearchParams();
  if (track.youtubeId) params.set('id', track.youtubeId);
  const query = buildTrackQuery(track.title, track.artist);
  if (query) params.set('q', query);
  const qs = params.toString();
  return qs ? `/api/stream?${qs}` : '';
}

/** Versão da faixa enviada para os amigos no Jam (sem URL blob:, que só existe neste navegador). */
function shareableTrack(track) {
  if (!track) return null;
  const { audioUrl: _audioUrl, ...rest } = track;
  return rest;
}

// ==========================================
// CARREGAMENTO INICIAL (LocalStorage)
// ==========================================

function loadInitialTracks() {
  const overrides = loadJSON('track_overrides', {});
  const base = initialTracks.map((t) =>
    overrides && typeof overrides === 'object' && overrides[t.id] ? { ...t, ...overrides[t.id] } : t
  );

  const saved = loadJSON('custom_tracks', []);
  if (!Array.isArray(saved)) return base;

  const seen = new Set(initialTracksById.keys());
  const custom = saved.filter((t) => {
    if (!t || typeof t.id !== 'string' || !t.title || seen.has(t.id) || isLocalFileTrack(t)) return false;
    seen.add(t.id);
    return true;
  });
  return [...base, ...custom];
}

/** Para as faixas padrão, guarda só o que o usuário mudou (YouTube ID resolvido e letras). */
function buildTrackOverrides(tracks) {
  const overrides = {};
  for (const track of tracks) {
    const original = initialTracksById.get(track.id);
    if (!original) continue;
    const diff = {};
    if (track.youtubeId && track.youtubeId !== original.youtubeId) diff.youtubeId = track.youtubeId;
    if ((track.lyricsLrc || '') !== (original.lyricsLrc || '')) {
      diff.lyricsLrc = track.lyricsLrc || '';
      diff.hasLyrics = !!track.hasLyrics;
    }
    if (Object.keys(diff).length > 0) overrides[track.id] = diff;
  }
  return overrides;
}

function loadInitialPlaylists() {
  const saved = loadJSON('playlists', null);
  if (Array.isArray(saved)) {
    return saved.filter((p) => p && typeof p.id === 'string');
  }
  return defaultPlaylists;
}

function loadInitialFavorites() {
  const saved = loadJSON('favorites', []);
  return Array.isArray(saved) ? saved.filter((t) => t && typeof t.id === 'string' && !isLocalFileTrack(t)) : [];
}

function loadInitialVolume() {
  const value = parseFloat(loadString('volume', ''));
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.8;
}

function isTypingTarget(el) {
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

export default function App() {
  // ==========================================
  // ESTADO DA BIBLIOTECA
  // ==========================================
  const [tracks, setTracks] = useState(loadInitialTracks);
  const [playlists, setPlaylists] = useState(loadInitialPlaylists);
  const [activePlaylistId, setActivePlaylistId] = useState(null);
  const [favorites, setFavorites] = useState(loadInitialFavorites);

  // ==========================================
  // ESTADO DE REPRODUÇÃO
  // ==========================================
  // A faixa atual é guardada pelo ID (não pelo índice): inserir faixas na
  // biblioteca não pode trocar a música que está tocando.
  const [currentTrackId, setCurrentTrackId] = useState(
    () => loadString('last_track') || initialTracks[0]?.id || null
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(loadInitialVolume);
  const [isMuted, setIsMuted] = useState(false);
  const [isShuffle, setIsShuffle] = useState(() => loadString('shuffle') === 'true');
  const [repeatMode, setRepeatMode] = useState(() => {
    const saved = loadString('repeat');
    return saved === 'all' || saved === 'one' ? saved : 'off';
  });

  // ==========================================
  // ESTADO DA INTERFACE
  // ==========================================
  const [currentTab, setCurrentTab] = useState('home');
  const [isLyricsOpen, setIsLyricsOpen] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [playlistModalTab, setPlaylistModalTab] = useState('manual');
  const [playlistToEdit, setPlaylistToEdit] = useState(null);
  const [isAddToPlaylistOpen, setIsAddToPlaylistOpen] = useState(false);
  const [trackToAddToPlaylist, setTrackToAddToPlaylist] = useState(null);
  const [toast, setToast] = useState(null);

  // ==========================================
  // ESTADO DE "OUVIR JUNTOS" (JAM SINCRONIZADO)
  // ==========================================
  const [isJamModalOpen, setIsJamModalOpen] = useState(
    () => new URLSearchParams(window.location.search).has('room')
  );
  const [activeJamRoomId, setActiveJamRoomId] = useState(null);
  const [jamUsers, setJamUsers] = useState([]);
  const [floatingReactions, setFloatingReactions] = useState([]);

  // ==========================================
  // DADOS DERIVADOS
  // ==========================================
  const tracksById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const currentTrack = (currentTrackId && tracksById.get(currentTrackId)) || tracks[0] || null;
  const isLocalTrack = isLocalFileTrack(currentTrack);

  const activePlaylist = playlists.find((p) => p.id === activePlaylistId) || playlists[0] || null;

  const activePlaylistTracks = useMemo(() => {
    if (!activePlaylist || !Array.isArray(activePlaylist.trackIds)) return [];
    return activePlaylist.trackIds.map((id) => tracksById.get(id)).filter(Boolean);
  }, [activePlaylist, tracksById]);

  // Favoritos guardam uma cópia da faixa; mostra sempre a versão mais nova (ex.: letra baixada depois)
  const favoriteTracks = useMemo(
    () => favorites.map((f) => tracksById.get(f.id) || f),
    [favorites, tracksById]
  );
  const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites]);

  // ==========================================
  // REFS (valores atuais para callbacks estáveis e eventos do <audio>)
  // ==========================================
  // Um único <audio> para toda a sessão (no celular, só ele fica "liberado" para tocar)
  const [audioElement] = useState(() => {
    const audio = new Audio();
    audio.preload = 'none';
    return audio;
  });
  const audioRef = useRef(audioElement);

  const currentTrackRef = useRef(currentTrack);
  const tracksRef = useRef(tracks);
  const isPlayingRef = useRef(isPlaying);
  const isShuffleRef = useRef(isShuffle);
  const repeatModeRef = useRef(repeatMode);
  const jamRoomRef = useRef(activeJamRoomId);

  useLayoutEffect(() => {
    currentTrackRef.current = currentTrack;
    tracksRef.current = tracks;
    isPlayingRef.current = isPlaying;
    isShuffleRef.current = isShuffle;
    repeatModeRef.current = repeatMode;
    jamRoomRef.current = activeJamRoomId;
  });

  const queueRef = useRef(null); // lista de onde a reprodução começou (playlist, favoritas, busca…)
  const pendingSeekRef = useRef(null); // seek pedido antes do áudio carregar
  const retryCountRef = useRef(0);
  const errorCountRef = useRef(0);
  const resolvingIdsRef = useRef(new Set());
  const toastTimerRef = useRef(null);
  const jamSeekTimerRef = useRef(null);

  // ==========================================
  // PERSISTÊNCIA
  // ==========================================
  useEffect(() => {
    saveJSON('playlists', playlists);
  }, [playlists]);

  useEffect(() => {
    // Arquivos locais (blob:) não sobrevivem a um recarregamento, então não são salvos
    const customTracks = tracks.filter((t) => !initialTracksById.has(t.id) && !isLocalFileTrack(t));
    saveJSON('custom_tracks', customTracks);
    saveJSON('track_overrides', buildTrackOverrides(tracks));
  }, [tracks]);

  useEffect(() => {
    saveJSON('favorites', favorites.filter((t) => !isLocalFileTrack(t)));
  }, [favorites]);

  useEffect(() => {
    saveString('volume', String(volume));
  }, [volume]);

  useEffect(() => {
    if (currentTrackId) saveString('last_track', currentTrackId);
  }, [currentTrackId]);

  useEffect(() => {
    saveString('shuffle', String(isShuffle));
    saveString('repeat', repeatMode);
  }, [isShuffle, repeatMode]);

  // ==========================================
  // NOTIFICAÇÕES
  // ==========================================
  const showToast = useCallback((msg, ms = 3000) => {
    clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), ms);
  }, []);

  const triggerFloatingReaction = useCallback((emoji, from) => {
    const id = Date.now() + Math.random();
    const x = Math.floor(Math.random() * 50) + 25; // Entre 25% e 75% da largura
    setFloatingReactions((prev) => [...prev.slice(-20), { id, emoji, from, x }]);
    setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
    }, 2500);
  }, []);

  // ==========================================
  // CONTROLE DE REPRODUÇÃO
  // ==========================================
  const setPlaying = useCallback((value) => {
    isPlayingRef.current = value;
    setIsPlaying(value);
  }, []);

  const safePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio.src) return;
    audio.preload = 'auto';
    const promise = audio.play();
    promise?.catch((err) => {
      if (err?.name === 'NotAllowedError') {
        // Navegador bloqueou o autoplay: espera o usuário apertar play
        setPlaying(false);
        showToast('▶️ Toque em play para começar a ouvir.');
      }
      // AbortError: a faixa foi trocada durante o carregamento (esperado)
    });
  }, [setPlaying, showToast]);

  const sendJamSeek = useCallback((time) => {
    clearTimeout(jamSeekTimerRef.current);
    // Arrastar a barra de progresso gera dezenas de eventos: envia só o último
    jamSeekTimerRef.current = setTimeout(() => {
      jamSocket.sendSyncAction('SEEK', { currentTime: time });
    }, 250);
  }, []);

  const seekTo = useCallback((time, { broadcast = true } = {}) => {
    const audio = audioRef.current;
    const target = Math.max(0, Number(time) || 0);
    setCurrentTime(target);
    if (audio.readyState >= 1 /* HAVE_METADATA */) {
      audio.currentTime = target;
    } else {
      pendingSeekRef.current = target;
    }
    if (broadcast && jamRoomRef.current) sendJamSeek(target);
  }, [sendJamSeek]);

  /**
   * Toca uma faixa.
   * @param {object} track
   * @param {object} options queue: lista de contexto para próxima/anterior,
   *                         fromRemote: veio do Jam (não reenviar), startAt: segundo inicial
   */
  const playTrack = useCallback((track, { queue, fromRemote = false, startAt = 0 } = {}) => {
    if (!track?.id) return;
    if (queue) queueRef.current = queue;

    if (track.id === currentTrackRef.current?.id) {
      // Mesma faixa: apenas volta para o ponto pedido
      setCurrentTrackId(track.id);
      seekTo(startAt, { broadcast: false });
      setPlaying(true);
      safePlay();
    } else {
      setTracks((prev) => (prev.some((t) => t.id === track.id) ? prev : [track, ...prev]));
      setCurrentTrackId(track.id);
      setCurrentTime(startAt);
      setDuration(track.duration || 0);
      pendingSeekRef.current = startAt > 0 ? startAt : null;
      setPlaying(true);
    }

    if (!fromRemote && jamRoomRef.current) {
      jamSocket.sendSyncAction('CHANGE_TRACK', { track: shareableTrack(track) });
    }
  }, [seekTo, setPlaying, safePlay]);

  const togglePlay = useCallback(() => {
    const next = !isPlayingRef.current;
    setPlaying(next);
    // play() direto no clique: navegadores móveis exigem gesto do usuário
    if (next) safePlay();
    else audioRef.current.pause();

    if (jamRoomRef.current) {
      jamSocket.sendSyncAction(next ? 'PLAY' : 'PAUSE', { currentTime: audioRef.current.currentTime });
    }
  }, [setPlaying, safePlay]);

  /** Fila atual: a lista de onde a música foi iniciada, ou a biblioteca inteira. */
  const getQueue = useCallback(() => {
    const queue = queueRef.current;
    const current = currentTrackRef.current;
    if (queue && queue.length > 0 && queue.some((t) => t.id === current?.id)) {
      const byId = new Map(tracksRef.current.map((t) => [t.id, t]));
      return queue.map((t) => byId.get(t.id) || t);
    }
    return tracksRef.current;
  }, []);

  const playNext = useCallback(({ auto = false } = {}) => {
    const queue = getQueue();
    if (queue.length === 0) return;
    const current = currentTrackRef.current;
    const index = queue.findIndex((t) => t.id === current?.id);

    let next;
    if (isShuffleRef.current && queue.length > 1) {
      const pool = queue.filter((t) => t.id !== current?.id);
      next = pool[Math.floor(Math.random() * pool.length)];
    } else {
      // Fim da fila com repetição desligada: para em vez de recomeçar
      if (auto && repeatModeRef.current === 'off' && index === queue.length - 1) {
        setPlaying(false);
        return;
      }
      next = queue[(index + 1) % queue.length];
    }

    if (next) playTrack(next);
  }, [getQueue, playTrack, setPlaying]);

  const playPrev = useCallback(() => {
    // Como nos players tradicionais: depois de 3s, "anterior" reinicia a música
    if (audioRef.current.currentTime > 3) {
      seekTo(0);
      return;
    }
    const queue = getQueue();
    if (queue.length === 0) return;
    const index = queue.findIndex((t) => t.id === currentTrackRef.current?.id);
    const prev = index === -1 ? queue[0] : queue[(index - 1 + queue.length) % queue.length];
    if (prev) playTrack(prev);
  }, [getQueue, playTrack, seekTo]);

  const handleTrackEnded = useCallback(() => {
    if (repeatModeRef.current === 'one') {
      audioRef.current.currentTime = 0;
      safePlay();
      return;
    }
    playNext({ auto: true });
  }, [playNext, safePlay]);

  const handleAudioError = useCallback(() => {
    const audio = audioRef.current;
    const track = currentTrackRef.current;
    if (!track || !audio.src) return;

    // 1ª falha: tenta de novo (o servidor renova o link do YouTube) mantendo a posição
    if (!isLocalFileTrack(track) && retryCountRef.current < 1) {
      retryCountRef.current += 1;
      const resumeAt = audio.currentTime || pendingSeekRef.current || 0;
      pendingSeekRef.current = resumeAt > 0 ? resumeAt : null;
      const latest = tracksRef.current.find((t) => t.id === track.id) || track;
      const src = buildStreamSrc(latest);
      if (src) {
        audio.src = `${src}&retry=${Date.now()}`;
        if (isPlayingRef.current) safePlay();
        return;
      }
    }

    console.warn('Falha ao reproduzir:', track.title, audio.error);
    errorCountRef.current += 1;

    if (jamRoomRef.current) {
      // No Jam, pular sozinho trocaria a música de todo mundo
      setPlaying(false);
      showToast(`⚠️ Não foi possível tocar "${track.title}" neste aparelho.`, 4500);
      return;
    }

    if (errorCountRef.current >= MAX_CONSECUTIVE_ERRORS) {
      errorCountRef.current = 0;
      setPlaying(false);
      showToast('⚠️ Várias músicas falharam seguidas. Verifique a internet e se o yt-dlp está instalado.', 6000);
      return;
    }

    showToast(`⚠️ Não foi possível tocar "${track.title}". Pulando…`, 3500);
    playNext();
  }, [playNext, safePlay, setPlaying, showToast]);

  // Eventos do elemento <audio> (registrados uma vez; os handlers usam refs)
  const audioHandlersRef = useRef({});
  useLayoutEffect(() => {
    audioHandlersRef.current = { onEnded: handleTrackEnded, onError: handleAudioError };
  });

  useEffect(() => {
    const audio = audioRef.current;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
      if (pendingSeekRef.current !== null) {
        const target = pendingSeekRef.current;
        pendingSeekRef.current = null;
        audio.currentTime = Number.isFinite(audio.duration) ? Math.max(0, Math.min(target, audio.duration - 0.5)) : target;
      }
    };
    const onPlaying = () => {
      errorCountRef.current = 0;
      retryCountRef.current = 0;
    };
    const onEnded = () => audioHandlersRef.current.onEnded();
    const onError = () => audioHandlersRef.current.onError();

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, []);

  // Troca a fonte do áudio SOMENTE quando a faixa muda. Antes, a fonte também mudava
  // quando o YouTube ID era resolvido em segundo plano, reiniciando a música do zero.
  const currentId = currentTrack?.id;
  useEffect(() => {
    const audio = audioRef.current;
    const track = currentTrackRef.current;
    retryCountRef.current = 0;
    if (!track) return;

    const src = isLocalFileTrack(track) ? track.audioUrl : buildStreamSrc(track);
    if (!src) return;
    audio.src = src;
    if (isPlayingRef.current) safePlay();
  }, [currentId, safePlay]);

  // Play / Pause
  useEffect(() => {
    if (isPlaying) safePlay();
    else audioRef.current.pause();
  }, [isPlaying, safePlay]);

  // Volume
  useEffect(() => {
    audioRef.current.volume = volume;
    audioRef.current.muted = isMuted;
  }, [volume, isMuted]);

  // Resolve o YouTube ID da faixa (usado no modo clipe e para acelerar os próximos plays)
  useEffect(() => {
    const track = currentTrackRef.current;
    if (!track || track.youtubeId || isLocalFileTrack(track) || resolvingIdsRef.current.has(track.id)) return;

    resolvingIdsRef.current.add(track.id);
    resolveYouTubeId(track.title, track.artist)
      .then((id) => {
        if (id) {
          setTracks((prev) => prev.map((t) => (t.id === track.id && !t.youtubeId ? { ...t, youtubeId: id } : t)));
        }
      })
      .finally(() => resolvingIdsRef.current.delete(track.id));
  }, [currentId]);

  // ==========================================
  // MEDIA SESSION (teclas de mídia, tela de bloqueio do celular)
  // ==========================================
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist || '',
        album: currentTrack.album || 'GL Music',
        artwork: currentTrack.cover ? [{ src: currentTrack.cover, sizes: '512x512' }] : []
      });
    } catch {
      // MediaMetadata não suportado
    }
  }, [currentTrack]);

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return undefined;
    const setHandler = (action, handler) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // ação não suportada neste navegador
      }
    };
    setHandler('play', () => { if (!isPlayingRef.current) togglePlay(); });
    setHandler('pause', () => { if (isPlayingRef.current) togglePlay(); });
    setHandler('previoustrack', () => playPrev());
    setHandler('nexttrack', () => playNext());
    setHandler('seekto', (details) => {
      if (details.seekTime !== undefined) seekTo(details.seekTime);
    });
    return () => {
      for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto']) setHandler(action, null);
    };
  }, [togglePlay, playPrev, playNext, seekTo]);

  // ==========================================
  // CONEXÃO COM A SALA DO JAM (OUVIR JUNTOS)
  // ==========================================
  const applyRemoteState = useCallback((state) => {
    if (!state?.track) return;
    const remoteTime = Number(state.currentTime) || 0;
    if (state.track.id !== currentTrackRef.current?.id) {
      playTrack(state.track, { fromRemote: true, startAt: remoteTime });
    } else if (Math.abs(audioRef.current.currentTime - remoteTime) > JAM_DRIFT_TOLERANCE) {
      seekTo(remoteTime, { broadcast: false });
    }
    setPlaying(!!state.isPlaying);
  }, [playTrack, seekTo, setPlaying]);

  const handleJoinJamRoom = useCallback((roomId, username) => {
    jamSocket.connect(roomId, username, {
      getInitialState: () => ({
        track: shareableTrack(currentTrackRef.current),
        isPlaying: isPlayingRef.current,
        currentTime: audioRef.current.currentTime
      }),
      onConnected: (joinedRoomId, isReconnect) => {
        jamRoomRef.current = joinedRoomId;
        setActiveJamRoomId(joinedRoomId);
        showToast(isReconnect ? '🔄 Reconectado à sala!' : `Conectado à sala ${joinedRoomId}! 🎧`);

        // Remove o ?room= da barra de endereço para não reabrir o convite ao recarregar
        const url = new URL(window.location.href);
        if (url.searchParams.has('room')) {
          url.searchParams.delete('room');
          window.history.replaceState(null, '', url);
        }
      },
      onRoomSync: (state, userCount, users) => {
        setJamUsers(users);
        // Sala recém-criada (só eu): mantém o que já está tocando
        if (userCount > 1) applyRemoteState(state);
      },
      onUserJoined: (joinedUser, userCount, users) => {
        setJamUsers(users);
        showToast(`👋 ${joinedUser} entrou na sala!`);
        triggerFloatingReaction('🎉', joinedUser);
      },
      onUserLeft: (leftUser, userCount, users) => {
        setJamUsers(users);
        showToast(`🚪 ${leftUser} saiu da sala.`);
      },
      onSyncAction: (action, payload, from, isSelf) => {
        const remoteTime = Number(payload.currentTime);
        const hasTime = Number.isFinite(remoteTime);
        const drift = hasTime ? Math.abs(audioRef.current.currentTime - remoteTime) : 0;

        if (action === 'PLAY') {
          if (drift > JAM_DRIFT_TOLERANCE) seekTo(remoteTime, { broadcast: false });
          setPlaying(true);
          showToast(`▶️ ${from} deu play`);
        } else if (action === 'PAUSE') {
          setPlaying(false);
          if (drift > JAM_DRIFT_TOLERANCE) seekTo(remoteTime, { broadcast: false });
          showToast(`⏸️ ${from} pausou`);
        } else if (action === 'SEEK') {
          if (hasTime) {
            seekTo(remoteTime, { broadcast: false });
            showToast(`⏩ ${from} avançou o áudio`);
          }
        } else if (action === 'CHANGE_TRACK' && payload.track) {
          // O servidor devolve a troca também para quem trocou; se já está tocando, ignora
          if (payload.track.id !== currentTrackRef.current?.id) {
            playTrack(payload.track, { fromRemote: true });
            if (!isSelf) showToast(`🎵 ${from} trocou para: ${payload.track.title}`);
          }
        }
      },
      onReaction: (reaction, from) => triggerFloatingReaction(reaction, from),
      onReconnecting: () => showToast('📡 Conexão com a sala perdida. Reconectando…', 5000),
      onError: (message) => showToast(`⚠️ ${message || 'Erro na sala Jam.'}`),
      onDisconnected: (reason) => {
        jamRoomRef.current = null;
        setActiveJamRoomId(null);
        setJamUsers([]);
        showToast(
          reason === 'failed'
            ? '⚠️ Não foi possível conectar à sala. O servidor do player está rodando?'
            : '⚠️ Conexão com a sala encerrada.',
          5000
        );
      }
    });
  }, [applyRemoteState, playTrack, seekTo, setPlaying, showToast, triggerFloatingReaction]);

  const handleLeaveJamRoom = useCallback(() => {
    jamSocket.disconnect();
    jamRoomRef.current = null;
    setActiveJamRoomId(null);
    setJamUsers([]);
    showToast('Você saiu da sala sincronizada.');
  }, [showToast]);

  const handleSendJamReaction = useCallback((reaction) => {
    jamSocket.sendReaction(reaction);
    triggerFloatingReaction(reaction, 'Você');
  }, [triggerFloatingReaction]);

  useEffect(() => () => jamSocket.disconnect(), []);

  // ==========================================
  // HANDLERS DA INTERFACE
  // ==========================================

  /** Clique numa faixa de uma lista: se já é a atual, alterna play/pause. */
  const handleSelectTrack = useCallback((track, queue) => {
    if (!track) return;
    if (track.id === currentTrackRef.current?.id) {
      if (queue) queueRef.current = queue;
      togglePlay();
      return;
    }
    errorCountRef.current = 0;
    playTrack(track, { queue });
  }, [playTrack, togglePlay]);

  const handlePlayAll = (trackListToPlay) => {
    if (!trackListToPlay || trackListToPlay.length === 0) return;
    const first = isShuffle
      ? trackListToPlay[Math.floor(Math.random() * trackListToPlay.length)]
      : trackListToPlay[0];
    errorCountRef.current = 0;
    playTrack(first, { queue: trackListToPlay });
  };

  const handleToggleFavorite = (track) => {
    if (!track) return;
    setFavorites((prev) =>
      prev.some((t) => t.id === track.id) ? prev.filter((t) => t.id !== track.id) : [...prev, track]
    );
  };

  const handleToggleRepeat = () => {
    setRepeatMode((prev) => (prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'));
  };

  const handleToggleVideo = () => {
    if (!showVideo) {
      if (isLocalTrack) {
        showToast('ℹ️ Arquivos do computador não têm clipe.');
        return;
      }
      if (!currentTrack?.youtubeId) {
        showToast('🔎 Procurando o clipe desta música…');
      }
    }
    setShowVideo((prev) => !prev);
  };

  const handleOpenLyrics = (track) => {
    if (track && track.id !== currentTrack?.id) {
      playTrack(track);
    }
    setIsLyricsOpen(true);
  };

  const handleUpdateTrackLyrics = useCallback((trackId, newLrcText) => {
    const text = typeof newLrcText === 'string' ? newLrcText : '';
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, hasLyrics: !!text.trim(), lyricsLrc: text } : t))
    );
  }, []);

  const handleUpdateTrackMeta = useCallback((trackId, metaPatch) => {
    if (!trackId || !metaPatch || typeof metaPatch !== 'object') return;
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== trackId) return t;
        const nextDuration = Number(metaPatch.duration);
        const shouldPatchDuration =
          Number.isFinite(nextDuration) && nextDuration > 0 && (!t.duration || t.duration === 210);
        if (!shouldPatchDuration) return t;
        return { ...t, duration: Math.round(nextDuration) };
      })
    );
  }, []);

  // Gerenciamento de Playlists
  const handleSelectPlaylist = (playlistId) => {
    setActivePlaylistId(playlistId);
    setCurrentTab('playlist');
  };

  const openPlaylistModal = (tab, playlist = null) => {
    setPlaylistToEdit(playlist);
    setPlaylistModalTab(tab);
    setIsPlaylistModalOpen(true);
  };

  const handleSavePlaylist = (playlistData) => {
    setPlaylists((prev) =>
      prev.some((p) => p.id === playlistData.id)
        ? prev.map((p) => (p.id === playlistData.id ? { ...p, ...playlistData } : p))
        : [...prev, playlistData]
    );
    setActivePlaylistId(playlistData.id);
    setCurrentTab('playlist');
  };

  /** Adiciona faixas novas à biblioteca e cria/atualiza a playlist importada. */
  const importPlaylist = (data, fallbackPrefix) => {
    const newTracks = (data.tracks || []).filter((t) => t && t.id);
    setTracks((prev) => {
      const existingIds = new Set(prev.map((t) => t.id));
      return [...newTracks.filter((t) => !existingIds.has(t.id)), ...prev];
    });

    const newPlaylist = {
      id: data.id || `${fallbackPrefix}${Date.now()}`,
      name: data.name,
      description: data.description,
      cover: data.cover,
      trackIds: Array.from(new Set(newTracks.map((t) => t.id)))
    };

    setPlaylists((prev) => [newPlaylist, ...prev.filter((p) => p.id !== newPlaylist.id)]);
    setActivePlaylistId(newPlaylist.id);
    setCurrentTab('playlist');

    if (newTracks.length > 0) {
      errorCountRef.current = 0;
      playTrack(newTracks[0], { queue: newTracks });
    }
  };

  const handleImportSpotify = (spotifyData) => importPlaylist(spotifyData, 'pl-sp-');

  const handleImportYouTube = (youtubeData) => {
    if (youtubeData.type === 'playlist') {
      importPlaylist(youtubeData.playlist, 'pl-yt-');
    } else if (youtubeData.type === 'track') {
      const track = youtubeData.track;
      setTracks((prev) =>
        prev.some((t) => t.id === track.id)
          ? prev.map((t) =>
              // Atualiza os dados do vídeo, mas mantém a letra que o usuário já tinha
              t.id === track.id ? { ...t, ...track, lyricsLrc: t.lyricsLrc, hasLyrics: t.hasLyrics } : t
            )
          : [track, ...prev]
      );

      // Adiciona à playlist aberta (sem remover se ela já tiver a música)
      if (activePlaylist && activePlaylist.id !== 'pl-all') {
        setPlaylists((prev) =>
          prev.map((p) =>
            p.id === activePlaylist.id && !(p.trackIds || []).includes(track.id)
              ? { ...p, trackIds: [...(p.trackIds || []), track.id] }
              : p
          )
        );
      }

      errorCountRef.current = 0;
      playTrack(track);
    }
  };

  const handleDeletePlaylist = (playlistId, playlistName) => {
    const name = playlistName || 'esta playlist';
    if (!window.confirm(`Tem certeza que deseja apagar a playlist "${name}"?`)) return;
    setPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
    if (activePlaylist?.id === playlistId) {
      setActivePlaylistId(null); // volta para a primeira playlist restante
    }
  };

  // Adicionar faixa a uma playlist
  const handleOpenAddToPlaylist = (track) => {
    setTrackToAddToPlaylist(track);
    setIsAddToPlaylistOpen(true);
  };

  const handleToggleTrackInPlaylist = (playlistId, track) => {
    setTracks((prev) => (prev.some((t) => t.id === track.id) ? prev : [track, ...prev]));
    setPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== playlistId) return p;
        const currentIds = p.trackIds || [];
        return {
          ...p,
          trackIds: currentIds.includes(track.id)
            ? currentIds.filter((id) => id !== track.id)
            : [...currentIds, track.id]
        };
      })
    );
  };

  const handleRemoveTrackFromPlaylist = (playlistId, trackId) => {
    setPlaylists((prev) =>
      prev.map((p) =>
        p.id === playlistId ? { ...p, trackIds: (p.trackIds || []).filter((id) => id !== trackId) } : p
      )
    );
  };

  // Upload local (um ou vários arquivos)
  const handleLocalAudioUpload = (fileList) => {
    const files = Array.from(fileList || []).filter(
      (file) => file.type.startsWith('audio/') || AUDIO_FILE_RE.test(file.name)
    );
    if (files.length === 0) {
      showToast('⚠️ Selecione um arquivo de áudio (MP3, M4A, WAV, OGG, FLAC…).');
      return;
    }

    const stamp = Date.now();
    const newTracks = files.map((file, index) => ({
      id: `local-${stamp}-${index}`,
      title: file.name.replace(/\.[^/.]+$/, ''),
      artist: 'Arquivo Local (Computador)',
      album: 'Meu Computador',
      cover: DEFAULT_COVER,
      audioUrl: URL.createObjectURL(file),
      duration: 0,
      hasLyrics: false,
      lyricsLrc: ''
    }));

    setTracks((prev) => [...newTracks, ...prev]);
    errorCountRef.current = 0;
    playTrack(newTracks[0], { queue: newTracks });
  };

  const handleLrcUpload = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      const track = currentTrackRef.current;
      if (typeof text === 'string' && track) {
        handleUpdateTrackLyrics(track.id, text);
        setIsLyricsOpen(true);
      }
    };
    reader.readAsText(file);
  };

  const handleToggleFullscreen = () => {
    const root = document.documentElement;
    if (!document.fullscreenElement) {
      if (typeof root.requestFullscreen === 'function') root.requestFullscreen().catch(console.error);
      else showToast('ℹ️ Tela cheia não é suportada neste navegador.');
    } else {
      document.exitFullscreen?.().catch(console.error);
    }
  };

  const getAudioTime = useCallback(() => audioRef.current.currentTime, []);

  const handleYouTubeError = useCallback((errorCode) => {
    console.warn(`[YouTubePlayer Error ${errorCode}] para faixa:`, currentTrackRef.current?.title);
    showToast('ℹ️ O clipe não pode ser exibido para esta música. O áudio continua tocando normalmente!', 4000);
    setShowVideo(false);
  }, [showToast]);

  // ==========================================
  // ATALHOS DE TECLADO
  // ==========================================
  const keyboardStateRef = useRef({});
  useLayoutEffect(() => {
    keyboardStateRef.current = {
      isLyricsOpen,
      isJamModalOpen,
      isPlaylistModalOpen,
      isAddToPlaylistOpen,
      duration
    };
  });

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const ui = keyboardStateRef.current;

      if (e.key === 'Escape') {
        if (ui.isJamModalOpen) setIsJamModalOpen(false);
        else if (ui.isAddToPlaylistOpen) setIsAddToPlaylistOpen(false);
        else if (ui.isPlaylistModalOpen) setIsPlaylistModalOpen(false);
        else if (ui.isLyricsOpen) setIsLyricsOpen(false);
        return;
      }

      // Digitando, ou navegando por um modal com o teclado: não intercepta
      if (isTypingTarget(e.target) || e.target?.closest?.('.modal-backdrop')) return;

      switch (e.key) {
        case ' ':
        case 'Spacebar':
          e.preventDefault();
          // Evita que o botão focado também receba o "clique" do espaço
          if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
            document.activeElement.blur();
          }
          togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) playNext();
          else seekTo(Math.min(audioRef.current.currentTime + 5, ui.duration || Infinity));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) playPrev();
          else seekTo(Math.max(audioRef.current.currentTime - 5, 0));
          break;
        case 'm':
        case 'M':
          setIsMuted((prev) => !prev);
          break;
        case 'l':
        case 'L':
          setIsLyricsOpen((prev) => !prev);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, playNext, playPrev, seekTo]);

  // ==========================================
  // RENDER
  // ==========================================
  const isFavoriteTrack = (track) => !!track && favoriteIds.has(track.id);

  return (
    <div className="app-layout">
      {/* Dynamic Background Tint based on current cover */}
      <div
        className="app-ambient-backdrop"
        style={{ backgroundImage: currentTrack?.cover ? `url("${currentTrack.cover}")` : 'none' }}
      />

      {/* Floating Reactions & Toast Overlays */}
      <FloatingReactions reactions={floatingReactions} toast={toast} />

      {/* Clipe do YouTube: só imagem (mudo), sincronizado com o áudio principal */}
      {!isLocalTrack && showVideo && currentTrack?.youtubeId && (
        <YouTubePlayer
          videoId={currentTrack.youtubeId}
          isPlaying={isPlaying}
          getMasterTime={getAudioTime}
          showVideo={showVideo}
          onError={handleYouTubeError}
        />
      )}

      <div className="app-container">
        {/* Top Right Floating Jam Widget (Lado da direita, mais pra cima) */}
        {!isLyricsOpen && (
          <div className="top-right-jam-bar">
            <button
              className={`top-jam-pill ${activeJamRoomId ? 'active-live' : ''}`}
              onClick={() => setIsJamModalOpen(true)}
              title={activeJamRoomId ? `Sala ${activeJamRoomId} (${jamUsers.length || 1} ouvindo juntos)` : 'Ouvir junto com outra pessoa sincronizado'}
            >
              <Users size={16} />
              <span className="top-jam-label">
                {activeJamRoomId ? `Jam (${jamUsers.length || 1})` : 'Ouvir Juntos'}
              </span>
              {activeJamRoomId && <span className="jam-live-dot" />}
            </button>
          </div>
        )}

        {/* Left Sidebar */}
        <Sidebar
          currentTab={currentTab}
          setCurrentTab={setCurrentTab}
          activePlaylistId={activePlaylist?.id}
          playlists={playlists}
          favoritesCount={favorites.length}
          isPlaying={isPlaying}
          activeJamRoomId={activeJamRoomId}
          jamUserCount={jamUsers.length}
          onSelectPlaylist={handleSelectPlaylist}
          onOpenCreatePlaylist={() => openPlaylistModal('manual')}
          onOpenSpotifyImport={() => openPlaylistModal('spotify')}
          onOpenYouTubeImport={() => openPlaylistModal('youtube')}
          onOpenJam={() => setIsJamModalOpen(true)}
          onDeletePlaylist={handleDeletePlaylist}
          onLocalAudioUpload={handleLocalAudioUpload}
          onLrcUpload={handleLrcUpload}
        />

        {/* Center Main View */}
        <main className={`main-viewport ${currentTab === 'lyrics' ? 'lyrics-viewport' : ''}`}>
          {currentTab === 'home' && (
            <HomeView
              tracks={tracks}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              favoriteIds={favoriteIds}
              onPlayTrack={handleSelectTrack}
              onOpenLyrics={handleOpenLyrics}
              onToggleFavorite={handleToggleFavorite}
              onNavigateTab={setCurrentTab}
              onAddToPlaylist={handleOpenAddToPlaylist}
            />
          )}

          {currentTab === 'playlist' && (
            <TrackList
              title={activePlaylist ? activePlaylist.name : 'Nenhuma Playlist Selecionada'}
              subtitle={activePlaylist ? activePlaylist.description : 'Crie ou importe uma playlist do Spotify'}
              playlist={activePlaylist}
              tracks={activePlaylistTracks}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              favoriteIds={favoriteIds}
              onPlayTrack={handleSelectTrack}
              onPlayAll={handlePlayAll}
              onToggleFavorite={handleToggleFavorite}
              onOpenLyrics={handleOpenLyrics}
              onAddToPlaylist={handleOpenAddToPlaylist}
              onRemoveFromPlaylist={handleRemoveTrackFromPlaylist}
              onEditPlaylist={(playlist) => openPlaylistModal('manual', playlist)}
              onDeletePlaylist={handleDeletePlaylist}
            />
          )}

          {currentTab === 'lyrics' && (
            <div className="lyrics-tab-container">
              <LyricsView
                currentTrack={currentTrack}
                currentTime={currentTime}
                audioDuration={duration}
                onSeek={seekTo}
                onClose={() => setCurrentTab('home')}
                onUpdateTrackLyrics={handleUpdateTrackLyrics}
                onUpdateTrackMeta={handleUpdateTrackMeta}
              />
            </div>
          )}

          {currentTab === 'search' && (
            <OnlineSearch
              currentTrack={currentTrack}
              favoriteIds={favoriteIds}
              onPlayTrack={handleSelectTrack}
              onToggleFavorite={handleToggleFavorite}
              onOpenAddToPlaylistModal={handleOpenAddToPlaylist}
            />
          )}

          {currentTab === 'favorites' && (
            <TrackList
              title="Minhas Músicas Favoritas"
              subtitle={`${favorites.length} músicas curtidas completas salvas no seu navegador`}
              tracks={favoriteTracks}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              favoriteIds={favoriteIds}
              onPlayTrack={handleSelectTrack}
              onPlayAll={handlePlayAll}
              onToggleFavorite={handleToggleFavorite}
              onOpenLyrics={handleOpenLyrics}
              onAddToPlaylist={handleOpenAddToPlaylist}
            />
          )}
        </main>
      </div>

      {/* Persistent Bottom Audio Player Bar */}
      <PlayerBar
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration || currentTrack?.duration || 0}
        volume={volume}
        isMuted={isMuted}
        isShuffle={isShuffle}
        repeatMode={repeatMode}
        isFavorite={isFavoriteTrack(currentTrack)}
        isLyricsOpen={isLyricsOpen}
        showVideo={showVideo}
        onTogglePlay={togglePlay}
        onSeek={seekTo}
        onPrev={playPrev}
        onNext={() => playNext()}
        onToggleShuffle={() => setIsShuffle((prev) => !prev)}
        onToggleRepeat={handleToggleRepeat}
        onToggleFavorite={handleToggleFavorite}
        onToggleLyrics={() => setIsLyricsOpen((prev) => !prev)}
        onToggleVideo={handleToggleVideo}
        onChangeVolume={(v) => {
          setVolume(v);
          setIsMuted(false);
        }}
        onToggleMute={() => setIsMuted((prev) => !prev)}
        onToggleFullscreen={handleToggleFullscreen}
      />

      {/* Fullscreen Lyrics Overlay */}
      {isLyricsOpen && currentTab !== 'lyrics' && (
        <LyricsView
          currentTrack={currentTrack}
          currentTime={currentTime}
          audioDuration={duration}
          onSeek={seekTo}
          onClose={() => setIsLyricsOpen(false)}
          onUpdateTrackLyrics={handleUpdateTrackLyrics}
          onUpdateTrackMeta={handleUpdateTrackMeta}
        />
      )}

      {/* Modal Criar/Editar/Importar Playlist */}
      <PlaylistModal
        isOpen={isPlaylistModalOpen}
        playlistToEdit={playlistToEdit}
        initialTab={playlistModalTab}
        onClose={() => setIsPlaylistModalOpen(false)}
        onSave={handleSavePlaylist}
        onImportSpotify={handleImportSpotify}
        onImportYouTube={handleImportYouTube}
      />

      {/* Modal Adicionar Música à Playlist */}
      <AddToPlaylistModal
        isOpen={isAddToPlaylistOpen}
        track={trackToAddToPlaylist}
        playlists={playlists}
        onClose={() => setIsAddToPlaylistOpen(false)}
        onToggleTrackInPlaylist={handleToggleTrackInPlaylist}
        onOpenCreatePlaylist={() => openPlaylistModal('manual')}
      />

      {/* Modal Ouvir Juntos (Jam Sincronizado) */}
      <JamModal
        isOpen={isJamModalOpen}
        activeRoomId={activeJamRoomId}
        jamUsers={jamUsers}
        onClose={() => setIsJamModalOpen(false)}
        onJoinRoom={handleJoinJamRoom}
        onLeaveRoom={handleLeaveJamRoom}
        onSendReaction={handleSendJamReaction}
      />
    </div>
  );
}
