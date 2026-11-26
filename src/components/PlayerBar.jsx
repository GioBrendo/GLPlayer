import React from 'react';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Shuffle, 
  Repeat, 
  Repeat1, 
  Volume2, 
  VolumeX, 
  Volume1,
  Mic2, 
  Heart, 
  Maximize2,
  Tv
} from 'lucide-react';
import { formatTime } from '../utils/lrcParser';

export default function PlayerBar({
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  volume,
  isMuted,
  isShuffle,
  repeatMode, // 'off', 'all', 'one'
  isFavorite,
  isLyricsOpen,
  showVideo,
  onTogglePlay,
  onSeek,
  onPrev,
  onNext,
  onToggleShuffle,
  onToggleRepeat,
  onToggleFavorite,
  onToggleLyrics,
  onToggleVideo,
  onChangeVolume,
  onToggleMute,
  onToggleFullscreen
}) {
  if (!currentTrack) {
    return (
      <footer className="player-bar empty-player">
        <p>Selecione uma música para começar a ouvir</p>
      </footer>
    );
  }

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const handleSliderChange = (e) => {
    if (!(duration > 0)) return;
    const newTime = (parseFloat(e.target.value) / 100) * duration;
    onSeek(newTime);
  };

  const volumeIcon = isMuted || volume === 0
    ? <VolumeX size={20} />
    : volume < 0.5
      ? <Volume1 size={20} />
      : <Volume2 size={20} />;

  return (
    <footer className="player-bar">
      {/* Track Info (Left) */}
      <div className="player-track-info">
        <div className="track-thumb-container">
          <img 
            src={currentTrack.cover} 
            alt={currentTrack.title} 
            className={`track-thumb ${isPlaying ? 'rotating-thumb' : ''}`}
            onError={(e) => {
              e.currentTarget.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&auto=format&fit=crop';
            }}
          />
          {isPlaying && (
            <div className="mini-equalizer-badge">
              <span className="bar" />
              <span className="bar" />
              <span className="bar" />
            </div>
          )}
        </div>
        <div className="track-text">
          <div className="track-title-row">
            <span className="track-title" title={currentTrack.title}>
              {currentTrack.title}
            </span>
            {currentTrack.hasLyrics && (
              <span className="lrc-badge" title="Possui letra sincronizada">LRC</span>
            )}
            <span className="full-song-badge" title="Música completa sem cortes">COMPLETA</span>
          </div>
          <span className="track-artist" title={currentTrack.artist}>
            {currentTrack.artist}
          </span>
        </div>
        <button 
          className={`player-fav-btn ${isFavorite ? 'liked' : ''}`}
          onClick={() => onToggleFavorite(currentTrack)}
          title={isFavorite ? 'Remover dos favoritos' : 'Salvar nos favoritos'}
        >
          <Heart size={20} fill={isFavorite ? '#ef4444' : 'none'} color={isFavorite ? '#ef4444' : 'currentColor'} />
        </button>
      </div>

      {/* Main Controls & Progress (Center) */}
      <div className="player-center-controls">
        <div className="controls-buttons">
          <button 
            className={`ctrl-btn icon-btn ${isShuffle ? 'active' : ''}`}
            onClick={onToggleShuffle}
            title={isShuffle ? 'Desativar modo aleatório' : 'Ativar modo aleatório'}
          >
            <Shuffle size={18} />
          </button>

          <button 
            className="ctrl-btn icon-btn" 
            onClick={onPrev}
            title="Música anterior"
          >
            <SkipBack size={22} />
          </button>

          <button 
            className="ctrl-btn play-btn"
            onClick={onTogglePlay}
            title={isPlaying ? 'Pausar (Espaço)' : 'Tocar (Espaço)'}
          >
            {isPlaying ? <Pause size={24} /> : <Play size={24} style={{ marginLeft: '3px' }} />}
          </button>

          <button 
            className="ctrl-btn icon-btn" 
            onClick={onNext}
            title="Próxima música"
          >
            <SkipForward size={22} />
          </button>

          <button 
            className={`ctrl-btn icon-btn ${repeatMode !== 'off' ? 'active' : ''}`}
            onClick={onToggleRepeat}
            title={
              repeatMode === 'off' 
                ? 'Repetir tudo' 
                : repeatMode === 'all' 
                ? 'Repetir esta música' 
                : 'Desativar repetição'
            }
          >
            {repeatMode === 'one' ? <Repeat1 size={19} /> : <Repeat size={19} />}
          </button>
        </div>

        {/* Progress Bar */}
        <div className="progress-container">
          <span className="time-display current-time">{formatTime(currentTime)}</span>
          <div className="slider-track-wrap">
            <input 
              type="range" 
              min="0" 
              max="100" 
              step="0.1"
              value={progressPercent}
              onChange={handleSliderChange}
              className="progress-slider"
              aria-label="Posição da música"
              disabled={!(duration > 0)}
            />
            <div 
              className="progress-fill" 
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="time-display total-time">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Right Tools & Volume */}
      <div className="player-right-tools">
        {/* Video Toggle Button */}
        <button 
          className={`tool-btn ${showVideo ? 'active' : ''}`}
          onClick={onToggleVideo}
          title={showVideo ? 'Ocultar vídeo / clipe' : 'Exibir vídeo / clipe oficial'}
        >
          <Tv size={19} />
          <span className="tool-label">Vídeo</span>
        </button>

        {/* Lyrics Button */}
        <button 
          className={`tool-btn ${isLyricsOpen ? 'active' : ''}`}
          onClick={onToggleLyrics}
          title={isLyricsOpen ? 'Fechar letras' : 'Ver letra sincronizada (L)'}
        >
          <Mic2 size={19} />
          <span className="tool-label">Letra</span>
        </button>

        {/* Volume Slider */}
        <div className="volume-control-wrap">
          <button 
            className="vol-btn"
            onClick={onToggleMute}
            title={isMuted ? 'Ativar som (M)' : 'Mudo (M)'}
          >
            {volumeIcon}
          </button>
          <input 
            type="range" 
            min="0" 
            max="1" 
            step="0.01" 
            value={isMuted ? 0 : volume} 
            onChange={(e) => onChangeVolume(parseFloat(e.target.value))}
            className="volume-slider"
            aria-label="Volume"
          />
        </div>

        {/* Fullscreen Button */}
        <button 
          className="tool-btn icon-only"
          onClick={onToggleFullscreen}
          title="Modo Tela Cheia"
        >
          <Maximize2 size={18} />
        </button>
      </div>
    </footer>
  );
}
