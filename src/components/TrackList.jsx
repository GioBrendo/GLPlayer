import React, { useState, useMemo } from 'react';
import { 
  Play, 
  Pause, 
  Heart, 
  Mic2, 
  Search, 
  LayoutGrid, 
  List, 
  Plus, 
  Trash2, 
  Edit3,
  Music
} from 'lucide-react';
import TrackCard from './TrackCard';
import { formatTime } from '../utils/lrcParser';

export default function TrackList({
  title = 'Músicas',
  subtitle,
  playlist = null,
  tracks = [],
  currentTrack,
  isPlaying,
  favoriteIds = new Set(),
  onPlayTrack,
  onPlayAll,
  onToggleFavorite,
  onOpenLyrics,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onEditPlaylist,
  onDeletePlaylist
}) {
  const [filterQuery, setFilterQuery] = useState('');
  const [filterLyricsOnly, setFilterLyricsOnly] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [sortBy, setSortBy] = useState('default');

  const filteredTracks = useMemo(() => {
    let result = [...tracks];

    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase();
      result = result.filter((t) =>
        [t.title, t.artist, t.album].some((field) => (field || '').toLowerCase().includes(q))
      );
    }

    if (filterLyricsOnly) {
      result = result.filter((t) => t.hasLyrics);
    }

    if (sortBy === 'title') {
      result.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (sortBy === 'artist') {
      result.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
    }

    return result;
  }, [tracks, filterQuery, filterLyricsOnly, sortBy]);

  const totalSeconds = tracks.reduce((acc, t) => acc + (t.duration || 210), 0);
  const totalMinutes = Math.floor(totalSeconds / 60);

  return (
    <div className="track-list-view">
      {/* Playlist Hero Header */}
      {playlist ? (
        <div className="playlist-hero-banner">
          <img 
            src={playlist.cover} 
            alt={playlist.name} 
            className="playlist-hero-cover"
            onError={(e) => {
              e.currentTarget.src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop';
            }}
          />
          <div className="playlist-hero-info">
            <span className="playlist-type-tag">PLAYLIST</span>
            <h1 className="playlist-hero-name">{playlist.name}</h1>
            <p className="playlist-hero-desc">{playlist.description}</p>
            <div className="playlist-hero-meta">
              <span>{tracks.length} músicas</span>
              <span>•</span>
              <span>aprox. {totalMinutes} min</span>
            </div>

            <div className="playlist-hero-actions">
              {tracks.length > 0 && (
                <button className="play-all-btn" onClick={() => onPlayAll(filteredTracks)}>
                  <Play size={18} fill="currentColor" />
                  <span>Tocar Playlist ({filteredTracks.length})</span>
                </button>
              )}

              {/* Permite editar QUALQUER playlist */}
              {onEditPlaylist && (
                <button className="btn-edit-pl-header" onClick={() => onEditPlaylist(playlist)}>
                  <Edit3 size={16} />
                  <span>Editar Playlist</span>
                </button>
              )}

              {/* Permite excluir QUALQUER playlist */}
              {onDeletePlaylist && (
                <button 
                  className="btn-delete-pl-header" 
                  onClick={() => onDeletePlaylist(playlist.id, playlist.name)}
                >
                  <Trash2 size={16} />
                  <span>Excluir Playlist</span>
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Regular Header for Favorites or All */
        <div className="view-header">
          <div className="view-title-group">
            <h2 className="view-title">{title}</h2>
            {subtitle && <p className="view-subtitle">{subtitle}</p>}
          </div>

          <div className="view-header-actions">
            {tracks.length > 0 && (
              <button className="play-all-btn" onClick={() => onPlayAll(filteredTracks)}>
                <Play size={18} fill="currentColor" />
                <span>Tocar Todas ({filteredTracks.length})</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filter and control bar */}
      <div className="filter-bar">
        <div className="search-input-wrap">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Filtrar nesta lista de músicas..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="filter-search-input"
          />
        </div>

        <div className="filter-toggles">
          <button
            className={`filter-chip ${filterLyricsOnly ? 'active' : ''}`}
            onClick={() => setFilterLyricsOnly(!filterLyricsOnly)}
          >
            <Mic2 size={14} />
            <span>Apenas com Letras LRC</span>
          </button>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="sort-select"
          >
            <option value="default">Ordem da Playlist</option>
            <option value="title">Título (A-Z)</option>
            <option value="artist">Artista (A-Z)</option>
          </select>

          <div className="view-mode-toggle">
            <button
              className={`mode-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="Visualização em lista"
            >
              <List size={18} />
            </button>
            <button
              className={`mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Visualização em grade"
            >
              <LayoutGrid size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Tracks Container */}
      {filteredTracks.length === 0 ? (
        <div className="empty-tracks-msg">
          <Music size={40} className="empty-icon" />
          <p>Nenhuma música nesta lista no momento.</p>
          <span className="empty-tip">Você pode buscar músicas online e adicioná-las aqui!</span>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="tracks-grid">
          {filteredTracks.map((track, idx) => (
            <TrackCard
              key={`${track.id}-${idx}`}
              track={track}
              isCurrent={currentTrack?.id === track.id}
              isPlaying={isPlaying}
              isFavorite={favoriteIds.has(track.id)}
              onPlay={(t) => onPlayTrack(t, filteredTracks)}
              onToggleFavorite={onToggleFavorite}
              onOpenLyrics={onOpenLyrics}
              onAddToPlaylist={onAddToPlaylist}
            />
          ))}
        </div>
      ) : (
        <div className="tracks-table-wrap">
          <table className="tracks-table">
            <thead>
              <tr>
                <th style={{ width: '45px' }}>#</th>
                <th>Título</th>
                <th>Álbum</th>
                <th style={{ width: '80px', textAlign: 'center' }}>Letra</th>
                <th style={{ width: '70px', textAlign: 'right' }}>Duração</th>
                <th style={{ width: '100px', textAlign: 'center' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredTracks.map((track, idx) => {
                const isCurrent = currentTrack?.id === track.id;
                const isFav = favoriteIds.has(track.id);

                return (
                  <tr
                    key={`${track.id}-${idx}`}
                    className={`table-row ${isCurrent ? 'active-row' : ''}`}
                    onClick={() => onPlayTrack(track, filteredTracks)}
                  >
                    {/* Index or Play indicator */}
                    <td className="col-index">
                      {isCurrent && isPlaying ? (
                        <div className="table-playing-equalizer">
                          <span className="eq-bar" />
                          <span className="eq-bar" />
                          <span className="eq-bar" />
                        </div>
                      ) : (
                        <span className="row-num">{idx + 1}</span>
                      )}
                      <button className="row-hover-play">
                        {isCurrent && isPlaying ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}
                      </button>
                    </td>

                    {/* Title & Artist & Cover */}
                    <td className="col-title">
                      <div className="row-meta">
                        <img
                          src={track.cover}
                          alt={track.title}
                          className="row-cover"
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&auto=format&fit=crop';
                          }}
                        />
                        <div className="row-text">
                          <span className={`row-track-title ${isCurrent ? 'active-title' : ''}`}>
                            {track.title}
                          </span>
                          <span className="row-track-artist">{track.artist}</span>
                        </div>
                      </div>
                    </td>

                    {/* Album */}
                    <td className="col-album">{track.album || '—'}</td>

                    {/* LRC Badge */}
                    <td className="col-lyrics" style={{ textAlign: 'center' }}>
                      {track.hasLyrics ? (
                        <button
                          className="table-lrc-pill"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenLyrics(track);
                          }}
                          title="Abrir letra sincronizada"
                        >
                          <Mic2 size={12} /> LRC
                        </button>
                      ) : (
                        <span className="no-lyrics-dash">—</span>
                      )}
                    </td>

                    {/* Duration */}
                    <td className="col-duration" style={{ textAlign: 'right' }}>
                      {formatTime(track.duration || 210)}
                    </td>

                    {/* Actions Column */}
                    <td className="col-fav" style={{ textAlign: 'center' }}>
                      <div className="table-row-actions">
                        {/* Add to playlist button */}
                        {onAddToPlaylist && (
                          <button
                            className="row-action-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddToPlaylist(track);
                            }}
                            title="Adicionar a outra playlist"
                          >
                            <Plus size={16} />
                          </button>
                        )}

                        {/* Favorite button */}
                        <button
                          className={`row-fav-btn ${isFav ? 'liked' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(track);
                          }}
                          title={isFav ? 'Remover dos favoritos' : 'Favoritar'}
                        >
                          <Heart
                            size={16}
                            fill={isFav ? '#ef4444' : 'none'}
                            color={isFav ? '#ef4444' : 'currentColor'}
                          />
                        </button>

                        {/* Remove from this playlist button */}
                        {onRemoveFromPlaylist && playlist && (
                          <button
                            className="row-action-btn delete-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveFromPlaylist(playlist.id, track.id);
                            }}
                            title="Remover desta playlist"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
