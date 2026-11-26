import React, { useRef, useState } from 'react';
import {
  Search,
  Loader2,
  Play,
  Pause,
  Heart,
  Globe,
  FolderPlus
} from 'lucide-react';
import { searchOnlineTracks, resolveYouTubeId } from '../utils/itunesApi';

export default function OnlineSearch({
  currentTrack,
  isPlaying,
  favoriteIds = new Set(),
  onPlayTrack,
  onToggleFavorite,
  onOpenAddToPlaylistModal
}) {
  const [query, setQuery] = useState('');
  const [searchedTerm, setSearchedTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const searchSeqRef = useRef(0);

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

    // Só a busca mais recente pode atualizar a tela (evita resultados antigos por cima dos novos)
    const seq = ++searchSeqRef.current;
    const isLatest = () => seq === searchSeqRef.current;

    setLoading(true);
    setHasSearched(true);
    setSearchedTerm(term);

    // Se for link do YouTube, consulta endpoint nativo do YouTube
    if (term.includes('youtube.com/') || term.includes('youtu.be/')) {
      try {
        const res = await fetch(`/api/youtube-import?url=${encodeURIComponent(term)}`);
        const data = await res.json();
        if (data.success && isLatest()) {
          setResults(data.type === 'playlist' ? data.playlist.tracks : [data.track]);
          setLoading(false);
          return;
        }
      } catch (err) {
        console.warn('Erro ao importar do YouTube:', err);
      }
    }

    const tracks = await searchOnlineTracks(term, 20);
    if (!isLatest()) return;
    setResults(tracks);
    setLoading(false);

    // Pré-carrega o YouTube ID dos principais resultados em segundo plano para play instantâneo
    tracks.slice(0, 2).forEach((track) => {
      if (track.youtubeId) return;
      resolveYouTubeId(track.title, track.artist).then((id) => {
        if (id && isLatest()) {
          setResults((prev) => prev.map((t) => (t.id === track.id ? { ...t, youtubeId: id } : t)));
        }
      });
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
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
            <p>Nenhuma música encontrada para "{searchedTerm}". Tente outro termo.</p>
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
                  const isFav = favoriteIds.has(track.id);
                  const isCurrentPlaying = isCurrent && isPlaying;

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
                          onClick={() => onPlayTrack(track, results)}
                          title={isCurrentPlaying ? 'Pausar' : 'Tocar música completa'}
                        >
                          {isCurrentPlaying ? (
                            <Pause size={24} fill="currentColor" />
                          ) : (
                            <Play size={24} fill="currentColor" style={{ marginLeft: '2px' }} />
                          )}
                        </button>
                      </div>

                      <div className="result-details">
                        <h4 className="result-song-title" title={track.title}>{track.title}</h4>
                        <p className="result-song-artist" title={track.artist}>{track.artist}</p>
                        <span className="result-song-album" title={track.album}>{track.album}</span>
                      </div>

                      <div className="result-actions">
                        <button
                          className="btn-add-playlist"
                          onClick={() => onOpenAddToPlaylistModal(track)}
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
