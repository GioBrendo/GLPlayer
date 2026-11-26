/**
 * Pure ESM helpers for normalizing YouTube music track/channel metadata,
 * generating progressive lyrics search candidates, and scoring lyrics matches.
 *
 * Zero Node or DOM dependencies so both `server/backend.js` and `src/` can share it.
 */

const GENERIC_ARTISTS = new Set([
  'youtube',
  'unknown',
  'unknown artist',
  'artista desconhecido',
  'música do youtube',
  'musica do youtube',
  'arquivo local',
  'arquivo local (computador)',
  'meu computador',
  'various artists',
  'vários artistas',
  'varios artistas',
  'n/a',
  'na',
  'none',
  '-'
]);

const CHANNEL_MARKER_RE =
  /(?:-\s*topic|\btopic$|\bvevo$|\bofficial(?:\s+(?:artist\s+)?channel|\s+music|\s+audio)?$|\boficial$|\bcanal\s+oficial$|\brecords$|\brecordings$|\bmusic\s+group$|\bentertainment$|\bproductions$|\bstudios?$|\bchannel$|\blyrics?$|\bletras?$|\blegendado$|\btv$)/i;

const TRACK_NUMBER_PREFIX_RE = /^\s*(?:0?\d{1,2}\s*[.)]|0\d\s*[-–—]|\d{2}\s*[-–—](?=.*?\s[-–—]\s))\s*(?=\S)/;
const TRAILING_PIPE_RE = /\s*\|\s*[^|]{2,}$/;
const TRAILING_HASHTAG_RE = /(?:\s+#[^\s#]+)+\s*$/;

// Upload/video/remaster tags stripped from displayTitle (musical qualifiers like Live/Acoustic stay).
const DISPLAY_NOISE_INNER_RE =
  /^(?:official\s+(?:music\s+|lyric\s+|lyrics\s+|hd\s+|4k\s+|visual(?:izer|iser)?\s+)?(?:video|audio|clip|clipe)(?:\b.*)?|official|oficial|music\s+video(?:\b.*)?|lyric\s+video(?:\b.*)?|lyrics?\s+video(?:\b.*)?|lyrics?|letra(?:\s+e\s+tradu[cç][aã]o)?|com\s+letra|legendado|tradu[cç][aã]o|subtitulado|sub\.?\s*(?:esp|espa[nñ]ol|eng|pt|pt-br)|eng\s+sub|pt-br|clipe\s+oficial(?:\b.*)?|v[ií]deo\s+oficial(?:\b.*)?|[aá]udio\s+oficial(?:\b.*)?|videoclipe|clipe|audio|[aá]udio|hd|4k|uhd|hq|mq|1080p|720p|mv|m\/v|pv|visuali[sz]er|explicit|clean|remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?|\d{4}\s+mix|mono|stereo|mono\s*\/\s*\d{4}\s+remaster|dvd\s+.*)$/i;

// Core title additionally drops musical version/live/soundtrack/feat tags so base lyrics match.
const CORE_QUALIFIER_INNER_RE =
  /(?:version|vers[aã]o|edit|mix|remaster|live|ao\s+vivo|acoustic|ac[uú]stico|unplugged|session|sess[aã]o|demo|radio|single|album|deluxe|bonus|explicit|clean|spoken\s+word|intro|outro|soundtrack|from\s+|spider-man|feat\.?|ft\.?|featuring|part\.?|with\s+|prod\.?|cover|karaoke|instrumental|tribute|remastered|new\s+york|ed\s+sullivan|bbc|mtv|tiny\s+desk)/i;

const FEAT_TAIL_RE = /\s+(?:feat\.?|ft\.?|featuring)\s+[^([]+$/i;
const DASH_QUALIFIER_TAIL_RE =
  /\s+[-–—]\s+(?:live|ao\s+vivo|acoustic|ac[uú]stico|unplugged|remaster(?:ed)?|radio\s+edit|single\s+version|album\s+version|official|clipe|v[ií]deo|[aá]udio|letra|legendado|remix|demo|version|vers[aã]o|mono|stereo|\d{4}\s+remaster).*$/i;

// Right side of "X - Y" that indicates a version suffix rather than "Artist - Song".
const RIGHT_SIDE_VERSION_ONLY_RE =
  /^(?:live(?:\s+(?:at|in|on|from|with)\b.*)?|ao\s+vivo(?:\s+.*)?|acoustic(?:\s+.*)?|ac[uú]stico(?:\s+.*)?|unplugged(?:\s+.*)?|remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?|official\s+.*|clipe\s+oficial|v[ií]deo\s+oficial|[aá]udio\s+oficial|lyrics?|letra|legendado|demo|radio\s+edit|remix|instrumental|karaoke)$/i;

const VERSION_MISMATCH_TERMS = [
  'instrumental',
  'karaoke',
  'cover',
  'tribute',
  '8-bit',
  'lullaby',
  'piano version',
  'lo-fi',
  'lofi',
  'nightcore',
  'sped up',
  'slowed',
  'remix'
];

const LIVE_HINT_RE = /\b(live|ao vivo|acoustic|ac[uú]stico|unplugged|session|spoken\s+word|intro|concert|ed sullivan|tiny desk|mtv)\b/i;

const PROTECTED_MULTI_ARTISTS = [
  "guns n' roses",
  'simon & garfunkel',
  'hall & oates',
  'earth, wind & fire',
  'crosby, stills & nash',
  'crosby, stills, nash & young',
  'florence + the machine',
  'tyler, the creator',
  'emerson, lake & palmer',
  'peter, paul and mary',
  'kool & the gang',
  'brooks & dunn',
  'tears for fears',
  'marcus & martinus',
  'chitaozinho & xororo',
  'chitãozinho & xororó',
  'zeze di camargo & luciano',
  'zezé di camargo & luciano',
  'henrique & juliano',
  'jorge & mateus',
  'matheus & kauan',
  'maiara & maraisa',
  'simone & simaria',
  'sandy & junior'
];

function normalizeSpaces(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeUnicodePunctuation(value) {
  return normalizeSpaces(value)
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-');
}

/** Normalizes a string for fuzzy token/equality comparison (lowercase, ASCII-folded). */
export function normalizeForCompare(value) {
  if (typeof value !== 'string') return '';
  return normalizeUnicodePunctuation(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTokens(value) {
  const norm = normalizeForCompare(value);
  return norm ? norm.split(' ').filter(Boolean) : [];
}

function splitPascalCase(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Detects whether a raw artist/channel string looks like a placeholder, label, or YouTube channel. */
export function isChannelLikeArtist(rawArtist) {
  const norm = normalizeUnicodePunctuation(rawArtist);
  if (!norm) return true;
  if (GENERIC_ARTISTS.has(norm.toLowerCase())) return true;
  return CHANNEL_MARKER_RE.test(norm);
}

/**
 * Strips YouTube channel suffixes (`- Topic`, `VEVO`, `Official`, `- Official Channel`,
 * `Records`, etc.) and returns `''` for generic placeholders (`YouTube`, `Unknown`, `Arquivo Local...`).
 */
export function cleanChannelArtist(rawArtist) {
  let text = normalizeUnicodePunctuation(rawArtist);
  if (!text) return '';

  const lower = text.toLowerCase();
  if (GENERIC_ARTISTS.has(lower) || lower.startsWith('arquivo local')) return '';

  // Strip bracketed/parenthetical channel markers like "(Official)" or "[VEVO]"
  text = text.replace(/\s*(?:\(|\[)(?:official|oficial|topic|vevo|channel|canal)(?:\)|\])\s*/gi, ' ').trim();

  // "- Topic" / "Topic" auto-generated artist channels
  text = text.replace(/\s*(?:-\s*)?topic$/i, '').trim();

  // "ArtistVEVO" / "Artist VEVO" -> split PascalCase only when VEVO was attached without spaces
  const vevoMatch = text.match(/^(.*?)(?:\s*-\s*|\s+)?vevo$/i);
  if (vevoMatch) {
    const base = vevoMatch[1].trim();
    if (!base) return '';
    text = !/\s/.test(base) && /[a-z]/.test(base) && /[A-Z]/.test(base) ? splitPascalCase(base) : base;
  }

  // Strip trailing channel/label markers (never touch leading "Official..." band names like Official髭男dism)
  const hadSpaceBeforeOfficial = /\s(?:official|oficial)\s*$/i.test(text);
  const beforeOfficial = text;
  text = text
    .replace(/\s*(?:-\s*|\|\s*)?(?:official\s+artist\s+channel|official\s+channel|canal\s+oficial)\s*$/i, '')
    .replace(/\s*(?:-\s*|\|\s*)?(?:official\s+music|official\s+audio|official|oficial)\s*$/i, '');
  if (
    !hadSpaceBeforeOfficial &&
    text !== beforeOfficial &&
    text &&
    !/\s/.test(text) &&
    /[a-z]/.test(text) &&
    /[A-Z]/.test(text)
  ) {
    text = splitPascalCase(text);
  }
  text = text
    .replace(/\s+(?:records|recordings|music\s+group|entertainment|productions|tv|channel|canal)\s*$/i, '')
    .replace(/\s*-\s*$/, '')
    .trim();

  const finalLower = text.toLowerCase();
  if (!text || GENERIC_ARTISTS.has(finalLower) || finalLower.startsWith('arquivo local')) return '';
  return text;
}

function artistsLookRelated(a, b) {
  const normA = normalizeForCompare(a);
  const normB = normalizeForCompare(b);
  if (!normA || !normB) return false;
  if (normA === normB || normA.includes(normB) || normB.includes(normA)) return true;

  const compactA = normA.replace(/\s+/g, '');
  const compactB = normB.replace(/\s+/g, '');
  if (compactA === compactB || compactA.includes(compactB) || compactB.includes(compactA)) return true;

  const tokensA = splitTokens(a).filter((t) => t.length > 1 && t !== 'the');
  const tokensB = new Set(splitTokens(b).filter((t) => t.length > 1 && t !== 'the'));
  if (tokensA.length === 0 || tokensB.size === 0) return false;

  return tokensA.some((t) => tokensB.has(t));
}

export function extractPrimaryArtist(artist) {
  const cleaned = cleanChannelArtist(artist) || normalizeUnicodePunctuation(artist);
  if (!cleaned) return '';

  const lower = cleaned.toLowerCase();
  if (PROTECTED_MULTI_ARTISTS.some((p) => lower === p)) return cleaned;

  // Split explicit collaboration markers first
  const featSplit = cleaned.split(/\s+(?:feat\.?|ft\.?|featuring|with|vs\.?|x)\s+/i)[0].trim();
  // Split comma-separated lists unless it looks like "Tyler, The Creator"
  if (featSplit.includes(',') && !/,\s*the\s+/i.test(featSplit)) {
    return featSplit.split(',')[0].trim();
  }
  // Split "&" only if not a protected duo/band
  if (featSplit.includes(' & ') && !PROTECTED_MULTI_ARTISTS.some((p) => lower.includes(p))) {
    return featSplit.split(' & ')[0].trim();
  }
  return featSplit;
}

function stripNoiseBrackets(title, { stripAllCore = false } = {}) {
  // Normalize full-width Japanese/Chinese brackets to ASCII brackets for uniform handling
  let out = title
    .replace(/[［【]/g, '[')
    .replace(/[］】]/g, ']');

  const bracketRe = /\s*(\([^()]*\)|\[[^[\]]*\])/g;
  out = out.replace(bracketRe, (full, group, offset) => {
    const inner = group.slice(1, -1).trim();
    if (!inner) return '';
    if (DISPLAY_NOISE_INNER_RE.test(inner)) return '';
    if (stripAllCore) {
      // Keep leading parens like "(I Can't Get No) Satisfaction" unless they are explicit qualifiers
      if (offset === 0 && !CORE_QUALIFIER_INNER_RE.test(inner)) return full;
      return '';
    }
    return ` ${group}`;
  });

  // Safety: if stripping parens emptied the entire title (e.g. "(Everything I Do)"), restore non-noise content
  out = normalizeSpaces(out);
  if (!out && stripAllCore) {
    return normalizeSpaces(
      title
        .replace(/[［【]/g, '[')
        .replace(/[］】]/g, ']')
        .replace(/\[[^[\]]*\]/g, '')
    );
  }
  return out;
}

function splitArtistTitlePrefix(title, cleanedRawArtist) {
  let working = title;
  let parsedArtist = '';

  // Split "Artist - Title" and collapse repeated prefixes ("Beatles - Beatles - Let It Be")
  for (let i = 0; i < 4; i++) {
    const match = working.match(/^(.+?)\s+-\s+(.+)$/);
    if (!match) break;
    const left = match[1].trim();
    const right = match[2].trim();
    if (!left || !right) break;

    // Never misinterpret "Song - Live in Tokyo" as artist="Song"
    if (RIGHT_SIDE_VERSION_ONLY_RE.test(right)) break;

    if (i === 0) {
      // Handle reversed "Song Title - Artist" uploads when channel/uploader matches the right side
      if (
        cleanedRawArtist &&
        !artistsLookRelated(left, cleanedRawArtist) &&
        artistsLookRelated(right, cleanedRawArtist)
      ) {
        parsedArtist = stripNoiseBrackets(right, { stripAllCore: false })
          .replace(/\s+(?:hd|4k|uhd|hq|mv|official|oficial)\s*$/i, '')
          .trim();
        working = left;
        break;
      }

      if (left.length <= 80 || (cleanedRawArtist && artistsLookRelated(left, cleanedRawArtist))) {
        parsedArtist = left;
        working = right;
        continue;
      }
      break;
    }

    // Subsequent splits collapse repeated prefixes matching parsedArtist or cleanedRawArtist
    if (
      (parsedArtist && artistsLookRelated(left, parsedArtist)) ||
      (cleanedRawArtist && artistsLookRelated(left, cleanedRawArtist))
    ) {
      working = right;
      continue;
    }
    break;
  }

  return { parsedArtist, titleBody: working };
}

/**
 * Parses messy YouTube video titles & channel/uploader names into clean display metadata
 * and ordered lyrics search candidates.
 */
export function parseYouTubeTrackMetadata(rawTitle, rawArtist = '') {
  const origTitle = normalizeUnicodePunctuation(rawTitle || '');
  const origArtist = normalizeUnicodePunctuation(rawArtist || '');
  const cleanedRawArtist = cleanChannelArtist(origArtist);
  const rawLooksLikeChannel = isChannelLikeArtist(origArtist);

  // Clean trailing "| Channel", "#shorts", and leading track numbers ("01. ", "01 - ")
  let working = origTitle
    .replace(TRAILING_HASHTAG_RE, '')
    .replace(TRAILING_PIPE_RE, '')
    .replace(TRACK_NUMBER_PREFIX_RE, '')
    .trim();

  // Also strip leading "(01) " track prefix if present
  working = working.replace(/^\(\d{1,2}\)\s+/, '').trim();

  const { parsedArtist, titleBody } = splitArtistTitlePrefix(working, cleanedRawArtist);

  // Extract featured artists from title if present (e.g., "(feat. X)" or "ft. X")
  const featMatch = titleBody.match(/(?:\(|\[|\s)(?:feat\.?|ft\.?|featuring)\s+([^)\]]+)/i);
  const featArtist = featMatch ? featMatch[1].trim() : '';

  // Choose the best cleanArtist:
  // - If rawArtist was empty/generic/channel-like/label and parsedArtist exists -> parsedArtist
  // - If parsedArtist exists and doesn't match rawArtist (fan re-upload like "Nathan Anthony" uploading "The Beatles - Twist And Shout") -> prefer parsedArtist, keep cleanedRawArtist in fallback candidates
  let cleanArtist = cleanedRawArtist;
  if (parsedArtist) {
    const cleanParsed = cleanChannelArtist(parsedArtist) || parsedArtist;
    if (!cleanedRawArtist || rawLooksLikeChannel || !artistsLookRelated(cleanParsed, cleanedRawArtist)) {
      cleanArtist = cleanParsed;
    } else if (cleanedRawArtist.length < cleanParsed.length && artistsLookRelated(cleanParsed, cleanedRawArtist)) {
      // Preserve fuller collaboration if parsedArtist is "Post Malone, Swae Lee" and rawArtist is "Post Malone"
      cleanArtist = cleanParsed;
    }
  }

  const primaryArtist = extractPrimaryArtist(cleanArtist);

  // displayTitle: remove video/upload noise, keep musical qualifiers like (Live ...), (Acoustic), feat.
  let displayTitle = stripNoiseBrackets(titleBody, { stripAllCore: false });
  displayTitle = displayTitle
    .replace(/\s*-\s*(?:official\s+(?:music\s+|lyric\s+)?(?:video|audio)|clipe\s+oficial|v[ií]deo\s+oficial|[aá]udio\s+oficial|letra|legendado).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!displayTitle) {
    displayTitle = stripNoiseBrackets(origTitle, { stripAllCore: false }) || origTitle;
  }

  // coreTitle: strip live/acoustic/remaster/soundtrack/feat tags for broad lyrics matching
  let coreTitle = stripNoiseBrackets(displayTitle, { stripAllCore: true });
  coreTitle = coreTitle
    .replace(FEAT_TAIL_RE, '')
    .replace(DASH_QUALIFIER_TAIL_RE, '')
    .replace(/\s*[-–—]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!coreTitle) {
    coreTitle = displayTitle;
  }

  // Build ordered, deduplicated search candidates
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (trackName, artistName) => {
    const t = normalizeSpaces(trackName);
    const a = normalizeSpaces(artistName);
    if (!t) return;
    const key = `${t.toLowerCase()}||${a.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      trackName: t,
      artistName: a,
      query: a ? `${t} ${a}` : t
    });
  };

  const artistVariants = [];
  for (const a of [cleanArtist, primaryArtist, cleanedRawArtist]) {
    if (a && !artistVariants.some((x) => x.toLowerCase() === a.toLowerCase())) {
      artistVariants.push(a);
    }
  }

  const titleVariants = [];
  for (const t of [displayTitle, coreTitle]) {
    if (t && !titleVariants.some((x) => x.toLowerCase() === t.toLowerCase())) {
      titleVariants.push(t);
    }
  }

  // 1. Most specific: (displayTitle, cleanArtist) then (coreTitle, cleanArtist)
  if (cleanArtist) {
    for (const t of titleVariants) {
      pushCandidate(t, cleanArtist);
    }
  }

  // 2. Primary artist variant with coreTitle first (handles "Post Malone, Swae Lee" -> "Post Malone")
  if (primaryArtist && primaryArtist.toLowerCase() !== cleanArtist.toLowerCase()) {
    pushCandidate(coreTitle, primaryArtist);
    if (displayTitle !== coreTitle) {
      pushCandidate(displayTitle, primaryArtist);
    }
  }

  // 3. Raw cleaned channel artist if different (handles "OFFICIAL HIGE DANDISM" vs "Official髭男dism" or non-standard "X - Y")
  if (cleanedRawArtist && !artistVariants.slice(0, -1).some((a) => a.toLowerCase() === cleanedRawArtist.toLowerCase())) {
    pushCandidate(coreTitle, cleanedRawArtist);
  } else if (cleanedRawArtist && cleanedRawArtist.toLowerCase() !== cleanArtist.toLowerCase()) {
    pushCandidate(coreTitle, cleanedRawArtist);
  }

  // 4. Title-only fallback (essential when artist is missing or wrong uploader)
  pushCandidate(coreTitle, '');
  if (displayTitle !== coreTitle) {
    pushCandidate(displayTitle, '');
  }

  return {
    rawTitle: origTitle,
    rawArtist: origArtist,
    parsedArtist: parsedArtist ? cleanChannelArtist(parsedArtist) || parsedArtist : '',
    featArtist,
    displayTitle,
    coreTitle,
    cleanArtist,
    primaryArtist,
    isLiveLike: LIVE_HINT_RE.test(origTitle),
    candidates
  };
}

function tokenOverlapRatio(a, b) {
  const tokensA = splitTokens(a);
  const tokensB = splitTokens(b);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setB = new Set(tokensB);
  const hits = tokensA.filter((t) => setB.has(t)).length;
  return hits / Math.max(tokensA.length, tokensB.length);
}

/**
 * Scores an LRCLIB or YouTube caption candidate against track metadata and target duration.
 * Higher score = better match; negative score = likely mismatch.
 */
export function scoreLyricsCandidate(candidate, metaOrTrack, targetDuration = 0, options = {}) {
  if (!candidate) return -1000;
  const hasSynced = typeof candidate.syncedLyrics === 'string' && /\[\d{1,3}:\d{2}/.test(candidate.syncedLyrics);
  const hasPlain = typeof candidate.plainLyrics === 'string' && candidate.plainLyrics.trim().length > 0;
  if (!hasSynced && !hasPlain) return -1000;

  const meta =
    metaOrTrack && typeof metaOrTrack.coreTitle === 'string'
      ? metaOrTrack
      : parseYouTubeTrackMetadata(metaOrTrack?.title || metaOrTrack?.rawTitle || '', metaOrTrack?.artist || metaOrTrack?.rawArtist || '');

  const durationUnknown = Boolean(options.durationUnknown);
  const candTrack = candidate.trackName || '';
  const candArtist = candidate.artistName || '';
  const candAlbum = candidate.albumName || '';

  let score = 0;

  // 1. Sync availability
  score += hasSynced ? 45 : 10;

  // 2. Instrumental mismatch
  const rawTitleNorm = normalizeForCompare(meta.rawTitle);
  const candFullNorm = normalizeForCompare(`${candTrack} ${candAlbum} ${candArtist}`);
  if (candidate.instrumental && !rawTitleNorm.includes('instrumental')) {
    score -= 90;
  }

  // 3. Title similarity
  const candTrackNorm = normalizeForCompare(candTrack);
  const displayNorm = normalizeForCompare(meta.displayTitle);
  const coreNorm = normalizeForCompare(meta.coreTitle);
  const candTrackCoreNorm = normalizeForCompare(parseYouTubeTrackMetadata(candTrack, candArtist).coreTitle);

  if (candTrackNorm && (candTrackNorm === displayNorm || candTrackNorm === coreNorm)) {
    score += 50;
  } else if (candTrackCoreNorm && candTrackCoreNorm === coreNorm) {
    score += 44;
  } else if (
    candTrackNorm &&
    coreNorm &&
    (candTrackNorm.startsWith(coreNorm + ' ') || coreNorm.startsWith(candTrackNorm + ' '))
  ) {
    score += 32;
  } else {
    const ratio = Math.max(tokenOverlapRatio(candTrack, meta.coreTitle), tokenOverlapRatio(candTrack, meta.displayTitle));
    if (ratio >= 0.6) score += Math.round(ratio * 30);
    else if (ratio > 0) score += Math.round(ratio * 14) - 10;
    else if (candTrackNorm) score -= 60;
  }

  // 4. Artist similarity
  const candArtistNorm = normalizeForCompare(candArtist);
  const artistTargets = [meta.cleanArtist, meta.primaryArtist, meta.parsedArtist, cleanChannelArtist(meta.rawArtist)].filter(Boolean);

  if (artistTargets.length > 0 && candArtistNorm) {
    if (artistTargets.some((a) => normalizeForCompare(a) === candArtistNorm)) {
      score += 45;
    } else if (artistTargets.some((a) => artistsLookRelated(a, candArtist))) {
      score += 32;
    } else {
      score -= 45;
    }
  }

  // 5. Penalize karaoke/cover/instrumental/tribute/remix unless present in source title
  for (const term of VERSION_MISMATCH_TERMS) {
    const normTerm = normalizeForCompare(term);
    if (candFullNorm.includes(normTerm) && !rawTitleNorm.includes(normTerm)) {
      score -= term === 'remix' ? 22 : 45;
    }
  }

  // Slight live alignment bonus/penalty
  const candIsLive = LIVE_HINT_RE.test(`${candTrack} ${candAlbum}`);
  if (meta.isLiveLike && candIsLive) score += 8;
  else if (!meta.isLiveLike && candIsLive) score -= 8;

  // 6. Duration proximity (skip penalty when duration is unknown or marked placeholder)
  const candDur = Number(candidate.duration);
  const targetDur = Number(targetDuration);
  if (!durationUnknown && Number.isFinite(targetDur) && targetDur > 0 && Number.isFinite(candDur) && candDur > 0) {
    const diff = Math.abs(candDur - targetDur);
    if (diff <= 2) score += 25;
    else if (diff <= 5) score += 18;
    else if (diff <= 12) score += 8;
    else if (diff <= 25) score += 0;
    else if (diff <= 45) score -= 12;
    else score -= 25;
  }

  return score;
}
