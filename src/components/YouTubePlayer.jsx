import React, { useCallback, useEffect, useRef } from 'react';

/**
 * Exibe o clipe do YouTube como acompanhamento visual.
 *
 * O áudio sempre vem do <audio> principal (/api/stream). O vídeo fica mudo e
 * segue o tempo do áudio; assim não há som duplicado nem dois eventos de
 * "fim da música" (que antes faziam o player pular duas faixas).
 */

const SYNC_INTERVAL_MS = 500;
const DRIFT_TOLERANCE_S = 1.2;

let apiPromise = null;

function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousCallback === 'function') previousCallback();
      resolve(window.YT);
    };

    if (!document.getElementById('yt-iframe-api-script')) {
      const tag = document.createElement('script');
      tag.id = 'yt-iframe-api-script';
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      tag.onerror = () => {
        apiPromise = null;
        tag.remove();
        reject(new Error('Não foi possível carregar a API do YouTube'));
      };
      document.head.appendChild(tag);
    }
  });

  return apiPromise;
}

export default function YouTubePlayer({ videoId, isPlaying, getMasterTime, showVideo = true, onError }) {
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const readyRef = useRef(false);
  const latestRef = useRef({ videoId, isPlaying, getMasterTime, onError });

  useEffect(() => {
    latestRef.current = { videoId, isPlaying, getMasterTime, onError };
  });

  // Mantém o vídeo igual ao áudio: mesmo videoId, play/pause e posição
  const sync = useCallback(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    const { videoId: wantedId, isPlaying: shouldPlay, getMasterTime: masterTime } = latestRef.current;

    try {
      const master = masterTime?.();
      const loadedId = player.getVideoData?.()?.video_id;
      if (wantedId && loadedId && loadedId !== wantedId) {
        const startSeconds = Number.isFinite(master) ? master : 0;
        if (shouldPlay) player.loadVideoById({ videoId: wantedId, startSeconds });
        else player.cueVideoById({ videoId: wantedId, startSeconds });
        return;
      }

      const state = player.getPlayerState(); // 1 = tocando, 2 = pausado, 3 = carregando
      if (shouldPlay && state !== 1 && state !== 3) player.playVideo();
      else if (!shouldPlay && (state === 1 || state === 3)) player.pauseVideo();

      if (Number.isFinite(master) && state !== 3) {
        const drift = Math.abs(player.getCurrentTime() - master);
        if (drift > DRIFT_TOLERANCE_S) player.seekTo(master, true);
      }
    } catch {
      // player ainda inicializando
    }
  }, []);

  // Cria o player uma única vez
  useEffect(() => {
    const host = hostRef.current;
    // O YT.Player substitui o elemento recebido por um <iframe>; usamos um elemento
    // criado fora do React para não conflitar com a árvore de componentes.
    const mountPoint = document.createElement('div');
    host.appendChild(mountPoint);
    let cancelled = false;

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        playerRef.current = new YT.Player(mountPoint, {
          height: '100%',
          width: '100%',
          videoId: latestRef.current.videoId,
          playerVars: {
            autoplay: 1,
            mute: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            iv_load_policy: 3,
            playsinline: 1,
            enablejsapi: 1,
            origin: window.location.origin
          },
          events: {
            onReady: (event) => {
              readyRef.current = true;
              event.target.mute();
              sync();
            },
            onError: (event) => {
              latestRef.current.onError?.(event.data);
            }
          }
        });
      })
      .catch((err) => {
        console.warn(err.message);
        latestRef.current.onError?.('api');
      });

    const interval = setInterval(sync, SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      readyRef.current = false;
      try {
        playerRef.current?.destroy();
      } catch {
        // já destruído
      }
      playerRef.current = null;
      host.replaceChildren();
    };
  }, [sync]);

  // Reage na hora a play/pause e troca de vídeo (o intervalo cobre o resto)
  useEffect(() => {
    sync();
  }, [sync, videoId, isPlaying]);

  return (
    <div className={`yt-player-wrapper ${showVideo ? 'visible-video' : 'hidden-video'}`}>
      <div ref={hostRef} id="yt-player-embed" style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
