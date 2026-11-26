import React, { useState } from 'react';
import { X, Users, Radio, Copy, Check, LogOut, Sparkles } from 'lucide-react';
import { loadString, saveString } from '../utils/storage';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I para não confundir

function generateRoomCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return 'JAM' + Array.from(bytes, (b) => ROOM_CODE_CHARS[b % ROOM_CODE_CHARS.length]).join('');
}

/** Aceita o código puro ou o link de convite inteiro (…?room=XYZ). */
function extractRoomCode(value) {
  const fromLink = value.match(/[?&]room=([A-Za-z0-9]+)/);
  const raw = fromLink ? fromLink[1] : value;
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

export default function JamModal({
  isOpen,
  activeRoomId,
  jamUsers = [],
  onClose,
  onJoinRoom,
  onLeaveRoom,
  onSendReaction
}) {
  // Convite recebido pelo link (?room=XYZ): já abre na aba "Entrar" com o código preenchido
  const [inviteCode] = useState(() => extractRoomCode(new URLSearchParams(window.location.search).get('room') || ''));
  const [tab, setTab] = useState(inviteCode ? 'join' : 'create'); // 'create' | 'join'
  const [roomCodeInput, setRoomCodeInput] = useState(inviteCode);
  const [usernameInput, setUsernameInput] = useState(
    () => loadString('username') || 'Amigo ' + Math.floor(Math.random() * 900 + 100)
  );
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const fallbackCopy = (text) => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      textArea.remove();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Falha ao copiar:', err);
    }
  };

  const handleCopyLink = () => {
    const inviteUrl = `${window.location.origin}/?room=${activeRoomId}`;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(inviteUrl).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {
        fallbackCopy(inviteUrl);
      });
    } else {
      fallbackCopy(inviteUrl);
    }
  };

  const cleanUsername = () => usernameInput.trim().slice(0, 32) || 'Amigo';

  const handleCreate = (e) => {
    e.preventDefault();
    const name = cleanUsername();
    saveString('username', name);
    onJoinRoom(generateRoomCode(), name);
  };

  const handleJoin = (e) => {
    e.preventDefault();
    const code = extractRoomCode(roomCodeInput);
    if (code.length < 3) return;
    const name = cleanUsername();
    saveString('username', name);
    onJoinRoom(code, name);
  };

  const reactions = ['❤️', '🔥', '🎉', '👏', '🎵', '⚡'];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card jam-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-header-title">
            <div className="jam-icon-badge">
              <Users size={22} />
            </div>
            <div>
              <h3>Ouvir Juntos (Jam)</h3>
              <p className="modal-subtitle">Sincronização de áudio em tempo real com amigos</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {activeRoomId ? (
          /* ==========================================================
             SALA ATIVA (CONECTADO)
             ========================================================== */
          <div className="jam-active-room-content">
            <div className="jam-status-banner">
              <span className="jam-pulse-dot" />
              <span>Sessão Sincronizada Ativa</span>
            </div>

            {/* Room Code & Copy */}
            <div className="room-code-display-box">
              <div className="code-text-group">
                <span className="code-label">CÓDIGO DA SALA:</span>
                <span className="code-value">{activeRoomId}</span>
              </div>
              <button 
                className={`btn-copy-invite ${copied ? 'copied' : ''}`}
                onClick={handleCopyLink}
                title="Copiar link de convite para enviar a um amigo"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                <span>{copied ? 'Copiado!' : 'Copiar Link'}</span>
              </button>
            </div>

            <p className="jam-instruction-tip">
              Envie o link para outra pessoa abrir no PC ou celular. Vocês ouvirão a mesma música no mesmo segundo!
            </p>

            {/* Listeners List */}
            <div className="jam-listeners-section">
              <div className="listeners-header">
                <Users size={16} className="text-accent" />
                <span>Ouvintes na Sala ({jamUsers.length || 1}):</span>
              </div>
              <div className="listeners-chips-list">
                {jamUsers.map((name, idx) => {
                  const label = String(name || 'Amigo');
                  return (
                    <span key={idx} className="listener-chip">
                      <span className="listener-avatar">{label.charAt(0).toUpperCase()}</span>
                      <span className="listener-name">{label}</span>
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Live Reaction Emojis */}
            <div className="jam-reactions-bar">
              <span className="reactions-label">Reagir na tela:</span>
              <div className="reaction-emojis-row">
                {reactions.map((emoji) => (
                  <button
                    key={emoji}
                    className="reaction-emoji-btn"
                    onClick={() => onSendReaction(emoji)}
                    title={`Enviar reação ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            {/* Footer Actions */}
            <div className="jam-footer-actions">
              <button className="btn-leave-jam" onClick={onLeaveRoom}>
                <LogOut size={16} />
                <span>Sair da Sala</span>
              </button>
              <button className="btn-primary" onClick={onClose}>
                Continuar Ouvindo
              </button>
            </div>
          </div>
        ) : (
          /* ==========================================================
             NÃO CONECTADO (CRIAR OU ENTRAR)
             ========================================================== */
          <div className="jam-create-join-content">
            <div className="modal-tabs-header">
              <button
                className={`modal-tab-btn ${tab === 'create' ? 'active' : ''}`}
                onClick={() => setTab('create')}
              >
                <Sparkles size={16} />
                <span>Criar Sala</span>
              </button>
              <button
                className={`modal-tab-btn ${tab === 'join' ? 'active' : ''}`}
                onClick={() => setTab('join')}
              >
                <Users size={16} />
                <span>Entrar em Sala</span>
              </button>
            </div>

            <div className="form-group" style={{ marginTop: '16px' }}>
              <label>Seu Nome ou Apelido</label>
              <input
                type="text"
                placeholder="Ex: João, Maria, Leo..."
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                required
              />
            </div>

            {tab === 'create' ? (
              <form onSubmit={handleCreate} className="jam-form">
                <div className="jam-info-box">
                  <Radio size={28} className="text-accent pulse" />
                  <div>
                    <h5>Inicie uma sessão compartilhada</h5>
                    <p>
                      Você terá um link exclusivo para compartilhar. Quem entrar ouvirá junto com você em tempo real!
                    </p>
                  </div>
                </div>

                <div className="modal-footer">
                  <button type="button" className="btn-cancel" onClick={onClose}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary">
                    <Radio size={16} />
                    <span>Iniciar Sala Sincronizada</span>
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleJoin} className="jam-form">
                <div className="form-group">
                  <label>Código da Sala ou Link</label>
                  <input
                    type="text"
                    placeholder="Ex: JAM4891"
                    value={roomCodeInput}
                    onChange={(e) => {
                      // Se colou o link completo, extrai o código
                      setRoomCodeInput(extractRoomCode(e.target.value));
                    }}
                    maxLength={300}
                    required
                    autoFocus
                  />
                </div>

                <div className="modal-footer">
                  <button type="button" className="btn-cancel" onClick={onClose}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" disabled={roomCodeInput.length < 3}>
                    <Users size={16} />
                    <span>Entrar e Sincronizar</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
