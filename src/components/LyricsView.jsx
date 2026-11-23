import React, { useEffect, useRef, useState, useMemo } from 'react';
import { 
  X, 
  Clock, 
  Upload, 
  Sparkles, 
  RotateCcw, 
  Plus, 
  Minus, 
  FileText,
  Download,
  Search,
  Loader2,
  Mic2,
  Tv,
  Check,
  Type
} from 'lucide-react';
import { parseLrc, getActiveLyricIndex, formatTime } from '../utils/lrcParser';
import { fetchOnlineLyrics, downloadLrcFile } from '../utils/lyricsApi';

export default function LyricsView({
  currentTrack,
  currentTime,
  onSeek,
  onClose,
  onUpdateTrackLyrics
}) {
  const containerRef = useRef(null);
  const activeLineRef = useRef(null);
  const [offset, setOffset] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [customLrcText, setCustomLrcText] = useState('');
  const [isFetchingOnline, setIsFetchingOnline] = useState(false);
  const [fetchStatusMsg, setFetchStatusMsg] = useState(null);
  const [karaokeMode, setKaraokeMode] = useState(false); // 'list' ou 'stage'
  const [fontSizeLevel, setFontSizeLevel] = useState(1); // 0 = normal, 1 = grande, 2 = enorme (karaoke)

  // Parser memoizado das linhas da letra
  const parsedLyrics = useMemo(() => {
    if (!currentTrack || !currentTrack.lyricsLrc) return [];
    return parseLrc(currentTrack.lyricsLrc);
  }, [currentTrack?.lyricsLrc]);

  // Identifica a linha ativa no segundo atual
  const activeIndex = useMemo(() => {
    return getActiveLyricIndex(parsedLyrics, currentTime, offset);
  }, [parsedLyrics, currentTime, offset]);

  // Linha atual e próxima linha para o Modo Palco Karaoke
  const currentLine = parsedLyrics[activeIndex] || null;
  const nextLine = parsedLyrics[activeIndex + 1] || null;

  // Auto-busca online se a música não tiver letra
  useEffect(() => {
    if (currentTrack && !currentTrack.lyricsLrc && !isFetchingOnline) {
      handleAutoFetchLyrics();
    }
  }, [currentTrack?.id]);

  // Rola suavemente para a linha ativa na lista APENAS no container interno (sem rolar a janela ou o cabeçalho)
  useEffect(() => {
    if (activeLineRef.current && containerRef.current && !isEditing && !karaokeMode) {
      const container = containerRef.current;
      const activeLine = activeLineRef.current;

      const lineTop = activeLine.offsetTop;
      const lineHeight = activeLine.offsetHeight;
      const containerHeight = container.clientHeight;

      const targetScroll = lineTop - (containerHeight / 2) + (lineHeight / 2);

      container.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: 'smooth'
      });
    }
  }, [activeIndex, isEditing, karaokeMode]);

  const handleAdjustOffset = (delta) => {
    setOffset((prev) => parseFloat((prev + delta).toFixed(2)));
  };

  const handleAutoFetchLyrics = async () => {
    if (!currentTrack) return;
    setIsFetchingOnline(true);
    setFetchStatusMsg('Buscando letra sincronizada na nuvem...');

    const result = await fetchOnlineLyrics(currentTrack.title, currentTrack.artist, currentTrack.duration);
    setIsFetchingOnline(false);

    if (result && result.syncedLyrics) {
      onUpdateTrackLyrics(currentTrack.id, result.syncedLyrics);
      setFetchStatusMsg('✓ Letra sincronizada encontrada e aplicada!');
      setTimeout(() => setFetchStatusMsg(null), 3500);
    } else {
      setFetchStatusMsg('Letra sincronizada não encontrada online.');
      setTimeout(() => setFetchStatusMsg(null), 3000);
    }
  };

  const handleDownloadLrc = () => {
    if (currentTrack && currentTrack.lyricsLrc) {
      downloadLrcFile(currentTrack.title, currentTrack.artist, currentTrack.lyricsLrc);
    }
  };

  const handleSaveCustomLyrics = () => {
    if (onUpdateTrackLyrics && currentTrack) {
      onUpdateTrackLyrics(currentTrack.id, customLrcText);
      setIsEditing(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result;
        if (typeof text === 'string') {
          setCustomLrcText(text);
          if (onUpdateTrackLyrics && currentTrack) {
            onUpdateTrackLyrics(currentTrack.id, text);
            setIsEditing(false);
          }
        }
      };
      reader.readAsText(file);
    }
  };

  if (!currentTrack) return null;

  return (
    <div className={`lyrics-overlay ${karaokeMode ? 'karaoke-stage-active' : ''}`}>
      {/* Background ambient glow */}
      <div 
        className="lyrics-ambient-bg" 
        style={{ backgroundImage: `url(${currentTrack.cover})` }}
      />
      <div className="lyrics-backdrop-mask" />

      {/* Top Header */}
      <header className="lyrics-header">
        <div className="lyrics-track-meta">
          <img 
            src={currentTrack.cover} 
            alt={currentTrack.title} 
            className="lyrics-cover-mini" 
          />
          <div>
            <div className="lyrics-title-row">
              <h2 className="lyrics-title">{currentTrack.title}</h2>
              {karaokeMode && (
                <span className="karaoke-live-badge">
                  <Mic2 size={13} /> PALCO KARAOKE
                </span>
              )}
            </div>
            <p className="lyrics-artist">{currentTrack.artist}</p>
          </div>
        </div>

        {/* Status notification */}
        {fetchStatusMsg && (
          <div className="lyrics-status-badge">
            {isFetchingOnline ? (
              <Loader2 size={14} className="spin-icon" />
            ) : (
              <Check size={14} />
            )}
            <span>{fetchStatusMsg}</span>
          </div>
        )}

        {/* Actions Bar */}
        <div className="lyrics-top-actions">
          {/* Sincronia de Tempo */}
          {parsedLyrics.length > 0 && (
            <div className="sync-calibration-bar">
              <span className="sync-label">
                <Clock size={14} /> {offset > 0 ? `+${offset}s` : `${offset}s`}
              </span>
              <button 
                className="sync-step-btn" 
                onClick={() => handleAdjustOffset(-0.5)}
                title="Atrasar letra em 0.5s"
              >
                <Minus size={13} /> 0.5s
              </button>
              <button 
                className="sync-step-btn" 
                onClick={() => handleAdjustOffset(0.5)}
                title="Adiantar letra em 0.5s"
              >
                <Plus size={13} /> 0.5s
              </button>
              {offset !== 0 && (
                <button 
                  className="sync-reset-btn" 
                  onClick={() => setOffset(0)}
                  title="Restaurar sincronia original"
                >
                  <RotateCcw size={13} />
                </button>
              )}
            </div>
          )}

          {/* Toggle Modo Palco Karaoke */}
          <button
            className={`btn-karaoke-toggle ${karaokeMode ? 'active' : ''}`}
            onClick={() => setKaraokeMode(!karaokeMode)}
            title={karaokeMode ? 'Voltar para lista de letras' : 'Ativar Modo Palco Karaoke'}
          >
            <Mic2 size={16} />
            <span>{karaokeMode ? 'Ver Lista' : 'Modo Palco'}</span>
          </button>

          {/* Baixar Letras Online */}
          <button
            className="btn-fetch-online"
            onClick={handleAutoFetchLyrics}
            disabled={isFetchingOnline}
            title="Buscar letra sincronizada (.lrc) na nuvem"
          >
            {isFetchingOnline ? (
              <Loader2 size={15} className="spin-icon" />
            ) : (
              <Search size={15} />
            )}
            <span>Baixar Letra Online</span>
          </button>

          {/* Salvar / Exportar Arquivo .LRC para o PC */}
          {parsedLyrics.length > 0 && (
            <button
              className="btn-download-lrc"
              onClick={handleDownloadLrc}
              title="Baixar arquivo .lrc para o seu computador"
            >
              <Download size={15} />
              <span>Salvar .lrc</span>
            </button>
          )}

          {/* Ajustar Tamanho da Fonte */}
          <button
            className="btn-font-size"
            onClick={() => setFontSizeLevel((prev) => (prev + 1) % 3)}
            title="Alternar tamanho da letra"
          >
            <Type size={16} />
          </button>

          {/* Editar Letra */}
          <button 
            className="btn-edit-lyrics"
            onClick={() => {
              setCustomLrcText(currentTrack.lyricsLrc || '');
              setIsEditing(!isEditing);
            }}
            title="Editar ou colar código .lrc"
          >
            <FileText size={15} />
          </button>

          {/* Fechar */}
          <button 
            className="close-lyrics-btn" 
            onClick={onClose}
            title="Fechar letras (Esc)"
          >
            <X size={24} />
          </button>
        </div>
      </header>

      {/* Main Lyrics Area */}
      <div 
        className={`lyrics-content-area font-level-${fontSizeLevel}`} 
        ref={containerRef}
      >
        {isEditing ? (
          /* Editor Mode */
          <div className="lyrics-editor-panel">
            <h3>Editor de Letras Sincronizadas (.LRC)</h3>
            <p className="editor-tip">
              Cole abaixo as linhas com timestamps no formato <code>[mm:ss.xx] Letra aqui</code> ou importe um arquivo .lrc do seu computador.
            </p>
            <textarea
              className="lyrics-textarea"
              value={customLrcText}
              onChange={(e) => setCustomLrcText(e.target.value)}
              placeholder="[00:12.50] Primeira estrofe da música&#10;[00:16.80] Segunda estrofe sincronizada..."
              rows={14}
            />
            <div className="editor-buttons-row">
              <label className="btn-upload-file">
                <Upload size={16} /> Importar Arquivo .lrc
                <input 
                  type="file" 
                  accept=".lrc,.txt" 
                  style={{ display: 'none' }} 
                  onChange={handleFileUpload} 
                />
              </label>
              <button className="btn-save-lyrics" onClick={handleSaveCustomLyrics}>
                <Sparkles size={16} /> Salvar e Sincronizar
              </button>
            </div>
          </div>
        ) : karaokeMode && parsedLyrics.length > 0 ? (
          /* 🎤 MODO PALCO KARAOKE FULLSCREEN */
          <div className="karaoke-stage-view">
            <div className="karaoke-stage-mic-glow">
              <Mic2 size={36} className="stage-mic-icon pulse" />
            </div>

            {/* Current Singing Line */}
            <div className="karaoke-current-block">
              {currentLine ? (
                <p className="karaoke-active-verse" onClick={() => onSeek(currentLine.time - offset)}>
                  {currentLine.text}
                </p>
              ) : (
                <p className="karaoke-intro-cue">♪ [Introdução Instrumental] ♪</p>
              )}
            </div>

            {/* Next Line Preview */}
            <div className="karaoke-next-block">
              <span className="next-verse-label">A Seguir:</span>
              <p className="karaoke-next-verse">
                {nextLine ? nextLine.text : '♪ ... ♪'}
              </p>
            </div>

            {/* Timing hint */}
            <div className="karaoke-timing-indicator">
              <span>Tempo: {formatTime(currentTime)}</span>
              {currentLine && (
                <span>• Início da estrofe: {formatTime(currentLine.time)}</span>
              )}
            </div>
          </div>
        ) : parsedLyrics.length > 0 ? (
          /* 📜 MODO LISTA DE LETRAS SINCRONIZADAS */
          <div className="lyrics-lines-list">
            {parsedLyrics.map((item, index) => {
              const isActive = index === activeIndex;
              const isPast = index < activeIndex;
              return (
                <p
                  key={index}
                  ref={isActive ? activeLineRef : null}
                  className={`lyric-line ${isActive ? 'active-line' : ''} ${isPast ? 'past-line' : ''}`}
                  onClick={() => onSeek(item.time - offset)}
                  title={`Clique para pular para ${formatTime(item.time)}`}
                >
                  <span className="line-timestamp">{formatTime(item.time)}</span>
                  <span className="line-text">{item.text}</span>
                </p>
              );
            })}
          </div>
        ) : (
          /* 🌐 EMPTY STATE / BUSCA AUTOMÁTICA */
          <div className="empty-lyrics-prompt">
            <Sparkles size={48} className="empty-sparkle-icon" />
            <h3>Nenhuma letra sincronizada carregada para esta música</h3>
            <p>
              Você pode baixar a letra sincronizada automaticamente com 1 clique ou importar um arquivo .lrc do seu computador.
            </p>
            <div className="empty-actions">
              <button 
                className="btn-fetch-primary"
                onClick={handleAutoFetchLyrics}
                disabled={isFetchingOnline}
              >
                {isFetchingOnline ? (
                  <Loader2 size={18} className="spin-icon" />
                ) : (
                  <Search size={18} />
                )}
                <span>Baixar Letra Sincronizada Online</span>
              </button>

              <label className="btn-upload-file">
                <Upload size={18} /> Importar arquivo .lrc
                <input 
                  type="file" 
                  accept=".lrc,.txt" 
                  style={{ display: 'none' }} 
                  onChange={handleFileUpload} 
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
