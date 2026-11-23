import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { resolveYouTubeId } from './utils/itunesApi';
import { jamSocket } from './utils/jamSocket';
import './App.css';

export default function App() {
  // Estado mestre de todas as faixas
  const [tracks, setTracks] = useState(() => {
    const saved = localStorage.getItem('glmusic_custom_tracks') || localStorage.getItem('jblgplayer_custom_tracks') || localStorage.getItem('soundwave_custom_tracks');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return [...initialTracks, ...parsed.filter((p) => p && !initialTracks.some((it) => it.id === p.id))];
        }
      } catch (e) {
        return initialTracks;
      }
    }
    return initialTracks;
  });

  // Estado das Playlists
  const [playlists, setPlaylists] = useState(() => {
    const saved = localStorage.getItem('glmusic_playlists') || localStorage.getItem('jblgplayer_playlists') || localStorage.getItem('soundwave_playlists');
    if (saved !== null) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (e) {
        return defaultPlaylists;
      }
    }
    return defaultPlaylists;
  });

  const [activePlaylistId, setActivePlaylistId] = useState(() => {
    const saved = localStorage.getItem('glmusic_playlists') || localStorage.getItem('jblgplayer_playlists') || localStorage.getItem('soundwave_playlists');
    if (saved !== null) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed[0]?.id || 'pl-all';
        }
      } catch (e) {}
    }
    return 'pl-all';
  });

  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(240);
  const [seekTime, setSeekTime] = useState(null);
  const [volume, setVolume] = useState(() => {
    const savedVol = localStorage.getItem('glmusic_volume') || localStorage.getItem('jblgplayer_volume') || localStorage.getItem('soundwave_volume');
    return savedVol !== null ? parseFloat(savedVol) : 0.8;
  });
  const [isMuted, setIsMuted] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState('off');
  const [currentTab, setCurrentTab] = useState('home');
  const [isLyricsOpen, setIsLyricsOpen] = useState(false);
  const [showVideo, setShowVideo] = useState(false);

  // Modais de Playlist
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [playlistModalTab, setPlaylistModalTab] = useState('manual');
  const [playlistToEdit, setPlaylistToEdit] = useState(null);
  const [isAddToPlaylistOpen, setIsAddToPlaylistOpen] = useState(false);
  const [trackToAddToPlaylist, setTrackToAddToPlaylist] = useState(null);

  // ==========================================
  // ESTADO DE "OUVIR JUNTOS" (JAM SINCRONIZADO)
  // ==========================================
  const [isJamModalOpen, setIsJamModalOpen] = useState(false);
  const [activeJamRoomId, setActiveJamRoomId] = useState(null);
  const [jamUsers, setJamUsers] = useState([]);
  const [floatingReactions, setFloatingReactions] = useState([]);
  const [jamToast, setJamToast] = useState(null);
  const isRemoteActionRef = useRef(false);
  const consecutiveErrorsRef = useRef(0);

  // Favoritas salvas no LocalStorage
  const [favorites, setFavorites] = useState(() => {
    const saved = localStorage.getItem('glmusic_favorites') || localStorage.getItem('jblgplayer_favorites') || localStorage.getItem('soundwave_favorites');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) { return []; }
    }
    return [];
  });

  const localAudioRef = useRef(new Audio());

  const currentTrack = tracks[currentTrackIndex] || tracks[0];
  const isLocalTrack = currentTrack?.audioUrl?.startsWith('blob:');

  // Playlist ativa
  const activePlaylist = playlists.find((p) => p.id === activePlaylistId) || playlists[0] || null;
  
  // Faixas da playlist ativa
  const activePlaylistTracks = React.useMemo(() => {
    if (!activePlaylist || !activePlaylist.trackIds) return [];
    return activePlaylist.trackIds
      .map((id) => tracks.find((t) => t.id === id))
      .filter(Boolean);
  }, [activePlaylist, tracks]);

  // Refs para evitar problemas de stale closure no auto-advance
  const currentTrackRef = useRef(currentTrack);
  const activePlaylistTracksRef = useRef(activePlaylistTracks);
  const currentTabRef = useRef(currentTab);
  const tracksRef = useRef(tracks);
  const isShuffleRef = useRef(isShuffle);
  const repeatModeRef = useRef(repeatMode);
  const activeJamRoomIdRef = useRef(activeJamRoomId);

  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { activePlaylistTracksRef.current = activePlaylistTracks; }, [activePlaylistTracks]);
  useEffect(() => { currentTabRef.current = currentTab; }, [currentTab]);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { isShuffleRef.current = isShuffle; }, [isShuffle]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);
  useEffect(() => { activeJamRoomIdRef.current = activeJamRoomId; }, [activeJamRoomId]);

  // Salva playlists no LocalStorage
  useEffect(() => {
    localStorage.setItem('soundwave_playlists', JSON.stringify(playlists));
    localStorage.setItem('jblgplayer_playlists', JSON.stringify(playlists));
    localStorage.setItem('glmusic_playlists', JSON.stringify(playlists));
  }, [playlists]);

  // Salva faixas personalizadas / importadas
  useEffect(() => {
    const customTracks = tracks.filter((t) => !initialTracks.some((it) => it.id === t.id));
    localStorage.setItem('soundwave_custom_tracks', JSON.stringify(customTracks));
    localStorage.setItem('jblgplayer_custom_tracks', JSON.stringify(customTracks));
    localStorage.setItem('glmusic_custom_tracks', JSON.stringify(customTracks));
  }, [tracks]);

  // Notificação toast temporária para Jam
  const showJamToast = useCallback((msg) => {
    setJamToast(msg);
    setTimeout(() => setJamToast(null), 3000);
  }, []);

  // Adiciona reação flutuante na tela
  const triggerFloatingReaction = useCallback((emoji, from) => {
    const id = Date.now() + Math.random();
    const x = Math.floor(Math.random() * 50) + 25; // Entre 25% e 75% da largura
    setFloatingReactions((prev) => [...prev, { id, emoji, from, x }]);
    setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
    }, 2500);
  }, []);

  // ==========================================
  // CONEXÃO COM A SALA DO JAM (OUVIR JUNTOS)
  // ==========================================
  const handleJoinJamRoom = useCallback((roomId, username) => {
    const initialState = {
      track: currentTrackRef.current,
      isPlaying: false,
      currentTime: 0
    };

    jamSocket.connect(roomId, username, initialState, {
      onConnected: () => {
        setActiveJamRoomId(roomId);
        showJamToast(`Conectado à sala ${roomId}! 🎧`);
      },
      onRoomSync: (state, userCount, users) => {
        setJamUsers(users);
        if (state && state.track) {
          isRemoteActionRef.current = true;
          handlePlayTrack(state.track);
          if (state.currentTime) {
            handleSeek(state.currentTime);
          }
          setIsPlaying(!!state.isPlaying);
          setTimeout(() => { isRemoteActionRef.current = false; }, 300);
        }
      },
      onUserJoined: (joinedUser, userCount, users) => {
        setJamUsers(users);
        showJamToast(`👋 ${joinedUser} entrou na sala!`);
        triggerFloatingReaction('🎉', joinedUser);
      },
      onUserLeft: (leftUser, userCount, users) => {
        setJamUsers(users);
        showJamToast(`🚪 ${leftUser} saiu da sala.`);
      },
      onSyncAction: (action, payload, from) => {
        isRemoteActionRef.current = true;
        if (action === 'PLAY') {
          setIsPlaying(true);
          if (payload.currentTime !== undefined && Math.abs(currentTime - payload.currentTime) > 1.5) {
            handleSeek(payload.currentTime);
          }
          showJamToast(`▶️ ${from} deu play`);
        } else if (action === 'PAUSE') {
          setIsPlaying(false);
          showJamToast(`⏸️ ${from} pausou`);
        } else if (action === 'SEEK') {
          if (payload.currentTime !== undefined) {
            handleSeek(payload.currentTime);
            showJamToast(`⏩ ${from} avançou o áudio`);
          }
        } else if (action === 'CHANGE_TRACK') {
          if (payload.track) {
            handlePlayTrack(payload.track);
            showJamToast(`🎵 ${from} trocou para: ${payload.track.title}`);
          }
        }
        setTimeout(() => { isRemoteActionRef.current = false; }, 300);
      },
      onReaction: (reaction, from) => {
        triggerFloatingReaction(reaction, from);
      },
      onDisconnected: () => {
        setActiveJamRoomId(null);
        setJamUsers([]);
      }
    });
  }, [showJamToast, triggerFloatingReaction, currentTime]);

  const handleLeaveJamRoom = useCallback(() => {
    jamSocket.disconnect();
    setActiveJamRoomId(null);
    setJamUsers([]);
    showJamToast('Você saiu da sala sincronizada.');
  }, [showJamToast]);

  const handleSendJamReaction = useCallback((reaction) => {
    jamSocket.sendReaction(reaction);
    triggerFloatingReaction(reaction, 'Você');
  }, [triggerFloatingReaction]);

  // Checagem de link de convite na URL (Ex: ?room=XYZ)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setIsJamModalOpen(true);
    }
  }, []);

  // Atualiza ou resolve YouTube VideoId para tocar a música completa
  useEffect(() => {
    if (!currentTrack || isLocalTrack) return;

    if (!currentTrack.youtubeId) {
      resolveYouTubeId(currentTrack.title, currentTrack.artist).then((id) => {
        if (id) {
          setTracks((prev) =>
            prev.map((t) => (t.id === currentTrack.id ? { ...t, youtubeId: id } : t))
          );
        }
      });
    }

    setCurrentTime(0);

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: currentTrack.album || 'GL Music Originals • Hi-Fi Lossless',
        artwork: [{ src: currentTrack.cover, sizes: '512x512', type: 'image/jpeg' }]
      });

      navigator.mediaSession.setActionHandler('play', () => handleTogglePlay());
      navigator.mediaSession.setActionHandler('pause', () => handleTogglePlay());
      navigator.mediaSession.setActionHandler('previoustrack', () => handlePrev());
      navigator.mediaSession.setActionHandler('nexttrack', () => handleNext());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) handleSeek(details.seekTime);
      });
    }
  }, [currentTrack?.id]);

  // Reprodução Universal de Áudio (HTML5 Audio com /api/stream):
  // Funciona com 100% de estabilidade no localhost, rede local (192.168.x.x),
  // celulares com tela bloqueada, segundo plano e sem qualquer bloqueio de incorporação!
  useEffect(() => {
    const audio = localAudioRef.current;
    if (!audio || !currentTrack) return;

    let targetSrc = '';
    if (isLocalTrack) {
      targetSrc = currentTrack.audioUrl;
    } else if (currentTrack.youtubeId) {
      targetSrc = `/api/stream?id=${currentTrack.youtubeId}`;
    } else if (currentTrack.title) {
      targetSrc = `/api/stream?q=${encodeURIComponent(currentTrack.title + ' ' + (currentTrack.artist || ''))}`;
    }

    if (targetSrc) {
      const fullTarget = targetSrc.startsWith('http') ? targetSrc : window.location.origin + targetSrc;
      if (audio.src !== fullTarget) {
        audio.src = targetSrc;
      }
    }

    if (isPlaying) {
      audio.play().catch((e) => console.warn('audio.play bloqueado ou aguardando buffer:', e));
    } else {
      audio.pause();
    }

    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => {
      if (audio.duration && !isNaN(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };
    const onEnd = () => handleNext();

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);

    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
    };
  }, [currentTrack?.id, currentTrack?.youtubeId, isLocalTrack, isPlaying]);

  // Volume
  useEffect(() => {
    localAudioRef.current.volume = isMuted ? 0 : volume;
    localStorage.setItem('soundwave_volume', volume.toString());
    localStorage.setItem('jblgplayer_volume', volume.toString());
  }, [volume, isMuted]);

  // Favoritos
  useEffect(() => {
    localStorage.setItem('soundwave_favorites', JSON.stringify(favorites));
    localStorage.setItem('jblgplayer_favorites', JSON.stringify(favorites));
  }, [favorites]);

  // Handlers de reprodução
  const handleTogglePlay = () => {
    const nextState = !isPlaying;
    setIsPlaying(nextState);
    if (nextState) {
      localAudioRef.current?.play().catch((e) => console.warn('play bloqueado:', e));
    } else {
      localAudioRef.current?.pause();
    }

    // Sincroniza com a sala Jam se estiver em uma sessão
    if (activeJamRoomIdRef.current && !isRemoteActionRef.current) {
      jamSocket.sendSyncAction(nextState ? 'PLAY' : 'PAUSE', { currentTime });
    }
  };

  const handleSeek = (newTime) => {
    setCurrentTime(newTime);
    setSeekTime(newTime);
    if (localAudioRef.current) {
      localAudioRef.current.currentTime = newTime;
    }

    // Sincroniza seek com a sala Jam
    if (activeJamRoomIdRef.current && !isRemoteActionRef.current) {
      jamSocket.sendSyncAction('SEEK', { currentTime: newTime });
    }

    setTimeout(() => setSeekTime(null), 100);
  };

  const handlePlayTrack = useCallback((track) => {
    consecutiveErrorsRef.current = 0;
    setCurrentTime(0);

    const readyTrack = { ...track };
    const allTracks = tracksRef.current;
    const index = allTracks.findIndex((t) => t.id === readyTrack.id);

    if (index !== -1) {
      setCurrentTrackIndex(index);
    } else {
      setTracks((prev) => [readyTrack, ...prev]);
      setCurrentTrackIndex(0);
    }
    setIsPlaying(true);

    // Se for faixa online e ainda não tiver youtubeId, busca em background para cache
    if (!readyTrack.youtubeId && !readyTrack.audioUrl?.startsWith('blob:')) {
      resolveYouTubeId(readyTrack.title, readyTrack.artist).then((resolvedId) => {
        if (resolvedId) {
          setTracks((prev) =>
            prev.map((t) => (t.id === readyTrack.id ? { ...t, youtubeId: resolvedId } : t))
          );
        }
      });
    }

    // Sincroniza troca de música com o Jam
    if (activeJamRoomIdRef.current && !isRemoteActionRef.current) {
      jamSocket.sendSyncAction('CHANGE_TRACK', { track: readyTrack });
    }
  }, []);

  const handleNext = useCallback(() => {
    const allTracks = tracksRef.current;
    const plTracks = activePlaylistTracksRef.current;
    const tab = currentTabRef.current;
    const current = currentTrackRef.current;
    const shuffle = isShuffleRef.current;
    const repeat = repeatModeRef.current;

    if (repeat === 'one') {
      setCurrentTime(0);
      setSeekTime(0);
      setIsPlaying(true);
      return;
    }

    const queue = (tab === 'playlist' && plTracks && plTracks.length > 0)
      ? plTracks
      : allTracks;

    if (!queue || queue.length === 0) return;

    let nextTrack = null;
    if (shuffle) {
      const candidates = queue.filter((t) => t.id !== current?.id);
      const pool = candidates.length > 0 ? candidates : queue;
      const randomIndex = Math.floor(Math.random() * pool.length);
      nextTrack = pool[randomIndex];
    } else {
      const currentIndex = queue.findIndex((t) => t.id === current?.id);
      const nextIndex = (currentIndex + 1) % queue.length;
      nextTrack = queue[nextIndex];
    }

    if (nextTrack) {
      handlePlayTrack(nextTrack);
    }
  }, [handlePlayTrack]);

  const handlePrev = useCallback(() => {
    const allTracks = tracksRef.current;
    const plTracks = activePlaylistTracksRef.current;
    const tab = currentTabRef.current;
    const current = currentTrackRef.current;

    const queue = (tab === 'playlist' && plTracks && plTracks.length > 0)
      ? plTracks
      : allTracks;

    if (!queue || queue.length === 0) return;

    const currentIndex = queue.findIndex((t) => t.id === current?.id);
    const prevIndex = (currentIndex - 1 + queue.length) % queue.length;
    const prevTrack = queue[prevIndex];

    if (prevTrack) {
      handlePlayTrack(prevTrack);
    }
  }, [handlePlayTrack]);

  const handlePlayAll = (trackListToPlay) => {
    if (!trackListToPlay || trackListToPlay.length === 0) return;
    handlePlayTrack(trackListToPlay[0]);
  };

  const handleToggleFavorite = (track) => {
    setFavorites((prev) => {
      const exists = prev.some((t) => t.id === track.id);
      if (exists) {
        return prev.filter((t) => t.id !== track.id);
      } else {
        return [...prev, track];
      }
    });
  };

  const handleToggleRepeat = () => {
    if (repeatMode === 'off') setRepeatMode('all');
    else if (repeatMode === 'all') setRepeatMode('one');
    else setRepeatMode('off');
  };

  const handleOpenLyrics = (track) => {
    if (track && track.id !== currentTrack.id) {
      handlePlayTrack(track);
    }
    setIsLyricsOpen(true);
  };

  const handleUpdateTrackLyrics = (trackId, newLrcText) => {
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id === trackId) {
          return {
            ...t,
            hasLyrics: !!newLrcText.trim(),
            lyricsLrc: newLrcText
          };
        }
        return t;
      })
    );
  };

  // Gerenciamento de Playlists
  const handleSelectPlaylist = (playlistId) => {
    setActivePlaylistId(playlistId);
    setCurrentTab('playlist');
  };

  const handleOpenCreatePlaylist = () => {
    setPlaylistToEdit(null);
    setPlaylistModalTab('manual');
    setIsPlaylistModalOpen(true);
  };

  const handleOpenSpotifyImport = () => {
    setPlaylistToEdit(null);
    setPlaylistModalTab('spotify');
    setIsPlaylistModalOpen(true);
  };

  const handleOpenEditPlaylist = (playlist) => {
    setPlaylistToEdit(playlist);
    setPlaylistModalTab('manual');
    setIsPlaylistModalOpen(true);
  };

  const handleSavePlaylist = (playlistData) => {
    setPlaylists((prev) => {
      const exists = prev.some((p) => p.id === playlistData.id);
      if (exists) {
        return prev.map((p) => (p.id === playlistData.id ? { ...p, ...playlistData } : p));
      } else {
        return [...prev, playlistData];
      }
    });
    setActivePlaylistId(playlistData.id);
    setCurrentTab('playlist');
  };

  // Importar Álbum ou Playlist do Spotify
  const handleImportSpotify = (spotifyData) => {
    const newTracks = spotifyData.tracks || [];
    setTracks((prev) => {
      const existingIds = new Set(prev.map((t) => t.id));
      const filteredNew = newTracks.filter((t) => !existingIds.has(t.id));
      return [...filteredNew, ...prev];
    });

    const newPlaylist = {
      id: spotifyData.id || 'pl-sp-' + Date.now(),
      name: spotifyData.name,
      description: spotifyData.description,
      cover: spotifyData.cover,
      trackIds: newTracks.map((t) => t.id)
    };

    setPlaylists((prev) => [newPlaylist, ...prev.filter((p) => p.id !== newPlaylist.id)]);
    setActivePlaylistId(newPlaylist.id);
    setCurrentTab('playlist');

    if (newTracks.length > 0) {
      handlePlayTrack(newTracks[0]);
    }
  };

  // Importar Playlist ou Música do YouTube
  const handleImportYouTube = (youtubeData) => {
    if (youtubeData.type === 'playlist') {
      const pl = youtubeData.playlist;
      const newTracks = pl.tracks || [];
      setTracks((prev) => {
        const existingIds = new Set(prev.map((t) => t.id));
        const filteredNew = newTracks.filter((t) => !existingIds.has(t.id));
        return [...filteredNew, ...prev];
      });

      const newPlaylist = {
        id: pl.id || 'pl-yt-' + Date.now(),
        name: pl.name,
        description: pl.description,
        cover: pl.cover,
        trackIds: newTracks.map((t) => t.id)
      };

      setPlaylists((prev) => [newPlaylist, ...prev.filter((p) => p.id !== newPlaylist.id)]);
      setActivePlaylistId(newPlaylist.id);
      setCurrentTab('playlist');

      if (newTracks.length > 0) {
        handlePlayTrack(newTracks[0]);
      }
    } else if (youtubeData.type === 'track') {
      const track = youtubeData.track;
      setTracks((prev) => {
        if (prev.some((t) => t.id === track.id)) {
          return prev.map((t) => (t.id === track.id ? { ...t, ...track } : t));
        }
        return [track, ...prev];
      });

      if (activePlaylistId && activePlaylistId !== 'pl-all') {
        handleToggleTrackInPlaylist(activePlaylistId, track);
      }

      handlePlayTrack(track);
    }
  };

  const handleOpenYouTubeImport = () => {
    setPlaylistToEdit(null);
    setPlaylistModalTab('youtube');
    setIsPlaylistModalOpen(true);
  };

  // Apagar qualquer playlist
  const handleDeletePlaylist = (playlistId, playlistName) => {
    const name = playlistName || 'esta playlist';
    if (window.confirm(`Tem certeza que deseja apagar a playlist "${name}"?`)) {
      setPlaylists((prev) => {
        const updated = prev.filter((p) => p.id !== playlistId);
        if (activePlaylistId === playlistId) {
          setActivePlaylistId(updated[0]?.id || null);
        }
        return updated;
      });
    }
  };

  // Adicionar faixa a uma playlist
  const handleOpenAddToPlaylist = (track) => {
    setTrackToAddToPlaylist(track);
    setIsAddToPlaylistOpen(true);
  };

  const handleToggleTrackInPlaylist = (playlistId, track) => {
    setTracks((prev) => {
      if (!prev.some((t) => t.id === track.id)) {
        return [track, ...prev];
      }
      return prev;
    });

    setPlaylists((prev) =>
      prev.map((p) => {
        if (p.id === playlistId) {
          const currentIds = p.trackIds || [];
          const exists = currentIds.includes(track.id);
          const newIds = exists
            ? currentIds.filter((id) => id !== track.id)
            : [...currentIds, track.id];
          return { ...p, trackIds: newIds };
        }
        return p;
      })
    );
  };

  const handleRemoveTrackFromPlaylist = (playlistId, trackId) => {
    setPlaylists((prev) =>
      prev.map((p) => {
        if (p.id === playlistId) {
          return {
            ...p,
            trackIds: (p.trackIds || []).filter((id) => id !== trackId)
          };
        }
        return p;
      })
    );
  };

  // Upload local
  const handleLocalAudioUpload = (file) => {
    const objectUrl = URL.createObjectURL(file);
    const newTrack = {
      id: 'local-' + Date.now(),
      title: file.name.replace(/\.[^/.]+$/, ''),
      artist: 'Arquivo Local (Computador)',
      album: 'Meu Computador',
      cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop',
      audioUrl: objectUrl,
      duration: 200,
      hasLyrics: false,
      lyricsLrc: ''
    };

    setTracks((prev) => [newTrack, ...prev]);
    setCurrentTrackIndex(0);
    setIsPlaying(true);
  };

  const handleLrcUpload = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text === 'string' && currentTrack) {
        handleUpdateTrackLyrics(currentTrack.id, text);
        setIsLyricsOpen(true);
      }
    };
    reader.readAsText(file);
  };

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen().catch(console.error);
    }
  };

  const handleTimeUpdateFromYT = useCallback((curr, dur) => {
    if (!isLocalTrack) {
      consecutiveErrorsRef.current = 0;
      setCurrentTime(curr);
      if (dur > 0 && dur !== duration) {
        setDuration(dur);
      }
    }
  }, [isLocalTrack, duration]);

  const handleYouTubeError = useCallback((errorCode) => {
    console.warn(`[YouTubePlayer Error ${errorCode}] para faixa:`, currentTrackRef.current?.title);
    if (errorCode === 150 || errorCode === 101 || errorCode === 100) {
      showJamToast('ℹ️ Modo clipe com restrição neste dispositivo. O áudio continua tocando normalmente!');
      setShowVideo(false);
    }
  }, [showJamToast]);

  const handleEndedFromYT = useCallback(() => {
    handleNext();
  }, [handleNext]);

  return (
    <div className="app-layout">
      {/* Dynamic Background Tint based on current cover */}
      <div 
        className="app-ambient-backdrop"
        style={{ backgroundImage: `url(${currentTrack?.cover})` }}
      />

      {/* Floating Reactions & Toast Overlays */}
      <FloatingReactions 
        reactions={floatingReactions} 
        toast={jamToast} 
      />

      {/* YouTube Player para exibição de Vídeo Clip quando solicitado */}
      {!isLocalTrack && showVideo && currentTrack?.youtubeId && (
        <YouTubePlayer
          videoId={currentTrack.youtubeId}
          isPlaying={isPlaying}
          volume={volume}
          isMuted={isMuted}
          seekTime={seekTime}
          showVideo={showVideo}
          onTimeUpdate={handleTimeUpdateFromYT}
          onEnded={handleEndedFromYT}
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
          activePlaylistId={activePlaylistId}
          playlists={playlists}
          favoritesCount={favorites.length}
          totalTracks={tracks.length}
          isPlaying={isPlaying}
          activeJamRoomId={activeJamRoomId}
          jamUserCount={jamUsers.length}
          onSelectPlaylist={handleSelectPlaylist}
          onOpenCreatePlaylist={handleOpenCreatePlaylist}
          onOpenSpotifyImport={handleOpenSpotifyImport}
          onOpenYouTubeImport={handleOpenYouTubeImport}
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
              favorites={favorites}
              onPlayTrack={handlePlayTrack}
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
              favorites={favorites}
              onPlayTrack={handlePlayTrack}
              onPlayAll={handlePlayAll}
              onToggleFavorite={handleToggleFavorite}
              onOpenLyrics={handleOpenLyrics}
              onAddToPlaylist={handleOpenAddToPlaylist}
              onRemoveFromPlaylist={handleRemoveTrackFromPlaylist}
              onEditPlaylist={handleOpenEditPlaylist}
              onDeletePlaylist={handleDeletePlaylist}
            />
          )}

          {currentTab === 'lyrics' && (
            <div className="lyrics-tab-container">
              <LyricsView
                currentTrack={currentTrack}
                currentTime={currentTime}
                onSeek={handleSeek}
                onClose={() => setCurrentTab('home')}
                onUpdateTrackLyrics={handleUpdateTrackLyrics}
              />
            </div>
          )}

          {currentTab === 'search' && (
            <OnlineSearch
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              favorites={favorites}
              onPlayTrack={handlePlayTrack}
              onAddToPlaylist={(track) => handleToggleTrackInPlaylist(activePlaylistId, track)}
              onToggleFavorite={handleToggleFavorite}
              onOpenAddToPlaylistModal={handleOpenAddToPlaylist}
            />
          )}

          {currentTab === 'favorites' && (
            <TrackList
              title="Minhas Músicas Favoritas"
              subtitle={`${favorites.length} músicas curtidas completas salvas no seu navegador`}
              tracks={favorites}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              favorites={favorites}
              onPlayTrack={handlePlayTrack}
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
        duration={duration}
        volume={volume}
        isMuted={isMuted}
        isShuffle={isShuffle}
        repeatMode={repeatMode}
        isFavorite={favorites.some((f) => f.id === currentTrack?.id)}
        isLyricsOpen={isLyricsOpen}
        showVideo={showVideo}
        activeJamRoomId={activeJamRoomId}
        jamUserCount={jamUsers.length}
        onTogglePlay={handleTogglePlay}
        onSeek={handleSeek}
        onPrev={handlePrev}
        onNext={handleNext}
        onToggleShuffle={() => setIsShuffle((prev) => !prev)}
        onToggleRepeat={handleToggleRepeat}
        onToggleFavorite={handleToggleFavorite}
        onToggleLyrics={() => setIsLyricsOpen((prev) => !prev)}
        onToggleVideo={() => setShowVideo((prev) => !prev)}
        onOpenJam={() => setIsJamModalOpen(true)}
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
          onSeek={handleSeek}
          onClose={() => setIsLyricsOpen(false)}
          onUpdateTrackLyrics={handleUpdateTrackLyrics}
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
        onOpenCreatePlaylist={handleOpenCreatePlaylist}
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
