import React from 'react';
import YoutubeIcon from './YoutubeIcon';
import GLLogo from './GLLogo';
import { 
  Home, 
  Music2, 
  Mic2, 
  Search, 
  Heart, 
  FolderPlus, 
  Sparkles,
  Plus,
  Trash2,
  Link2,
  Users
} from 'lucide-react';

export default function Sidebar({ 
  currentTab, 
  setCurrentTab, 
  activePlaylistId,
  playlists = [],
  favoritesCount, 
  totalTracks, 
  isPlaying = false,
  activeJamRoomId = null,
  jamUserCount = 0,
  onSelectPlaylist,
  onOpenCreatePlaylist,
  onOpenSpotifyImport,
  onOpenYouTubeImport,
  onOpenJam,
  onDeletePlaylist,
  onLocalAudioUpload,
  onLrcUpload 
}) {
  const localInputRef = React.useRef(null);
  const lrcInputRef = React.useRef(null);

  const navItems = [
    { id: 'home', label: 'Início', icon: Home },
    { id: 'jam-action', label: 'Ouvir Juntos', icon: Users, badge: activeJamRoomId ? `${jamUserCount} ouvindo` : 'Sincronizar', isJam: true },
    { id: 'lyrics', label: 'Letras & Karaoke', icon: Mic2, highlight: true },
    { id: 'search', label: 'Buscar Online', icon: Search },
    { id: 'favorites', label: 'Favoritas', icon: Heart, badge: favoritesCount },
  ];

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      onLocalAudioUpload(file);
    }
  };

  const handleLrcChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      onLrcUpload(file);
    }
  };

  return (
    <aside className="sidebar">
      {/* Brand Header */}
      <div className="brand" onClick={() => setCurrentTab('home')}>
        <div className="brand-icon-wrapper">
          <GLLogo variant="icon" size={26} animated={isPlaying} />
        </div>
        <div className="brand-text">
          <h1 className="brand-title">GL<span className="brand-dot">.</span>music</h1>
          <span className="brand-subtitle">SOUND &amp; STREAMING</span>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="nav-menu">
        <div className="nav-section-label">MENU</div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              className={`nav-item ${isActive ? 'active' : ''} ${item.highlight ? 'highlight-item' : ''} ${item.isJam && activeJamRoomId ? 'jam-nav-active' : ''}`}
              onClick={() => {
                if (item.isJam) {
                  onOpenJam();
                } else {
                  setCurrentTab(item.id);
                }
              }}
            >
              <Icon size={20} className="nav-icon" />
              <span className="nav-label">{item.label}</span>
              {item.badge !== undefined && (
                <span className={`nav-badge ${item.isJam && activeJamRoomId ? 'badge-live' : ''}`}>
                  {item.badge}
                </span>
              )}
              {item.highlight && (
                <span className="live-dot" title="LRC Ativo" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Playlists Section */}
      <div className="sidebar-playlists-section">
        <div className="sidebar-section-header">
          <span className="nav-section-label">PLAYLISTS ({playlists.length})</span>
          <div className="header-actions-group">
            <button 
              className="btn-add-playlist-sidebar youtube-import-trigger"
              onClick={onOpenYouTubeImport}
              title="Importar do YouTube (Playlist, Mix ou Música)"
            >
              <YoutubeIcon size={16} />
            </button>
            <button 
              className="btn-add-playlist-sidebar spotify-import-trigger"
              onClick={onOpenSpotifyImport}
              title="Importar link do Spotify (Álbum ou Playlist)"
            >
              <Link2 size={16} />
            </button>
            <button 
              className="btn-add-playlist-sidebar"
              onClick={onOpenCreatePlaylist}
              title="Criar nova playlist"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="playlists-scroll-list">
          {playlists.length === 0 ? (
            <div className="sidebar-empty-playlists">
              <p>Nenhuma playlist.</p>
              <button className="btn-mini-create" onClick={onOpenCreatePlaylist}>
                + Criar
              </button>
            </div>
          ) : (
            playlists.map((pl) => {
              const isPlActive = currentTab === 'playlist' && activePlaylistId === pl.id;
              return (
                <div
                  key={pl.id}
                  className={`sidebar-playlist-item ${isPlActive ? 'active' : ''}`}
                  onClick={() => onSelectPlaylist(pl.id)}
                >
                  <img 
                    src={pl.cover} 
                    alt={pl.name} 
                    className="sidebar-pl-thumb"
                    onError={(e) => {
                      e.currentTarget.src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=100&auto=format&fit=crop';
                    }}
                  />
                  <div className="sidebar-pl-info">
                    <span className="sidebar-pl-name" title={pl.name}>{pl.name}</span>
                    <span className="sidebar-pl-count">{pl.trackIds ? pl.trackIds.length : 0} músicas</span>
                  </div>

                  <button
                    className="btn-delete-pl-inline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeletePlaylist(pl.id, pl.name);
                    }}
                    title={`Excluir playlist "${pl.name}"`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Import & Actions Section */}
      <div className="sidebar-actions">
        <div className="nav-section-label">IMPORTAR / PERSONALIZAR</div>
        
        {/* YouTube Fast Import Action */}
        <button 
          className="action-btn youtube-btn"
          onClick={onOpenYouTubeImport}
          title="Importar playlist ou música via link do YouTube"
        >
          <YoutubeIcon size={17} />
          <span>Importar do YouTube</span>
        </button>

        {/* Spotify Fast Import Action */}
        <button 
          className="action-btn spotify-btn"
          onClick={onOpenSpotifyImport}
          title="Importar álbum ou playlist via link do Spotify"
        >
          <Link2 size={17} />
          <span>Importar do Spotify</span>
        </button>

        {/* Local Audio Input */}
        <input 
          type="file" 
          ref={localInputRef} 
          accept="audio/*" 
          style={{ display: 'none' }} 
          onChange={handleFileChange} 
        />
        <button 
          className="action-btn"
          onClick={() => localInputRef.current?.click()}
          title="Tocar qualquer arquivo de áudio do seu computador"
        >
          <FolderPlus size={17} />
          <span>Tocar MP3 do PC</span>
        </button>

        {/* Custom LRC Input */}
        <input 
          type="file" 
          ref={lrcInputRef} 
          accept=".lrc,.txt" 
          style={{ display: 'none' }} 
          onChange={handleLrcChange} 
        />
        <button 
          className="action-btn secondary"
          onClick={() => lrcInputRef.current?.click()}
          title="Importar um arquivo .lrc sincronizado"
        >
          <Sparkles size={17} />
          <span>Adicionar Letra (.lrc)</span>
        </button>
      </div>

      {/* Sidebar Footer */}
      <div className="sidebar-footer">
        <div className="status-pill">
          <span className="status-dot pulse" />
          <span>{activeJamRoomId ? `Jam: ${activeJamRoomId}` : 'Músicas Completas HD'}</span>
        </div>
      </div>
    </aside>
  );
}
