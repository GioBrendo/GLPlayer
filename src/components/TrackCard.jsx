import React from 'react';
import { Play, Pause, Heart, Mic2, Plus } from 'lucide-react';
import { formatTime } from '../utils/lrcParser';

export default function TrackCard({
  track,
  isCurrent,
  isPlaying,
  isFavorite,
  onPlay,
  onToggleFavorite,
  onOpenLyrics,
  onAddToPlaylist
}) {
  return (
    <div className={`track-card ${isCurrent ? 'active-card' : ''}`}>
      <div className="card-cover-wrapper">
        <img 
          src={track.cover} 
          alt={track.title} 
          className="card-cover"
          loading="lazy"
          onError={(e) => {
            e.currentTarget.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop';
          }}
        />
        
        {/* Play/Pause Button on Hover or when Active */}
        <button 
          className={`card-play-btn ${isCurrent && isPlaying ? 'playing' : ''}`}
          onClick={() => onPlay(track)}
          title={isCurrent && isPlaying ? 'Pausar' : 'Tocar agora (Completa)'}
        >
          {isCurrent && isPlaying ? (
            <Pause size={22} fill="currentColor" />
          ) : (
            <Play size={22} fill="currentColor" style={{ marginLeft: '2px' }} />
          )}
        </button>

        {/* LRC Badge */}
        {track.hasLyrics && (
          <button 
            className="card-lrc-indicator" 
            onClick={(e) => {
              e.stopPropagation();
              onOpenLyrics(track);
            }}
            title="Ver letra sincronizada"
          >
            <Mic2 size={12} /> LRC
          </button>
        )}
      </div>

      <div className="card-info">
        <h4 className="card-title" title={track.title}>{track.title}</h4>
        <p className="card-artist" title={track.artist}>{track.artist}</p>
        
        <div className="card-bottom-row">
          <span className="card-duration">
            {formatTime(track.duration || 0)}
          </span>

          <div className="card-actions-right">
            {onAddToPlaylist && (
              <button
                className="card-add-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToPlaylist(track);
                }}
                title="Adicionar a uma playlist"
              >
                <Plus size={16} />
              </button>
            )}

            <button 
              className={`card-like-btn ${isFavorite ? 'liked' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(track);
              }}
              title={isFavorite ? 'Remover dos favoritos' : 'Favoritar'}
            >
              <Heart size={16} fill={isFavorite ? '#ef4444' : 'none'} color={isFavorite ? '#ef4444' : 'currentColor'} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
