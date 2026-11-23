# 🎧 JBLGPlayer — Sound, Streaming & Karaoke

<div align="center">

![React](https://img.shields.io/badge/React-19.3-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-8.3-646CFF?logo=vite&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-Jam_Sync-010101?logo=socketdotio)
![License](https://img.shields.io/badge/License-MIT-emerald)

**Player de música moderno, streaming completo, letras sincronizadas (.LRC), modo Palco Karaoke e sessões colaborativas "Ouvir Juntos" em tempo real.**

[Recursos](#-recursos-principais) • [Instalação](#-como-executar) • [Arquitetura](#-arquitetura) • [Identidade Visual](#-identidade-visual)

</div>

---

## ✨ Recursos Principais

- 🎶 **Streaming de Músicas Completas:**
  - Motor de streaming universal (`/api/stream`) com suporte nativo a HTTP Range Requests (`206 Partial Content`).
  - Sem restrições de IP ou domínio — funciona no `localhost`, computadores, tablets, TVs e celulares na rede local Wi-Fi (`192.168.x.x`).
  - Suporte à reprodução com tela desligada e em abas em segundo plano em dispositivos móveis.
  - Alternador dinâmico de modo clipe para assistir vídeos do YouTube sob demanda.

- 🎤 **Modo Letras & Karaoke Sincronizado (.LRC):**
  - Sincronização linha por linha em tempo real com destaque visual e rolagem automática suave.
  - **Modo Palco (Stage Mode):** Interface imersiva estilo estúdio com tipografia gigante e exibição da próxima linha.
  - Ajuste de sincronia fino milissegundo a milissegundo (+ / - offset).
  - Busca automática online de letras e importação/exportação de arquivos `.lrc` personalizados.

- 👥 **Ouvir Juntos (Jam Session em Tempo Real):**
  - Servidor WebSocket integrado (`/ws-jam`) para sincronizar reprodução entre múltiplos amigos simultaneamente.
  - Sincronização instantânea de Play/Pause, Seek (pulo de tempo) e troca de faixa.
  - Reações flutuantes animadas em tempo real com emojis (🔥, ❤️, 🎵, 👏, 🎉, 🚀).

- 📂 **Gestão de Playlists & Importação Inteligente:**
  - Importação de playlists públicas do **Spotify** via links.
  - Importação de playlists do **YouTube**.
  - Criação, edição e exclusão de playlists locais com persistência em `LocalStorage`.
  - Upload de arquivos de áudio locais (`.mp3`, `.m4a`, `.wav`) e arquivos `.lrc` arrastando e soltando.

- 🎨 **Design AMOLED Cyber Dark:**
  - Paleta escura profunda `#0a0b0e` com detalhes em verde ciano neon (`#10b981` / `#00e599`).
  - Barra lateral retrátil, layout responsivo para desktop e celular.
  - Indicadores animados de reprodução com equalizador de ondas.

---

## 🚀 Como Executar

### Pré-requisitos
- [Node.js](https://nodejs.org/) versão 18 ou superior.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) instalado no sistema e acessível no PATH (usado pelo backend para resolução dos fluxos de áudio de alta fidelidade).

### Inicialização Rápida no Windows
Basta dar um duplo clique no arquivo:
```cmd
iniciar_player.bat
```

### Inicialização Manual via Terminal
1. Clone o repositório:
```bash
git clone https://github.com/GioBrendo/JBLGPlayer.git
cd JBLGPlayer
```

2. Instale as dependências:
```bash
npm install
```

3. Inicie o servidor com suporte a rede local:
```bash
npm run dev -- --host
```

4. Acesse no navegador:
- **No próprio computador:** [http://localhost:5173](http://localhost:5173)
- **No celular ou outros aparelhos na mesma rede Wi-Fi:** `http://SEU_IP_LOCAL:5173` (ex: `http://192.168.1.6:5173`)

---

## 🛠️ Arquitetura

```
music-player/
├── src/
│   ├── components/
│   │   ├── PlayerBar.jsx         # Controles de reprodução, volume, seek e botões de ação
│   │   ├── LyricsView.jsx        # Visualizador de letras sincronizadas e Modo Palco
│   │   ├── JamModal.jsx          # Salas de escuta sincronizada via WebSocket
│   │   ├── Sidebar.jsx           # Navegação lateral, playlists e atalhos de importação
│   │   ├── TrackList.jsx         # Tabela de faixas com drag-and-drop e status
│   │   ├── OnlineSearch.jsx      # Busca integrada com pré-resolução de áudio
│   │   └── YouTubePlayer.jsx     # Visualizador de clipe sob demanda
│   ├── utils/
│   │   ├── lrcParser.js          # Parser de tempo e linhas LRC
│   │   ├── jamSocket.js          # Cliente WebSocket para as salas Jam
│   │   └── lyricsApi.js          # Integração de busca de letras abertas
│   ├── data/
│   │   ├── defaultPlaylists.js   # Playlists predefinidas
│   │   └── tracks.js             # Biblioteca inicial com metadados
│   ├── App.jsx                   # Orquestrador de estado global, áudio HTML5 e eventos
│   └── App.css                   # Sistema de design AMOLED com gradientes e animações
├── lyrics/                       # Arquivos de exemplo de letras sincronizadas (.lrc)
├── vite.config.js                # Middlewares backend: /api/stream, /api/yt-search e /ws-jam
└── package.json
```

---

## 📄 Licença

Distribuído sob a licença MIT. Consulte `LICENSE` para mais detalhes.
