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
  },
  {
    id: 'pl-taylor',
    name: "Taylor's Era",
    description: 'Discografia selecionada de Taylor Swift do The Vault ao Fearless.',
    cover: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/c3/d0/1c/c3d01c88-73e7-187e-fd62-e1744de979a6/21UMGIM09915.rgb.jpg/600x600bb.jpg',
    trackIds: initialTracks.filter((t) => t.artist.toLowerCase().includes('taylor swift')).map((t) => t.id),
    isDefault: true
  },
  {
    id: 'pl-sabrina',
    name: 'Sabrina Carpenter Hits',
    description: 'Os maiores sucessos de Sabrina Carpenter para ouvir sem parar.',
    cover: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/4d/9b/37/4d9b37fb-6ba1-0dcf-8bb1-ec23fa5d956a/24UMGIM61066.rgb.jpg/600x600bb.jpg',
    trackIds: initialTracks.filter((t) => t.artist.toLowerCase().includes('sabrina carpenter')).map((t) => t.id),
    isDefault: true
  }
];
