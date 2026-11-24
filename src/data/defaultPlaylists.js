import { initialTracks } from './tracks';

export const defaultPlaylists = [
  {
    id: 'pl-all',
    name: 'Top Hits Gerais',
    description: 'Todas as mais de 60 faixas da biblioteca com reprodução completa.',
    cover: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop',
    trackIds: initialTracks.map((t) => t.id),
    isDefault: true
  },
  {
    id: 'pl-karaoke',
    name: 'Karaoke & Letras (.LRC)',
    description: 'Faixas com sincronização de letras linha por linha em tempo real.',
    cover: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=600&auto=format&fit=crop',
    trackIds: initialTracks.filter((t) => t.hasLyrics).map((t) => t.id),
    isDefault: true
  }
];
