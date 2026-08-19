// Pick the clock typeface from the painting's own metadata.
//
// Every mood scores itself against one artwork record and the highest score wins; ties
// break toward the earlier entry in MOODS. The result is a pure function of the record,
// so the same painting always draws the same typeface.
//
// Three signals, and the weights make the ranking strict — culture > subject > era:
//   culture  (6) — an East Asian ink painting is an East Asian ink painting whatever
//                  century it comes from, so this outranks everything else.
//   keywords (2 each, at most 2 count) — subject matter, from title, tags, medium and
//                  culture. Capped at 4 so that no pile-up of tags can reach the culture
//                  score; a padded tag list must not be able to overrule "this is Japan".
//   era      (3) — the weakest of the three. It is the hint the museums supply most
//                  reliably, but a century band says less about a painting than its
//                  subject does, and the bands overlap on purpose.
//
// `department` is deliberately NOT part of the keyword haystack. It is a museum filing
// category, not a property of the painting: "Modern European Painting and Sculpture"
// houses Monet, and letting that string vote would file impressionism as modernism.

const CULTURE_WEIGHT = 6;
const ERA_WEIGHT = 3;
const KEYWORD_WEIGHT = 2;
const KEYWORD_CAP = 2;

const EAST_ASIAN = [
  'china', 'chinese', 'japan', 'japanese', 'korea', 'korean',
  'tang dynasty', 'song dynasty', 'yuan dynasty', 'ming dynasty', 'qing dynasty',
  'edo period', 'meiji', 'muromachi', 'kamakura', 'joseon', 'goryeo',
];

export const MOODS = [
  {
    id: 'eastasian',
    label: 'East Asian ink',
    font: 'Noto Serif JP',
    cssFamily: "'Noto Serif JP', 'Hiragino Mincho ProN', 'Songti SC', serif",
    weight: 500,
    tracking: '0.06em',
    cultures: EAST_ASIAN,
    keywords: ['ink on', 'hanging scroll', 'handscroll', 'album leaf', 'silk', 'screen'],
  },
  {
    id: 'gilded',
    label: 'Gothic and Renaissance gold',
    font: 'Cinzel',
    cssFamily: "'Cinzel', 'Trajan Pro', Georgia, serif",
    weight: 600,
    tracking: '0.08em',
    era: [0, 1600],
    keywords: [
      'saint', 'christ', 'crucifixion', 'annunciation', 'virgin', 'madonna', 'angel',
      'archangel', 'gold ground', 'tempera', 'altarpiece', 'judgment',
    ],
  },
  {
    id: 'baroque',
    label: 'Baroque and neoclassical',
    font: 'Bodoni Moda',
    cssFamily: "'Bodoni Moda', Didot, 'Times New Roman', serif",
    weight: 500,
    tracking: '0.04em',
    era: [1600, 1790],
    keywords: [
      'portrait', 'still life', 'night', 'candle', 'vanitas', 'herring', 'fruit',
      'family', 'gentleman', 'lady', 'oil on wood', 'meal',
    ],
  },
  {
    id: 'romantic',
    label: 'Romantic landscape',
    font: 'Cormorant Garamond',
    cssFamily: "'Cormorant Garamond', Garamond, Georgia, serif",
    weight: 500,
    tracking: '0.05em',
    era: [1770, 1875],
    keywords: [
      'landscape', 'forest', 'wooded', 'mountain', 'valley', 'vale', 'storm', 'sunset',
      'seascape', 'shipwreck', 'ruins', 'moonlight', 'cliff', 'harvest',
    ],
  },
  {
    id: 'impression',
    label: 'Impressionist light',
    font: 'Playfair Display',
    cssFamily: "'Playfair Display', Georgia, serif",
    weight: 500,
    tracking: '0.03em',
    era: [1860, 1920],
    keywords: [
      'impression', 'water lil', 'garden', 'dancer', 'dancers', 'ballet', 'boulevard',
      'terrace', 'poppies', 'haystack', 'regatta', 'pointillism', 'dawn', 'apples',
    ],
  },
  {
    id: 'modern',
    label: 'Modernist geometry',
    font: 'Space Grotesk',
    cssFamily: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif",
    weight: 500,
    tracking: '0.02em',
    era: [1905, 2100],
    keywords: [
      'composition', 'abstract', 'construction', 'geometry', 'cubism', 'suprematism',
      'no. ', 'study for', 'improvisation',
    ],
  },
];

export const FALLBACK_MOOD = MOODS[1];

function haystackFor(artwork) {
  return [
    artwork.title,
    artwork.medium,
    artwork.culture,
    ...(Array.isArray(artwork.tags) ? artwork.tags : []),
  ]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();
}

function cultureHaystackFor(artwork) {
  return [artwork.culture, ...(Array.isArray(artwork.tags) ? artwork.tags : [])]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();
}

/** Per-mood score for one artwork, with the reasons kept for the tests and the UI. */
export function scoreMood(mood, artwork) {
  const haystack = haystackFor(artwork);
  const cultureHaystack = cultureHaystackFor(artwork);
  const reasons = [];
  let score = 0;

  if (mood.cultures?.some((needle) => cultureHaystack.includes(needle))) {
    score += CULTURE_WEIGHT;
    reasons.push('culture');
  }

  const year = Number(artwork.year);
  if (mood.era && Number.isFinite(year) && year >= mood.era[0] && year <= mood.era[1]) {
    score += ERA_WEIGHT;
    reasons.push('era');
  }

  const hits = (mood.keywords || []).filter((needle) => haystack.includes(needle));
  if (hits.length) {
    score += Math.min(hits.length, KEYWORD_CAP) * KEYWORD_WEIGHT;
    reasons.push(`subject:${hits.slice(0, KEYWORD_CAP).join(',')}`);
  }

  return { score, reasons };
}

/**
 * The mood, and therefore the typeface, for one artwork.
 *
 * Returns the fallback mood when nothing scores, so a record with sparse metadata still
 * renders in a real typeface rather than an unstyled one.
 */
export function chooseMood(artwork) {
  let best = null;
  for (const mood of MOODS) {
    const { score, reasons } = scoreMood(mood, artwork);
    // Strictly greater, so a tie keeps the earlier mood and the result stays stable.
    if (score > 0 && (!best || score > best.score)) best = { mood, score, reasons };
  }
  if (!best) return { mood: FALLBACK_MOOD, score: 0, reasons: ['fallback'] };
  return best;
}

/** Families the page has to load. Keeps index.html and MOODS from drifting apart. */
export function requiredFontFamilies() {
  return MOODS.map((mood) => mood.font);
}
