import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
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
  Check,
  AlertCircle,
  Type,
  SlidersHorizontal
} from 'lucide-react';
import { parseLrc, parsePlainLyrics, getActiveLyricIndex, formatTime } from '../utils/lrcParser.js';
import {
  fetchOnlineLyrics,
  searchOnlineLyricsCandidates,
  extractYoutubeId,
  downloadLrcFile
} from '../utils/lyricsApi.js';
import { parseYouTubeTrackMetadata } from '../utils/youtubeMetadata.js';

// Faixas já pesquisadas sem sucesso definitivo nesta sessão (evita repetir a busca a cada abertura)
const lyricsNotFoundIds = new Set();

function formatCandidateSourceLabel(candidate) {
  if (!candidate) return '';
  if (candidate.source === 'youtube-subtitles') return 'Legenda YouTube';
  if (candidate.source === 'youtube-auto-captions') return 'Legenda Auto YouTube';
  if (candidate.isSynced) return 'Sincronizada · LRCLIB';
  return 'Texto · LRCLIB';
}

function getManualPrefill(track) {
  if (!track) return { title: '', artist: '' };
  const parsed = parseYouTubeTrackMetadata(track.title || '', track.artist || '');
  return {
    title: parsed.coreTitle || parsed.displayTitle || track.title || '',
    artist: parsed.cleanArtist || ''
  };
}

