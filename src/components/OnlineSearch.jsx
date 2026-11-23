import React, { useState } from 'react';
import { 
  Search, 
  Loader2, 
  Play, 
  Plus, 
  Check, 
  Heart,
  Globe,
  FolderPlus
} from 'lucide-react';
import { searchOnlineTracks, resolveYouTubeId } from '../utils/itunesApi';

export default function OnlineSearch({
  currentTrack,
  isPlaying,
  favorites = [],
  onPlayTrack,
  onAddToPlaylist,
  onToggleFavorite,
  onOpenAddToPlaylistModal
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [addedIds, setAddedIds] = useState(new Set());

  const quickPicks = [
    'Taylor Swift',
    'Sabrina Carpenter',
    'Chappell Roan',
    'The Weeknd',
    'BTS',
    'Billie Eilish',
    'Coldplay',
    'Bruno Mars',
    'Guns N\' Roses',
    'Dua Lipa',
    'Post Malone'
  ];

  const handleSearch = async (searchTerm) => {
    const term = (searchTerm || query).trim();
    if (!term) return;

    setLoading(true);
    setHasSearched(true);

    // Se for link do YouTube, consulta endpoint nativo do YouTube
    if (term.includes('youtube.com/') || term.includes('youtu.be/')) {
      try {
        const res = await fetch(`/api/youtube-import?url=${encodeURIComponent(term)}`);
        const data = await res.json();
        if (data.success) {
          if (data.type === 'playlist') {
            setResults(data.playlist.tracks);
          } else if (data.type === 'track') {
            setResults([data.track]);
          }
          setLoading(false);
          return;
        }
      } catch (err) {
        console.warn('Erro ao importar do YouTube:', err);
      }
    }

    const tracks = await searchOnlineTracks(term, 20);
    setResults(tracks);
    setLoading(false);

    // Pré-carrega o YouTube ID dos principais resultados em segundo plano para play instantâneo
    if (tracks.length > 0 && !tracks[0].youtubeId) {
      resolveYouTubeId(tracks[0].title, tracks[0].artist).then((id) => {
        if (id) {
          tracks[0].youtubeId = id;
          setResults([...tracks]);
        }
      });
      if (tracks[1] && !tracks[1].youtubeId) {
        resolveYouTubeId(tracks[1].title, tracks[1].artist).then((id) => {
          if (id) {
            tracks[1].youtubeId = id;
            setResults([...tracks]);
          }
        });
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleAdd = (track) => {
    if (onOpenAddToPlaylistModal) {
      onOpenAddToPlaylistModal(track);
    } else {
      onAddToPlaylist(track);
      setAddedIds((prev) => new Set([...prev, track.id]));
    }
  };

  return (
    <div className="online-search-view">
      <div className="search-hero">
        <div className="search-hero-badge">
          <Globe size={16} />
          <span>Catálogo Global Online</span>
        </div>
        <h2 className="search-hero-title">O que você quer ouvir hoje?</h2>
        <p className="search-hero-subtitle">
          Pesquise qualquer artista ou música no mundo para tocar a versão completa e adicionar às suas playlists.
        </p>

        {/* Search Input Box */}
        <div className="main-search-box">
          <Search size={22} className="main-search-icon" />
          <input
            type="text"
            className="main-search-input"
            placeholder="Buscar música, artista ou colar link do YouTube (Playlist ou Vídeo)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <button 
            className="main-search-btn"
            onClick={() => handleSearch()}
            disabled={loading || !query.trim()}
          >
            {loading ? <Loader2 size={18} className="spin-icon" /> : 'Buscar'}
          </button>
        </div>

        {/* Quick Suggestion Chips */}
        <div className="quick-suggestions">
          <span className="suggestions-label">Sugestões rápidas:</span>
          {quickPicks.map((pick) => (
            <button
              key={pick}
              className="suggestion-chip"
              onClick={() => {
                setQuery(pick);
                handleSearch(pick);
              }}
            >
              {pick}
            </button>
          ))}
        </div>
      </div>

      {/* Results Section */}
      <div className="search-results-section">
        {loading ? (
          <div className="search-loading-state">
            <Loader2 size={36} className="spin-icon text-accent" />
            <p>Buscando músicas na nuvem...</p>
          </div>
        ) : hasSearched && results.length === 0 ? (
          <div className="search-empty-state">
            <p>Nenhuma música encontrada para "{query}". Tente outro termo.</p>
          </div>
        ) : (
          results.length > 0 && (
            <div className="results-wrapper">
              <h3 className="results-title">
                Resultados encontrados ({results.length})
              </h3>
              <div className="results-grid">
                {results.map((track, idx) => {
                  const isCurrent = currentTrack?.id === track.id;
                  const isFav = favorites.some((f) => f.id === track.id);
                  const isAdded = addedIds.has(track.id);

                  return (
                    <div key={`${track.id}-${idx}`} className={`result-card ${isCurrent ? 'active-result' : ''}`}>
                      <div className="result-cover-box">
                        <img 
                          src={track.cover} 
                          alt={track.title} 
                          className="result-cover-img"
                          onError={(e) => {
                            e.currentTarget.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop';
                          }}
                        />
                        <button
                          className="result-play-overlay"
                          onClick={() => onPlayTrack(track)}
                          title="Tocar música completa"
                        >
                          <Play size={24} fill="currentColor" style={{ marginLeft: '2px' }} />
                        </button>
                      </div>

                      <div className="result-details">
                        <h4 className="result-song-title" title={track.title}>{track.title}</h4>
                        <p className="result-song-artist" title={track.artist}>{track.artist}</p>
                        <span className="result-song-album" title={track.album}>{track.album}</span>
                      </div>

                      <div className="result-actions">
                        <button
                          className={`btn-add-playlist ${isAdded ? 'added' : ''}`}
                          onClick={() => handleAdd(track)}
                          title="Adicionar à playlist"
                        >
                          <FolderPlus size={15} />
                          <span>Playlist</span>
                        </button>

                        <button
                          className={`btn-result-fav ${isFav ? 'liked' : ''}`}
                          onClick={() => onToggleFavorite(track)}
                          title="Favoritar"
                        >
                          <Heart 
                            size={18} 
                            fill={isFav ? '#ef4444' : 'none'} 
                            color={isFav ? '#ef4444' : 'currentColor'} 
                          />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
