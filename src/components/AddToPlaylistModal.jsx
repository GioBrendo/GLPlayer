import React from 'react';
import { X, Check, Plus, FolderPlus, Music } from 'lucide-react';

export default function AddToPlaylistModal({
  isOpen,
  track,
  playlists = [],
  onClose,
  onToggleTrackInPlaylist,
  onOpenCreatePlaylist
}) {
  if (!isOpen || !track) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card add-to-playlist-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-title">
            <Music size={20} className="text-accent" />
            <div>
              <h3>Adicionar à Playlist</h3>
              <p className="modal-subtitle">
                {track.title} • <span className="text-secondary">{track.artist}</span>
              </p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="playlist-selection-list">
          {playlists.map((pl) => {
            const isIncluded = pl.trackIds && pl.trackIds.includes(track.id);
            return (
              <div
                key={pl.id}
                className={`playlist-select-item ${isIncluded ? 'selected' : ''}`}
                onClick={() => onToggleTrackInPlaylist(pl.id, track)}
              >
                <img
                  src={pl.cover}
                  alt={pl.name}
                  className="pl-select-cover"
                  onError={(e) => {
                    e.currentTarget.src = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=200&auto=format&fit=crop';
                  }}
                />
                <div className="pl-select-info">
                  <span className="pl-select-name">{pl.name}</span>
                  <span className="pl-select-count">
                    {pl.trackIds ? pl.trackIds.length : 0} músicas
                  </span>
                </div>
                <div className="pl-select-checkbox">
                  {isIncluded ? <Check size={18} className="check-icon" /> : <Plus size={18} />}
                </div>
              </div>
            );
          })}
        </div>

        <div className="add-to-pl-footer">
          <button
            className="btn-create-new-pl-inline"
            onClick={() => {
              onClose();
              onOpenCreatePlaylist();
            }}
          >
            <FolderPlus size={18} />
            <span>Criar Nova Playlist</span>
          </button>
          <button className="btn-done" onClick={onClose}>
            Concluído
          </button>
        </div>
      </div>
    </div>
  );
}
