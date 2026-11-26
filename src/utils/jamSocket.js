/**
 * Gerenciador de conexão WebSocket para Sessão Sincronizada (Ouvir Juntos / Jam)
 *
 * - Só existe uma conexão por vez: entrar em outra sala fecha a anterior sem
 *   disparar os callbacks dela.
 * - Se a conexão cair depois de entrar na sala, tenta reconectar sozinho
 *   (até MAX_RECONNECT_ATTEMPTS vezes) e reenvia o JOIN com o estado atual.
 */

const MAX_RECONNECT_ATTEMPTS = 5;

class JamSocketManager {
  constructor() {
    this.ws = null;
    this.roomId = null;
    this.username = 'Amigo';
    this.callbacks = {};
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.hasJoined = false;
  }

  get isConnected() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * @param {string} roomId
   * @param {string} username
   * @param {object} callbacks  getInitialState, onConnected(roomId, isReconnect), onRoomSync,
   *                            onUserJoined, onUserLeft, onSyncAction, onReaction,
   *                            onReconnecting, onDisconnected(reason), onError(message)
   * @returns {string} código da sala normalizado
   */
  connect(roomId, username, callbacks = {}) {
    this.disconnect();
    this.roomId = String(roomId || '').toUpperCase().trim();
    this.username = String(username || '').trim().slice(0, 32) || 'Amigo';
    this.callbacks = callbacks;
    this.reconnectAttempts = 0;
    this.hasJoined = false;
    this.open();
    return this.roomId;
  }

  open() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws;
    try {
      ws = new WebSocket(`${protocol}//${window.location.host}/ws-jam`);
    } catch (e) {
      console.error('Falha ao conectar WebSocket:', e);
      this.handleClose();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      const isReconnect = this.hasJoined;
      this.hasJoined = true;
      this.reconnectAttempts = 0;
      const initialState = this.callbacks.getInitialState?.() ?? null;
      ws.send(JSON.stringify({ type: 'JOIN', roomId: this.roomId, username: this.username, initialState }));
      this.callbacks.onConnected?.(this.roomId, isReconnect);
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        console.error('Erro ao ler mensagem do Jam:', e);
        return;
      }
      this.handleMessage(msg);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.handleClose();
    };

    ws.onerror = (err) => {
      console.warn('WebSocket Jam erro:', err);
    };
  }

  handleClose() {
    if (!this.roomId) return;

    // Nunca conseguiu entrar (servidor fora do ar) ou esgotou as tentativas
    if (!this.hasJoined || this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      const reason = this.hasJoined ? 'lost' : 'failed';
      const { onDisconnected } = this.callbacks;
      this.disconnect();
      onDisconnected?.(reason);
      return;
    }

    this.reconnectAttempts += 1;
    if (this.reconnectAttempts === 1) this.callbacks.onReconnecting?.();
    const delay = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 8000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.roomId) this.open();
    }, delay);
  }

  handleMessage(msg) {
    const cb = this.callbacks;
    switch (msg.type) {
      case 'ROOM_SYNC':
        cb.onRoomSync?.(msg.state, msg.userCount, msg.users || []);
        break;
      case 'USER_JOINED':
        cb.onUserJoined?.(msg.username, msg.userCount, msg.users || []);
        break;
      case 'USER_LEFT':
        cb.onUserLeft?.(msg.username, msg.userCount, msg.users || []);
        break;
      case 'SYNC_ACTION':
        cb.onSyncAction?.(msg.action, msg.payload || {}, msg.from, !!msg.self);
        break;
      case 'REACTION':
        cb.onReaction?.(msg.reaction, msg.from);
        break;
      case 'ERROR':
        cb.onError?.(msg.message);
        break;
      default:
        break;
    }
  }

  send(message) {
    if (this.isConnected && this.roomId) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  sendSyncAction(action, payload = {}) {
    return this.send({ type: 'SYNC_ACTION', roomId: this.roomId, action, ...payload });
  }

  sendReaction(reaction) {
    return this.send({ type: 'REACTION', roomId: this.roomId, reaction });
  }

  /** Sai da sala sem disparar callbacks. */
  disconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        // já fechado
      }
    }
    this.roomId = null;
    this.hasJoined = false;
    this.reconnectAttempts = 0;
  }
}

export const jamSocket = new JamSocketManager();
