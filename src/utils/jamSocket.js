/**
 * Gerenciador de conexão WebSocket para Sessão Sincronizada (Ouvir Juntos / Jam)
 */

class JamSocketManager {
  constructor() {
    this.ws = null;
    this.roomId = null;
    this.username = 'Ouvinte';
    this.callbacks = {};
    this.reconnectTimer = null;
    this.isConnected = false;
  }

  connect(roomId, username, initialState, callbacks = {}) {
    this.roomId = roomId.toUpperCase().trim();
    this.username = username || 'Amigo';
    this.callbacks = callbacks;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws-jam`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        // Envia mensagem de entrada na sala
        this.ws.send(JSON.stringify({
          type: 'JOIN',
          roomId: this.roomId,
          username: this.username,
          initialState: initialState
        }));
        if (this.callbacks.onConnected) this.callbacks.onConnected();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
          console.error('Erro ao ler mensagem do Jam:', e);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        if (this.callbacks.onDisconnected) this.callbacks.onDisconnected();
      };

      this.ws.onerror = (err) => {
        console.warn('WebSocket Jam erro:', err);
      };
    } catch (e) {
      console.error('Falha ao conectar WebSocket:', e);
    }
  }

  handleMessage(msg) {
    if (msg.type === 'ROOM_SYNC') {
      if (this.callbacks.onRoomSync) this.callbacks.onRoomSync(msg.state, msg.userCount, msg.users);
    } else if (msg.type === 'USER_JOINED') {
      if (this.callbacks.onUserJoined) this.callbacks.onUserJoined(msg.username, msg.userCount, msg.users);
    } else if (msg.type === 'USER_LEFT') {
      if (this.callbacks.onUserLeft) this.callbacks.onUserLeft(msg.username, msg.userCount, msg.users);
    } else if (msg.type === 'SYNC_ACTION') {
      if (this.callbacks.onSyncAction) this.callbacks.onSyncAction(msg.action, msg.payload, msg.from);
    } else if (msg.type === 'REACTION') {
      if (this.callbacks.onReaction) this.callbacks.onReaction(msg.reaction, msg.from);
    }
  }

  sendSyncAction(action, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.roomId) {
      this.ws.send(JSON.stringify({
        type: 'SYNC_ACTION',
        roomId: this.roomId,
        action: action,
        ...payload
      }));
    }
  }

  sendReaction(reaction) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.roomId) {
      this.ws.send(JSON.stringify({
        type: 'REACTION',
        roomId: this.roomId,
        reaction: reaction
      }));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.roomId = null;
    this.isConnected = false;
  }
}

export const jamSocket = new JamSocketManager();
