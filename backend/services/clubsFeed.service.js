/**
 * clubsFeed.service.js
 *
 * Powers the student "Clubs Feed" page — a vertically-scrollable, reels-style
 * feed of YouTube videos relevant to the clubs a student has joined.
 *
 * Algorithm:
 *   1. Derive a specific search topic per club — sport name for sports clubs
 *      (reusing bracketMath.js's detectSport(), same utility the certificate
 *      generator uses), a small keyword map for common non-sport club types,
 *      falling back to a category-level or raw-name query.
 *   2. Fetch a POOL of videos per topic from YouTube, cached server-side and
 *      keyed by TOPIC (not by student or exact club combination) — many
 *      students share the same club topics, so this shares one cached pool
 *      across everyone interested in "volleyball" instead of refetching per
 *      student, which is what actually keeps this within YouTube's free
 *      quota (10,000 units/day; one search.list call costs 100).
 *   3. On every request, shuffle the combined pool fresh — refreshing the
 *      page or navigating away and back always feels new, at zero extra
 *      YouTube quota cost, since only the ORDER is randomized per request,
 *      never the underlying fetch.
 *
 * Degrades gracefully (empty feed, not an error) if YOUTUBE_API_KEY isn't set.
 */

const https  = require('https');
const cache  = require('./cache');
const { detectSport } = require('./bracketMath');

const YOUTUBE_API_KEY = () => (process.env.YOUTUBE_API_KEY || '').trim();

/* Pool refreshes every 6h — shuffling on every request already makes revisits
   feel fresh long before the underlying pool itself needs new videos. */
const POOL_CACHE_TTL = 6 * 3600;
const MAX_RESULTS_PER_TOPIC = 25;

setImmediate(() => {
  console.log(`[ClubsFeed] YOUTUBE_API_KEY ${YOUTUBE_API_KEY() ? '✓ set' : '✗ missing'}`);
});

/* ── HTTP helper (same shape as newsFeed.service.js) ── */
function httpsGet(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 8000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ ok: true, data: JSON.parse(body) }); }
        catch { resolve({ ok: false, data: null }); }
      });
    });
    req.on('error',   () => resolve({ ok: false, data: null }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, data: null }); });
  });
}

/* ── Topic derivation ── */
const SPORT_QUERY = {
  basketball: 'basketball highlights skills training drills',
  football:   'football highlights skills training drills',
  cricket:    'cricket highlights skills training drills',
  badminton:  'badminton highlights skills training drills',
  volleyball: 'volleyball highlights skills training drills',
  kabaddi:    'kabaddi highlights skills training',
};

/* [name pattern, search topic] — checked in order, first match wins */
const CLUB_TYPE_KEYWORDS = [
  [/photo/i,                          'photography tutorial tips'],
  [/danc/i,                           'dance tutorial choreography'],
  [/music|band|choir/i,               'music tutorial performance'],
  [/cod(e|ing)|programming|dev/i,     'programming tutorial coding tips'],
  [/robot/i,                          'robotics projects tutorial'],
  [/debat/i,                          'debate skills public speaking'],
  [/drama|theatre|theater/i,          'theatre acting tutorial'],
  [/\bart\b|painting|sketch/i,        'art tutorial painting techniques'],
  [/quiz/i,                           'quiz general knowledge facts'],
  [/literary|writing|literature/i,    'creative writing tips'],
  [/entrepreneur|business/i,          'entrepreneurship business tips'],
  [/environment|eco\b/i,              'environment sustainability tips'],
  [/yoga|fitness|gym/i,               'fitness workout tips'],
  [/chess/i,                          'chess strategy tutorial'],
];

const CATEGORY_FALLBACK = {
  sports:   'sports highlights training tips',
  cultural: 'cultural arts performance tutorial',
  academic: 'academic skills learning tips',
  social:   'community service volunteering',
};

function topicForClub(club) {
  if (club.category === 'sports') {
    const sport = detectSport(club.name);
    if (SPORT_QUERY[sport]) return SPORT_QUERY[sport];
  }
  for (const [pattern, topic] of CLUB_TYPE_KEYWORDS) {
    if (pattern.test(club.name)) return topic;
  }
  return CATEGORY_FALLBACK[club.category] || `${club.name} club activities highlights`;
}

/* ── YouTube fetch, cached per topic ── */
async function fetchPoolForTopic(topic) {
  const cacheKey = `clubsfeed:pool:${topic}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const key = YOUTUBE_API_KEY();
  if (!key) return [];

  const url =
    `https://www.googleapis.com/youtube/v3/search` +
    `?part=snippet&type=video` +
    `&q=${encodeURIComponent(topic)}` +
    `&maxResults=${MAX_RESULTS_PER_TOPIC}&relevanceLanguage=en&safeSearch=strict` +
    `&key=${encodeURIComponent(key)}`;

  const { ok, data } = await httpsGet(url);

  if (!ok) {
    console.warn('[ClubsFeed] YouTube network error — check connectivity');
    return [];
  }
  if (data?.error) {
    console.warn('[ClubsFeed] YouTube API error:', data.error.code, data.error.message);
    return [];
  }
  if (!data?.items) return [];

  const videos = data.items
    .filter((v) => v.id?.videoId && v.snippet?.title)
    .map((v) => ({
      id:          v.id.videoId,
      videoId:     v.id.videoId,
      title:       v.snippet.title,
      description: v.snippet.description || '',
      image:
        v.snippet.thumbnails?.high?.url   ||
        v.snippet.thumbnails?.medium?.url ||
        v.snippet.thumbnails?.default?.url || null,
      channel:     v.snippet.channelTitle || 'YouTube',
      publishedAt: v.snippet.publishedAt,
    }));

  await cache.set(cacheKey, videos, POOL_CACHE_TTL);
  return videos;
}

/* Fisher-Yates — uniform shuffle, done fresh on every call */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── Main export ──
   Returns { videos, topics, apiKeySet }. videos are pre-shuffled — callers
   should render them in the order given, not re-sort. */
async function buildClubsFeed(clubs) {
  const apiKeySet = !!YOUTUBE_API_KEY();
  if (!clubs.length) return { videos: [], topics: [], apiKeySet };

  const topics = [...new Set(clubs.map(topicForClub))];
  const pools  = await Promise.all(topics.map(fetchPoolForTopic));

  const seen = new Set();
  const all  = [];
  pools.forEach((pool, i) => {
    pool.forEach((v) => {
      if (seen.has(v.videoId)) return;
      seen.add(v.videoId);
      all.push({ ...v, topic: topics[i] });
    });
  });

  return { videos: shuffle(all), topics, apiKeySet };
}

module.exports = { buildClubsFeed };
