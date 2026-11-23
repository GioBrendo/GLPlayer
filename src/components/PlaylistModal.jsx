import React, { useState, useEffect } from 'react';
import { X, Sparkles, Image, Music, Link2, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import YoutubeIcon from './YoutubeIcon';

export default function PlaylistModal({
  isOpen,
  playlistToEdit = null,
  initialTab = 'manual', // 'manual' | 'youtube' | 'spotify'
  onClose,
  onSave,
  onImportSpotify,
  onImportYouTube
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [name, setName] = useState(playlistToEdit ? playlistToEdit.name : '');
  const [description, setDescription] = useState(playlistToEdit ? playlistToEdit.description : '');
  const [cover, setCover] = useState(
    playlistToEdit?.cover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop'
  );

  // Spotify Import State
  const [spotifyUrl, setSpotifyUrl] = useState('');
  const [isSpotifyImporting, setIsSpotifyImporting] = useState(false);
  const [spotifyError, setSpotifyError] = useState(null);
  const [spotifySuccess, setSpotifySuccess] = useState(null);

  // YouTube Import State
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [isYtImporting, setIsYtImporting] = useState(false);
  const [ytError, setYtError] = useState(null);
  const [ytSuccess, setYtSuccess] = useState(null);

  // Sincroniza se abrir para editar
  useEffect(() => {
    if (playlistToEdit) {
      setName(playlistToEdit.name);
      setDescription(playlistToEdit.description || '');
      setCover(playlistToEdit.cover || '');
      setActiveTab('manual');
    } else {
      setName('');
      setDescription('');
      setCover('https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop');
      setActiveTab(initialTab);
    }
    setSpotifyError(null);
    setSpotifySuccess(null);
    setYtError(null);
    setYtSuccess(null);
  }, [playlistToEdit, initialTab, isOpen]);

  const presets = [
    { label: 'Neon Vibes', url: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop' },
    { label: 'Lo-Fi Chill', url: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=600&auto=format&fit=crop' },
    { label: 'Karaoke Pop', url: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=600&auto=format&fit=crop' },
    { label: 'Rock & Guitars', url: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=600&auto=format&fit=crop' },
    { label: 'Acoustic / Indie', url: 'https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=600&auto=format&fit=crop' }
  ];

  if (!isOpen) return null;

  const handleSubmitManual = (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSave({
      id: playlistToEdit?.id || 'pl-custom-' + Date.now(),
      name: name.trim(),
      description: description.trim() || 'Minha playlist personalizada',
      cover: cover || presets[0].url,
      trackIds: playlistToEdit?.trackIds || []
    });

    onClose();
  };

  const handleSpotifyImportSubmit = async (e) => {
    e.preventDefault();
    if (!spotifyUrl.trim()) return;

    setIsSpotifyImporting(true);
    setSpotifyError(null);
    setSpotifySuccess(null);

    try {
      const res = await fetch(`/api/spotify-import?url=${encodeURIComponent(spotifyUrl.trim())}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Não foi possível importar este link do Spotify.');
      }

      setSpotifySuccess(`Sucesso! Importadas ${data.playlist.tracks.length} músicas.`);
      
      setTimeout(() => {
        onImportSpotify(data.playlist);
        setIsSpotifyImporting(false);
        setSpotifyUrl('');
        onClose();
      }, 700);
    } catch (err) {
      setSpotifyError(err.message);
      setIsSpotifyImporting(false);
    }
  };

  const handleYouTubeImportSubmit = async (e) => {
    e.preventDefault();
    if (!youtubeUrl.trim()) return;

    setIsYtImporting(true);
    setYtError(null);
    setYtSuccess(null);

    try {
      const res = await fetch(`/api/youtube-import?url=${encodeURIComponent(youtubeUrl.trim())}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Não foi possível importar este link do YouTube.');
      }

      if (data.type === 'playlist') {
        setYtSuccess(`Playlist "${data.playlist.name}" importada com ${data.playlist.tracks.length} músicas!`);
        setTimeout(() => {
          onImportYouTube(data);
          setIsYtImporting(false);
          setYoutubeUrl('');
          onClose();
        }, 700);
      } else if (data.type === 'track') {
        setYtSuccess(`Música "${data.track.title}" pronta para tocar!`);
        setTimeout(() => {
          onImportYouTube(data);
          setIsYtImporting(false);
          setYoutubeUrl('');
          onClose();
        }, 700);
      }
    } catch (err) {
      setYtError(err.message);
      setIsYtImporting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-title">
            <Music size={22} className="text-accent" />
            <h3>{playlistToEdit ? 'Editar Playlist' : 'Adicionar / Importar Playlist'}</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Tab Selector (apenas se for nova playlist) */}
        {!playlistToEdit && (
          <div className="modal-tabs-header">
            <button
              className={`modal-tab-btn youtube-tab ${activeTab === 'youtube' ? 'active' : ''}`}
              onClick={() => setActiveTab('youtube')}
            >
              <YoutubeIcon size={18} />
              <span>YouTube</span>
            </button>
            <button
              className={`modal-tab-btn spotify-tab ${activeTab === 'spotify' ? 'active' : ''}`}
              onClick={() => setActiveTab('spotify')}
            >
              <Link2 size={16} />
              <span>Spotify</span>
            </button>
            <button
              className={`modal-tab-btn ${activeTab === 'manual' ? 'active' : ''}`}
              onClick={() => setActiveTab('manual')}
            >
              <Sparkles size={16} />
              <span>Manual</span>
            </button>
          </div>
        )}

        {activeTab === 'manual' && (
          /* Aba 1: Criação / Edição Manual */
          <form onSubmit={handleSubmitManual} className="modal-form">
            <div className="modal-body-layout">
              {/* Preview Cover */}
              <div className="modal-cover-preview">
                <img 
                  src={cover} 
                  alt="Capa da Playlist" 
                  className="cover-img-preview"
                  onError={(e) => {
                    e.currentTarget.src = presets[0].url;
                  }}
                />
                <span className="cover-preview-label">Capa da Playlist</span>
              </div>

              {/* Inputs */}
              <div className="modal-inputs-col">
                <div className="form-group">
                  <label>Nome da Playlist *</label>
                  <input
                    type="text"
                    placeholder="Ex: Minhas Favoritas, Treino..."
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Descrição (opcional)</label>
                  <textarea
                    placeholder="Dê uma breve descrição para esta playlist..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                  />
                </div>

                <div className="form-group">
                  <label>URL da Imagem da Capa</label>
                  <input
                    type="url"
                    placeholder="https://exemplo.com/imagem.jpg"
                    value={cover}
                    onChange={(e) => setCover(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Preset Covers */}
            <div className="preset-covers-row">
              <span className="presets-label">Ou escolha um tema pronto:</span>
              <div className="presets-list">
                {presets.map((p) => (
                  <button
                    type="button"
                    key={p.label}
                    className={`preset-btn ${cover === p.url ? 'active' : ''}`}
                    onClick={() => setCover(p.url)}
                  >
                    <img src={p.url} alt={p.label} />
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Footer Actions */}
            <div className="modal-footer">
              <button type="button" className="btn-cancel" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={!name.trim()}>
                <Sparkles size={16} />
                {playlistToEdit ? 'Salvar Alterações' : 'Criar Playlist'}
              </button>
            </div>
          </form>
        )}

        {activeTab === 'youtube' && (
          /* Aba 2: Importação do YouTube (Playlist ou Música Avulsa) */
          <form onSubmit={handleYouTubeImportSubmit} className="modal-form youtube-import-form">
            <div className="youtube-import-intro">
              <div className="youtube-badge-large">
                <YoutubeIcon size={32} />
              </div>
              <h4>Cole o link de uma Playlist, Mix ou Música do YouTube</h4>
              <p>
                O app extrai automaticamente os nomes, canal/artista, capa oficial em HD e áudio completo sem cortes.
              </p>
            </div>

            <div className="form-group">
              <label>Link do YouTube (Playlist ou Música)</label>
              <div className="youtube-input-wrap">
                <input
                  type="text"
                  placeholder="https://youtube.com/playlist?list=... ou https://youtu.be/..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <span className="form-helper-text">
                Formatos aceitos: <code>https://youtube.com/playlist?list=[ID]</code>, <code>https://youtu.be/[ID]</code> ou links de Mix do YouTube.
              </span>
            </div>

            {/* Mensagens de Erro ou Sucesso */}
            {ytError && (
              <div className="import-alert error">
                <AlertCircle size={18} />
                <span>{ytError}</span>
              </div>
            )}

            {ytSuccess && (
              <div className="import-alert success">
                <CheckCircle2 size={18} />
                <span>{ytSuccess}</span>
              </div>
            )}

            <div className="modal-footer">
              <button type="button" className="btn-cancel" onClick={onClose}>
                Cancelar
              </button>
              <button 
                type="submit" 
                className="btn-youtube-import" 
                disabled={isYtImporting || !youtubeUrl.trim()}
              >
                {isYtImporting ? (
                  <>
                    <Loader2 size={16} className="spin-icon" />
                    <span>Importando do YouTube...</span>
                  </>
                ) : (
                  <>
                    <YoutubeIcon size={18} />
                    <span>Importar do YouTube</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {activeTab === 'spotify' && (
          /* Aba 3: Importação de Link do Spotify (Álbum ou Playlist) */
          <form onSubmit={handleSpotifyImportSubmit} className="modal-form spotify-import-form">
            <div className="spotify-import-intro">
              <div className="spotify-badge-large">
                <Link2 size={24} />
              </div>
              <h4>Cole o link do Álbum ou Playlist do Spotify</h4>
              <p>
                O app irá extrair todas as músicas, nomes, artistas e capa oficial, e adicionará a faixa inteira para tocar completa!
              </p>
            </div>

            <div className="form-group">
              <label>Link do Spotify (Álbum ou Playlist)</label>
              <div className="spotify-input-wrap">
                <input
                  type="text"
                  placeholder="https://open.spotify.com/album/..."
                  value={spotifyUrl}
                  onChange={(e) => setSpotifyUrl(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <span className="form-helper-text">
                Formatos aceitos: <code>https://open.spotify.com/album/[ID]</code> ou <code>https://open.spotify.com/playlist/[ID]</code>
              </span>
            </div>

            {/* Mensagens de Erro ou Sucesso */}
            {spotifyError && (
              <div className="import-alert error">
                <AlertCircle size={18} />
                <span>{spotifyError}</span>
              </div>
            )}

            {spotifySuccess && (
              <div className="import-alert success">
                <CheckCircle2 size={18} />
                <span>{spotifySuccess}</span>
              </div>
            )}

            <div className="modal-footer">
              <button type="button" className="btn-cancel" onClick={onClose}>
                Cancelar
              </button>
              <button 
                type="submit" 
                className="btn-spotify-import" 
                disabled={isSpotifyImporting || !spotifyUrl.trim()}
              >
                {isSpotifyImporting ? (
                  <>
                    <Loader2 size={16} className="spin-icon" />
                    <span>Importando faixas...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    <span>Importar do Spotify</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
