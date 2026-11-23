import React, { useEffect, useRef, useState } from 'react';

export default function YouTubePlayer({
  videoId,
  isPlaying,
  volume,
  isMuted,
  seekTime,
  showVideo,
  onTimeUpdate,
  onEnded,
  onError,
  onReady
}) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const isReadyRef = useRef(false);
  const intervalRef = useRef(null);
  const hasEndedTriggeredRef = useRef(false);
  const [apiLoaded, setApiLoaded] = useState(false);

  // Armazena callbacks em refs para evitar closures obsoletas
  const onEndedRef = useRef(onEnded);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);

  useEffect(() => { onEndedRef.current = onEnded; }, [onEnded]);
  useEffect(() => { onTimeUpdateRef.current = onTimeUpdate; }, [onTimeUpdate]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  // 1. Carrega o script da API do YouTube IFrame uma única vez
  useEffect(() => {
    if (window.YT && window.YT.Player) {
      setApiLoaded(true);
      return;
    }

    const existingScript = document.getElementById('yt-iframe-api-script');
    if (!existingScript) {
      const tag = document.createElement('script');
      tag.id = 'yt-iframe-api-script';
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }

    const prevOnReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prevOnReady === 'function') prevOnReady();
      setApiLoaded(true);
    };
  }, []);

  // 2. Inicializa ou atualiza o player quando videoId e API estão prontos
  useEffect(() => {
    if (!apiLoaded || !containerRef.current || !videoId) return;

    if (!playerRef.current) {
      isReadyRef.current = false;
      playerRef.current = new window.YT.Player(containerRef.current, {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          iv_load_policy: 3,
          playsinline: 1,
          enablejsapi: 1
        },
        events: {
          onReady: (event) => {
            isReadyRef.current = true;
            event.target.setVolume(isMuted ? 0 : volume * 100);
            if (isPlaying) {
              try {
                event.target.playVideo();
              } catch (e) {
                console.warn('playVideo erro em onReady:', e);
              }
            }
            if (onReadyRef.current) onReadyRef.current();
          },
          onStateChange: (event) => {
            // 0 = ENDED, 1 = PLAYING, 2 = PAUSED
            if (event.data === 0) {
              if (!hasEndedTriggeredRef.current) {
                hasEndedTriggeredRef.current = true;
                if (onEndedRef.current) onEndedRef.current();
              }
            } else if (event.data === 1) {
              hasEndedTriggeredRef.current = false;
            }
          },
          onError: (event) => {
            console.warn('Erro no player do YouTube:', event.data);
            if (onErrorRef.current) {
              onErrorRef.current(event.data);
            }
          }
        }
      });
    } else if (isReadyRef.current) {
      // Player já existe e está pronto: apenas carrega o novo vídeo
      hasEndedTriggeredRef.current = false;
      try {
        playerRef.current.loadVideoById(videoId);
        playerRef.current.setVolume(isMuted ? 0 : volume * 100);
        if (isPlaying) {
          playerRef.current.playVideo();
        }
      } catch (e) {
        console.warn('loadVideoById erro:', e);
      }
    }
  }, [apiLoaded, videoId]);

  // 3. Sincroniza Play/Pause
  useEffect(() => {
    const player = playerRef.current;
    if (player && isReadyRef.current && typeof player.getPlayerState === 'function') {
      try {
        const state = player.getPlayerState();
        if (isPlaying && state !== 1 && state !== 3) {
          player.playVideo();
        } else if (!isPlaying && state === 1) {
          player.pauseVideo();
        }
      } catch (e) {
        console.warn('Play/Pause erro:', e);
      }
    }
  }, [isPlaying]);

  // 4. Sincroniza Volume e Mudo
  useEffect(() => {
    const player = playerRef.current;
    if (player && isReadyRef.current && typeof player.setVolume === 'function') {
      try {
        player.setVolume(isMuted ? 0 : volume * 100);
      } catch (e) {}
    }
  }, [volume, isMuted]);

  // 5. Sincroniza Seek (pular para tempo)
  useEffect(() => {
    const player = playerRef.current;
    if (player && isReadyRef.current && typeof player.seekTo === 'function' && seekTime !== null && seekTime !== undefined) {
      hasEndedTriggeredRef.current = false;
      try {
        player.seekTo(seekTime, true);
      } catch (e) {}
    }
  }, [seekTime]);

  // 6. Loop de atualização de tempo (letras e progresso)
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      const player = playerRef.current;
      if (
        player &&
        isReadyRef.current &&
        typeof player.getCurrentTime === 'function' &&
        typeof player.getDuration === 'function'
      ) {
        try {
          const current = player.getCurrentTime();
          const dur = player.getDuration();
          if (!isNaN(current) && !isNaN(dur) && dur > 0) {
            if (onTimeUpdateRef.current) {
              onTimeUpdateRef.current(current, dur);
            }

            if (dur > 10 && current >= dur - 0.5 && !hasEndedTriggeredRef.current) {
              hasEndedTriggeredRef.current = true;
              if (onEndedRef.current) onEndedRef.current();
            }
          }
        } catch (e) {}
      }
    }, 200);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div className={`yt-player-wrapper ${showVideo ? 'visible-video' : 'hidden-video'}`}>
      <div ref={containerRef} id="yt-player-embed" />
    </div>
  );
}
