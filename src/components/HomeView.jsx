import React from 'react';
import { Play, Pause, Mic2, Sparkles } from 'lucide-react';
import TrackCard from './TrackCard';

export default function HomeView({
  tracks = [],
  currentTrack,
  isPlaying,
  favoriteIds = new Set(),
  onPlayTrack,
  onOpenLyrics,
  onToggleFavorite,
  onNavigateTab,
  onAddToPlaylist
}) {
  const songsWithLyrics = tracks.filter((t) => t.hasLyrics);
  const featuredSong = songsWithLyrics[0] || tracks[0];
  const isFeaturedPlaying = isPlaying && currentTrack?.id === featuredSong?.id;

  return (
    <div className="home-view">
      {/* Featured Hero Banner */}
      {featuredSong && (
        <div className="hero-banner">
          <div 
            className="hero-banner-bg" 
            style={{ backgroundImage: `url(${featuredSong.cover})` }}
          />
          <div className="hero-banner-overlay" />

          <div className="hero-content">
            <div className="hero-badge">
              <Sparkles size={16} />
              <span>Destaque & Música Completa</span>
            </div>

            <h1 className="hero-title">{featuredSong.title}</h1>
            <p className="hero-artist">{featuredSong.artist} • {featuredSong.album}</p>

            <div className="hero-actions">
              <button 
                className="hero-play-btn"
                onClick={() => onPlayTrack(featuredSong, tracks)}
              >
                {isFeaturedPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                <span>{isFeaturedPlaying ? 'Pausar' : 'Ouvir Completa'}</span>
              </button>

              {featuredSong.hasLyrics && (
                <button 
                  className="hero-lyrics-btn"
                  onClick={() => onOpenLyrics(featuredSong)}
                >
                  <Mic2 size={18} />
                  <span>Ver Letra (Karaoke)</span>
                </button>
              )}
            </div>
          </div>

          <div className="hero-artwork-box">
            <img 
              src={featuredSong.cover} 
              alt={featuredSong.title} 
              className="hero-artwork-img"
            />
          </div>
        </div>
      )}

      {/* Section: Letras Sincronizadas */}
      {songsWithLyrics.length > 0 && (
        <section className="home-section">
          <div className="section-header">
            <div className="section-title-wrap">
              <Mic2 size={22} className="text-accent" />
              <h3 className="section-title">Modo Letras & Karaoke Sincronizado</h3>
            </div>
            <button 
              className="section-see-all" 
              onClick={() => onNavigateTab('lyrics')}
            >
              Abrir Karaoke
            </button>
          </div>

          <p className="section-desc">
            Essas faixas contam com sincronização linha por linha em tempo real. Clique na letra para pular o áudio para o segundo exato!
          </p>

          <div className="tracks-grid">
            {songsWithLyrics.map((track, idx) => (
              <TrackCard
                key={`${track.id}-${idx}`}
                track={track}
                isCurrent={currentTrack?.id === track.id}
                isPlaying={isPlaying}
                isFavorite={favoriteIds.has(track.id)}
                onPlay={(t) => onPlayTrack(t, songsWithLyrics)}
                onToggleFavorite={onToggleFavorite}
                onOpenLyrics={onOpenLyrics}
                onAddToPlaylist={onAddToPlaylist}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
