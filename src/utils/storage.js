/**
 * Persistência no LocalStorage com uma única chave por dado.
 *
 * Versões anteriores gravavam o mesmo dado em três prefixos (glmusic_, jblgplayer_,
 * soundwave_) e liam em ordens diferentes, o que fazia favoritos e volume "voltarem"
 * ao valor antigo ao recarregar a página. Agora só `jblgplayer_` é gravado; os
 * prefixos antigos são lidos como migração e apagados na primeira gravação.
 */
const PREFIX = 'jblgplayer_';
const LEGACY_PREFIXES = ['glmusic_', 'soundwave_'];

function readRaw(key) {
  try {
    for (const prefix of [PREFIX, ...LEGACY_PREFIXES]) {
      const value = localStorage.getItem(prefix + key);
      if (value !== null) return value;
    }
  } catch {
    // LocalStorage indisponível (modo privado, política do navegador…)
  }
  return null;
}

function removeLegacy(key) {
  for (const prefix of LEGACY_PREFIXES) {
    localStorage.removeItem(prefix + key);
  }
}

export function loadString(key, fallback = null) {
  const raw = readRaw(key);
  return raw === null ? fallback : raw;
}

export function loadJSON(key, fallback) {
  const raw = readRaw(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveString(key, value) {
  try {
    try {
      localStorage.setItem(PREFIX + key, value);
    } catch (err) {
      // Sem espaço: libera as cópias antigas e tenta mais uma vez
      removeLegacy(key);
      localStorage.setItem(PREFIX + key, value);
      console.warn(`Espaço do navegador quase cheio ao salvar "${key}".`, err);
    }
    removeLegacy(key);
    return true;
  } catch (err) {
    console.warn(`Não foi possível salvar "${key}" no navegador:`, err);
    return false;
  }
}

export function saveJSON(key, value) {
  return saveString(key, JSON.stringify(value));
}

/** Apaga playlists e músicas importadas (usado pelo botão "Resetar Dados Salvos"). */
export function clearSavedLibrary() {
  try {
    for (const prefix of [PREFIX, ...LEGACY_PREFIXES]) {
      for (const key of ['playlists', 'custom_tracks', 'track_overrides']) {
        localStorage.removeItem(prefix + key);
      }
    }
  } catch {
    // ignora
  }
}