export default function LyricsView({
  currentTrack,
  currentTime,
  audioDuration = 0,
  onSeek,
  onClose,
  onUpdateTrackLyrics,
  onUpdateTrackMeta
}) {
  const containerRef = useRef(null);
  const activeLineRef = useRef(null);
  const [offset, setOffset] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [customLrcText, setCustomLrcText] = useState('');
  const [isFetchingOnline, setIsFetchingOnline] = useState(false);
  const [fetchStatus, setFetchStatus] = useState(null); // { text, tone: 'loading' | 'success' | 'warning' }
  const [karaokeMode, setKaraokeMode] = useState(false); // 'list' ou 'stage'
  const [fontSizeLevel, setFontSizeLevel] = useState(1); // 0 = normal, 1 = grande, 2 = enorme (karaoke)

  // Busca / refinamento manual de letras
  const [isManualSearchOpen, setIsManualSearchOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState(() => getManualPrefill(currentTrack).title);
  const [manualArtist, setManualArtist] = useState(() => getManualPrefill(currentTrack).artist);
  const [isSearchingManual, setIsSearchingManual] = useState(false);
  const [manualCandidates, setManualCandidates] = useState([]);
  const [manualSearchStatus, setManualSearchStatus] = useState(null); // 'found' | 'not_found' | 'rate_limited' | 'error' | null

  // Parser memoizado das linhas da letra (sincronizada ou texto simples)
  const lyricsLrc = currentTrack?.lyricsLrc || '';
  const parsedLyrics = useMemo(() => parseLrc(lyricsLrc), [lyricsLrc]);
  const isSynced = parsedLyrics.length > 0;
  const plainLines = useMemo(() => (isSynced ? [] : parsePlainLyrics(lyricsLrc)), [isSynced, lyricsLrc]);
  const hasAnyLyrics = isSynced || plainLines.length > 0;

  // Ao trocar de faixa: zera estados locais da visualização anterior no render
  const [prevTrackId, setPrevTrackId] = useState(currentTrack?.id);
  if (prevTrackId !== currentTrack?.id) {
    setPrevTrackId(currentTrack?.id);
    setOffset(0);
    setIsFetchingOnline(false);
    setFetchStatus(null);
    setIsManualSearchOpen(false);
    setManualCandidates([]);
    setManualSearchStatus(null);
    setIsSearchingManual(false);
    const prefill = getManualPrefill(currentTrack);
    setManualTitle(prefill.title);
    setManualArtist(prefill.artist);
  }

  // Identifica a linha ativa no segundo atual (apenas quando há timestamps)
  const activeIndex = useMemo(() => {
    return isSynced ? getActiveLyricIndex(parsedLyrics, currentTime, offset) : -1;
  }, [isSynced, parsedLyrics, currentTime, offset]);

  // Linha atual e próxima linha para o Modo Palco Karaoke
  const currentLine = isSynced ? parsedLyrics[activeIndex] || null : null;
  const nextLine = isSynced ? parsedLyrics[activeIndex + 1] || null : null;

  const fetchSeqRef = useRef(0);
  const manualSeqRef = useRef(0);
  const statusTimerRef = useRef(null);
  const currentTrackRef = useRef(currentTrack);
  const audioDurationRef = useRef(audioDuration);
  const isManualSearchOpenRef = useRef(isManualSearchOpen);

  useLayoutEffect(() => {
    currentTrackRef.current = currentTrack;
    audioDurationRef.current = audioDuration;
    isManualSearchOpenRef.current = isManualSearchOpen;
  });

  const showStatus = useCallback((text, tone = 'loading', ms = 0) => {
    clearTimeout(statusTimerRef.current);
    setFetchStatus({ text, tone });
    if (ms > 0) {
      statusTimerRef.current = setTimeout(() => setFetchStatus(null), ms);
    }
  }, []);

  useEffect(() => () => clearTimeout(statusTimerRef.current), []);

  const getLookupOptions = useCallback((track) => {
    const liveDur = Number(audioDurationRef.current);
    const trackDur = Number(track?.duration);
    const effectiveDuration =
      Number.isFinite(liveDur) && liveDur > 0
        ? Math.round(liveDur)
        : Number.isFinite(trackDur) && trackDur > 0
          ? Math.round(trackDur)
          : 0;
    const durationUnknown = !(liveDur > 0) && (!trackDur || trackDur === 210);
    const youtubeId = extractYoutubeId(track);
    return { effectiveDuration, durationUnknown, youtubeId };
  }, []);

  const fetchLyricsFor = useCallback(async (track, { explicitSeq = null } = {}) => {
    if (!track) return;
    const seq = explicitSeq ?? ++fetchSeqRef.current;
    setIsFetchingOnline(true);
    showStatus('Buscando letra online...', 'loading');

    const { effectiveDuration, durationUnknown, youtubeId } = getLookupOptions(track);
    const result = await fetchOnlineLyrics(track.title, track.artist, effectiveDuration, {
      youtubeId,
      durationUnknown
    });

    const isLatest = seq === fetchSeqRef.current && currentTrackRef.current?.id === track.id;

    if (result.status === 'found' && result.lrc) {
      lyricsNotFoundIds.delete(track.id);
      onUpdateTrackLyrics(track.id, result.lrc);
      if (result.resolvedMeta?.duration > 0) {
        onUpdateTrackMeta?.(track.id, { duration: result.resolvedMeta.duration });
      }
    } else if (result.status === 'not_found') {
      // Erros transitórios (rate_limited / error) nunca bloqueiam novas tentativas
      lyricsNotFoundIds.add(track.id);
    }

    if (!isLatest) return;

    setIsFetchingOnline(false);

    if (Array.isArray(result.candidates) && result.candidates.length > 0 && !isManualSearchOpenRef.current) {
      setManualCandidates(result.candidates);
      setManualSearchStatus('found');
    }
    if (!isManualSearchOpenRef.current && result.resolvedMeta?.title && (!track.title || result.resolvedMeta.coreTitle)) {
      const nextTitle = result.resolvedMeta.coreTitle || result.resolvedMeta.title;
      if (nextTitle) setManualTitle(nextTitle);
      if (result.resolvedMeta.artist) setManualArtist(result.resolvedMeta.artist);
    }

    if (result.status === 'found' && result.lrc) {
      if (result.source === 'youtube-subtitles') {
        showStatus('✓ Legenda sincronizada do YouTube aplicada!', 'success', 3500);
      } else if (result.source === 'youtube-auto-captions') {
        showStatus('✓ Legenda automática do YouTube aplicada!', 'success', 3500);
      } else if (result.isSynced) {
        showStatus('✓ Letra sincronizada encontrada e aplicada!', 'success', 3500);
      } else {
        showStatus('✓ Letra encontrada (sem sincronia de tempo).', 'success', 4000);
      }
    } else if (result.status === 'rate_limited') {
      showStatus('Servidor de letras ocupado. Tente novamente em instantes.', 'warning', 4500);
    } else if (result.status === 'error') {
      showStatus('Erro de conexão ao buscar letra. Tente novamente.', 'warning', 4000);
    } else {
      showStatus('Nenhuma letra encontrada automaticamente. Use "Refinar Busca".', 'warning', 4500);
    }
  }, [getLookupOptions, onUpdateTrackLyrics, onUpdateTrackMeta, showStatus]);

  const handleAutoFetchLyrics = () => {
    if (!currentTrack) return;
    lyricsNotFoundIds.delete(currentTrack.id);
    fetchLyricsFor(currentTrack);
  };

  // Ao trocar de música: busca automaticamente se ainda não houver letra e não tiver falhado antes
  useEffect(() => {
    const track = currentTrackRef.current;
    const seq = ++fetchSeqRef.current;
    if (!track || track.lyricsLrc || lyricsNotFoundIds.has(track.id)) {
      return undefined;
    }

    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled && seq === fetchSeqRef.current) {
        fetchLyricsFor(track, { explicitSeq: seq });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id, fetchLyricsFor]);

  // Rola suavemente para a linha ativa na lista APENAS no container interno
  useEffect(() => {
    if (activeLineRef.current && containerRef.current && !isEditing && !karaokeMode && isSynced) {
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
  }, [activeIndex, isEditing, karaokeMode, isSynced]);

  const handleManualSearchSubmit = async (e) => {
    e?.preventDefault?.();
    if (!currentTrack) return;
    const qTitle = manualTitle.trim();
    const qArtist = manualArtist.trim();
    const youtubeId = extractYoutubeId(currentTrack);
    if (!qTitle && !youtubeId) return;

    const seq = ++manualSeqRef.current;
    setIsSearchingManual(true);
    setManualSearchStatus(null);

    const { effectiveDuration, durationUnknown } = getLookupOptions(currentTrack);
    const result = await searchOnlineLyricsCandidates(qTitle, qArtist, effectiveDuration, {
      youtubeId,
      durationUnknown
    });

    if (seq !== manualSeqRef.current || currentTrackRef.current?.id !== currentTrack.id) return;

    setIsSearchingManual(false);
    setManualCandidates(result.candidates || []);
    setManualSearchStatus(result.status);
  };

  const handleSelectCandidate = (candidate) => {
    if (!currentTrack || !candidate) return;
    const text = candidate.isSynced ? candidate.syncedLyrics : candidate.plainLyrics;
    if (!text) return;

    lyricsNotFoundIds.delete(currentTrack.id);
    onUpdateTrackLyrics(currentTrack.id, text);
    if (candidate.duration > 0) {
      onUpdateTrackMeta?.(currentTrack.id, { duration: candidate.duration });
    }
    setIsManualSearchOpen(false);
    setIsEditing(false);
    showStatus(
      candidate.isSynced ? '✓ Letra sincronizada aplicada!' : '✓ Letra em texto simples aplicada!',
      'success',
      3500
    );
  };

  const handleToggleManualSearch = () => {
    setIsEditing(false);
    setIsManualSearchOpen((prev) => !prev);
  };

  const handleAdjustOffset = (delta) => {
    setOffset((prev) => parseFloat((prev + delta).toFixed(2)));
  };

  const handleDownloadLrc = () => {
    if (currentTrack && currentTrack.lyricsLrc) {
      downloadLrcFile(currentTrack.title, currentTrack.artist, currentTrack.lyricsLrc);
    }
  };

  const handleSaveCustomLyrics = () => {
    if (onUpdateTrackLyrics && currentTrack) {
      lyricsNotFoundIds.delete(currentTrack.id);
      onUpdateTrackLyrics(currentTrack.id, customLrcText);
      setIsEditing(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite importar o mesmo arquivo de novo
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result;
        if (typeof text === 'string') {
          setCustomLrcText(text);
          if (onUpdateTrackLyrics && currentTrack) {
            lyricsNotFoundIds.delete(currentTrack.id);
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
    <div className={`lyrics-overlay ${karaokeMode && isSynced ? 'karaoke-stage-active' : ''}`}>
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
              {karaokeMode && isSynced && (
                <span className="karaoke-live-badge">
                  <Mic2 size={13} /> PALCO KARAOKE
                </span>
              )}
              {hasAnyLyrics && !isSynced && (
                <span className="lyrics-unsynced-badge" title="Esta letra não possui timestamps [mm:ss]">
                  Letra sem sincronia
                </span>
              )}
            </div>
            <p className="lyrics-artist">{currentTrack.artist}</p>
          </div>
        </div>

        {/* Status notification */}
        {fetchStatus && (
          <div className={`lyrics-status-badge tone-${fetchStatus.tone}`}>
            {isFetchingOnline || fetchStatus.tone === 'loading' ? (
              <Loader2 size={14} className="spin-icon" />
            ) : fetchStatus.tone === 'success' ? (
              <Check size={14} />
            ) : (
              <AlertCircle size={14} />
            )}
            <span>{fetchStatus.text}</span>
          </div>
        )}

        {/* Actions Bar */}
        <div className="lyrics-top-actions">
          {/* Sincronia de Tempo (apenas quando sincronizada) */}
          {isSynced && (
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
            className={`btn-karaoke-toggle ${karaokeMode && isSynced ? 'active' : ''}`}
            onClick={() => setKaraokeMode(!karaokeMode)}
            disabled={!isSynced}
            title={
              !isSynced
                ? 'Modo Palco disponível apenas para letras sincronizadas (.lrc)'
                : karaokeMode
                  ? 'Voltar para lista de letras'
                  : 'Ativar Modo Palco Karaoke'
            }
          >
            <Mic2 size={16} />
            <span>{karaokeMode && isSynced ? 'Ver Lista' : 'Modo Palco'}</span>
          </button>

          {/* Baixar Letras Online */}
          <button
            className="btn-fetch-online"
            onClick={handleAutoFetchLyrics}
            disabled={isFetchingOnline}
            title="Buscar letra automaticamente na nuvem"
          >
            {isFetchingOnline ? (
              <Loader2 size={15} className="spin-icon" />
            ) : (
              <Search size={15} />
            )}
            <span>Baixar Letra Online</span>
          </button>

          {/* Buscar / Refinar manualmente */}
          <button
            className={`btn-refine-lyrics ${isManualSearchOpen ? 'active' : ''}`}
            onClick={handleToggleManualSearch}
            title="Editar título/artista e escolher versão da letra manualmente"
          >
            <SlidersHorizontal size={15} />
            <span>Refinar Busca</span>
          </button>

          {/* Salvar / Exportar Arquivo .LRC ou .TXT para o PC */}
          {hasAnyLyrics && (
            <button
              className="btn-download-lrc"
              onClick={handleDownloadLrc}
              title={isSynced ? 'Baixar arquivo .lrc para o seu computador' : 'Baixar arquivo .txt para o seu computador'}
            >
              <Download size={15} />
              <span>{isSynced ? 'Salvar .lrc' : 'Salvar .txt'}</span>
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
              setIsManualSearchOpen(false);
              setCustomLrcText(currentTrack.lyricsLrc || '');
              setIsEditing(!isEditing);
            }}
            title="Editar ou colar código .lrc / texto"
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
        {/* Painel de Busca / Refinamento Manual */}
        {isManualSearchOpen && !isEditing && (
          <div className="lyrics-manual-search-panel">
            <div className="manual-search-header">
              <div>
                <h3>Buscar / Refinar Letra Manualmente</h3>
                <p>Ajuste o nome da música ou artista para encontrar a letra ideal ou selecionar legendas do YouTube.</p>
              </div>
              <button
                type="button"
                className="manual-search-close"
                onClick={() => setIsManualSearchOpen(false)}
                title="Fechar busca manual"
              >
                <X size={18} />
              </button>
            </div>

            <form className="manual-search-form" onSubmit={handleManualSearchSubmit}>
              <div className="manual-search-fields">
                <label className="manual-field">
                  <span>Música</span>
                  <input
                    type="text"
                    value={manualTitle}
                    onChange={(e) => setManualTitle(e.target.value)}
                    placeholder="Ex: Yesterday"
                    autoFocus
                  />
                </label>
                <label className="manual-field">
                  <span>Artista</span>
                  <input
                    type="text"
                    value={manualArtist}
                    onChange={(e) => setManualArtist(e.target.value)}
                    placeholder="Ex: The Beatles"
                  />
                </label>
              </div>
              <button
                type="submit"
                className="btn-manual-search-submit"
                disabled={isSearchingManual || (!manualTitle.trim() && !extractYoutubeId(currentTrack))}
              >
                {isSearchingManual ? (
                  <>
                    <Loader2 size={15} className="spin-icon" />
                    <span>Buscando...</span>
                  </>
                ) : (
                  <>
                    <Search size={15} />
                    <span>Pesquisar</span>
                  </>
                )}
              </button>
            </form>

            {manualSearchStatus === 'rate_limited' && (
              <p className="manual-search-msg warning">
                Muitas consultas ao servidor de letras. Aguarde alguns segundos e clique em Pesquisar novamente.
              </p>
            )}
            {manualSearchStatus === 'error' && (
              <p className="manual-search-msg warning">
                Falha de rede ao consultar letras online. Tente novamente.
              </p>
            )}
            {manualSearchStatus === 'not_found' && manualCandidates.length === 0 && (
              <p className="manual-search-msg">
                Nenhum resultado encontrado para "{manualTitle}{manualArtist ? ` - ${manualArtist}` : ''}". Tente simplificar o nome.
              </p>
            )}

            {manualCandidates.length > 0 && (
              <div className="lyrics-candidates-list">
                {manualCandidates.map((cand) => (
                  <button
                    key={cand.id}
                    type="button"
                    className="lyrics-candidate-item"
                    onClick={() => handleSelectCandidate(cand)}
                  >
                    <div className="candidate-main-info">
                      <span className="candidate-title">{cand.trackName || manualTitle || currentTrack.title}</span>
                      <span className="candidate-meta">
                        {cand.artistName || 'Artista desconhecido'}
                        {cand.albumName ? ` • ${cand.albumName}` : ''}
                      </span>
                    </div>
                    <div className="candidate-badges">
                      <span
                        className={`candidate-source-pill ${
                          cand.source === 'youtube-subtitles' || cand.source === 'youtube-auto-captions'
                            ? 'is-youtube'
                            : cand.isSynced
                              ? 'is-synced'
                              : 'is-plain'
                        }`}
                      >
                        {formatCandidateSourceLabel(cand)}
                      </span>
                      {cand.duration > 0 && (
                        <span className="candidate-duration">{formatTime(cand.duration)}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {isEditing ? (
          /* Editor Mode */
          <div className="lyrics-editor-panel">
            <h3>Editor de Letras (.LRC ou Texto)</h3>
            <p className="editor-tip">
              Cole abaixo linhas sincronizadas no formato <code>[mm:ss.xx] Letra aqui</code>, letra em texto simples ou importe um arquivo .lrc/.txt do seu computador.
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
                <Upload size={16} /> Importar Arquivo .lrc / .txt
                <input
                  type="file"
                  accept=".lrc,.txt"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
              </label>
              <button className="btn-save-lyrics" onClick={handleSaveCustomLyrics}>
                <Sparkles size={16} /> Salvar Letra
              </button>
            </div>
          </div>
        ) : karaokeMode && isSynced ? (
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
        ) : isSynced ? (
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
        ) : plainLines.length > 0 ? (
          /* 📝 MODO LETRA EM TEXTO SIMPLES (SEM TIMESTAMPS) */
          <div className="plain-lyrics-container">
            <div className="plain-lyrics-notice">
              <span>Letra sem sincronia de tempo • Rolagem manual</span>
              <button
                type="button"
                className="plain-lyrics-refine-link"
                onClick={() => setIsManualSearchOpen(true)}
              >
                Buscar outra versão
              </button>
            </div>
            <div className="plain-lyrics-list">
              {plainLines.map((line, index) =>
                line === '' ? (
                  <div key={index} className="plain-lyric-spacer" />
                ) : (
                  <p key={index} className="plain-lyric-line">
                    {line}
                  </p>
                )
              )}
            </div>
          </div>
        ) : (
          /* 🌐 EMPTY STATE / BUSCA AUTOMÁTICA */
          <div className="empty-lyrics-prompt">
            <Sparkles size={48} className="empty-sparkle-icon" />
            <h3>Nenhuma letra carregada para esta música</h3>
            <p>
              Você pode baixar a letra automaticamente, refinar o título/artista manualmente ou importar um arquivo .lrc/.txt do seu computador.
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
                <span>Baixar Letra Online</span>
              </button>

              <button
                type="button"
                className="btn-upload-file"
                onClick={() => setIsManualSearchOpen(true)}
              >
                <SlidersHorizontal size={18} /> Buscar / Refinar manualmente
              </button>

              <label className="btn-upload-file">
                <Upload size={18} /> Importar .lrc / .txt
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
