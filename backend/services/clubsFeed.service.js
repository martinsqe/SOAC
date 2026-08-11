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
const { generateAiTopic } = require('./aiTopic');

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

const CATEGORY_FALLBACK = {
  sports:   'sports highlights training tips',
  cultural: 'cultural arts performance tutorial',
  academic: 'academic skills learning tips',
  social:   'community service volunteering',
};

/* Every real club on this platform is coordinator-tagged with 4-5 precise
   keywords (e.g. IoT Club → "IoT, Arduino, Raspberry Pi, Embedded, Smart
   Systems"; Webify → "Web Dev, React, Node.js, UI/UX, Full Stack") — this is
   a far more reliable topic signal than guessing from the club's name, which
   can be branded/non-descriptive (e.g. "IRONCREED" is tagged "Basketball,
   Fitness..." with nothing in the name itself suggesting either). Tags are
   the primary source; name/category-based detection only covers the
   defensive case of a club somehow having none set. */
function ruleBasedTopic(club) {
  const tags = (club.tags || []).filter(Boolean);
  if (tags.length > 0) {
    /* Primary tag drives relevance; OR-ing in the second broadens recall
       without diluting specificity the way combining 3+ tags as one
       AND-ish query would (risks zero results for less common combos). */
    const core = tags.length > 1 ? `${tags[0]} | ${tags[1]}` : tags[0];
    return `${core} highlights tutorial tips`;
  }

  if (club.category === 'sports') {
    const sport = detectSport(club.name);
    if (SPORT_QUERY[sport]) return SPORT_QUERY[sport];
  }
  return CATEGORY_FALLBACK[club.category] || `${club.name} club activities highlights`;
}

/* AI-refined topic first (Claude reads the club's full description/vision/
   tags for nuance the rule-based version can't see — see aiTopic.js), with
   the rule-based derivation as a safety net if the AI is unconfigured, still
   warming its cache, or fails for any reason. Cached per club for 30 days,
   so this only actually calls the model once per club, ever. */
async function topicForClub(club) {
  const aiTopic = await generateAiTopic(club);
  return aiTopic || ruleBasedTopic(club);
}

/* YouTube's search API mixes in Shorts (sub-60s vertical clips) by default,
   and they dominate relevance ranking for exactly these training/highlight
   keywords — which is why the feed was showing almost nothing else. Fetching
   "medium" (4-20 min, real highlight reels/tutorials) and "long" (20 min+,
   full games/matches) explicitly excludes Shorts entirely (anything under
   4 minutes never appears in either bucket), and covers both what "NBA
   highlights" and "full NBA games" actually mean length-wise. Two calls per
   topic instead of one — still well within quota given the 6h cache. */
const VIDEO_DURATIONS = ['medium', 'long'];

async function fetchPoolForTopic(topic) {
  const cacheKey = `clubsfeed:pool:${topic}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const key = YOUTUBE_API_KEY();
  if (!key) return [];

  const resultsPerDuration = Math.ceil(MAX_RESULTS_PER_TOPIC / VIDEO_DURATIONS.length);

  const batches = await Promise.all(VIDEO_DURATIONS.map(async (videoDuration) => {
    const url =
      `https://www.googleapis.com/youtube/v3/search` +
      `?part=snippet&type=video` +
      `&q=${encodeURIComponent(topic)}` +
      `&videoDuration=${videoDuration}` +
      `&maxResults=${resultsPerDuration}&relevanceLanguage=en&safeSearch=strict` +
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

    return data.items
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
  }));

  const seen = new Set();
  const videos = batches.flat().filter((v) => {
    if (seen.has(v.videoId)) return false;
    seen.add(v.videoId);
    return true;
  });

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

/* Shown to every student alongside their club-specific topics, regardless of
   which clubs they're in — but deliberately kept to a small handful of
   videos (see MAX_UNIVERSAL_VIDEOS below), never a full equal-weight topic.
   The feed's job is making a student love THEIR specific club (basketball
   drills, BHASHA debate content, IoT projects, Android tutorials, whatever
   it is) — teamwork/club-value content is a light seasoning, not the meal. */
const UNIVERSAL_TOPICS = ['teamwork, collaboration, and being a valuable club member'];
const MAX_UNIVERSAL_VIDEOS = 2;

/* How many videos a topic contributes to the final feed, before engagement
   weighting. Topics the student has actually watched more of scale this up
   (see engagementWeight), so "show more of what they're into" doesn't
   require any extra YouTube quota — it's a selection choice over the same
   cached pool, not a new fetch. */
const BASE_TAKE_PER_TOPIC = 6;
const MAX_ENGAGEMENT_MULTIPLIER = 3; // an extremely-watched topic caps at 3x representation

/* Random sample of `count` items from `pool` without replacement — used
   instead of taking the pool's first N so which videos surface still varies
   across requests even within one topic. */
function sampleWithoutReplacement(pool, count) {
  if (count >= pool.length) return pool.slice();
  const shuffled = shuffle(pool);
  return shuffled.slice(0, count);
}

/* Engagement score (total watched seconds on this topic) → a soft,
   diminishing-returns multiplier on how many of that topic's videos appear.
   log-scaled so an early burst of watching doesn't instantly max out, and
   capped so one topic can never fully crowd out a student's other clubs. */
function engagementWeight(watchedSeconds) {
  if (!watchedSeconds) return 1;
  const bonus = Math.log10(1 + watchedSeconds / 60); // ~0 at 0s, ~1 at 9min, ~2 at 99min
  return Math.min(MAX_ENGAGEMENT_MULTIPLIER, 1 + bonus);
}

/* ── Main export ──
   Returns { videos, topics, apiKeySet }. videos are pre-shuffled — callers
   should render them in the order given, not re-sort.
   @param {Array} clubs
   @param {Object<string,number>} [engagementByTopic] — total watched seconds
     per topic for this student, from clubsFeedEngagement.service.js. Videos
     from topics they've engaged with more get proportionally more
     representation in the feed. */
async function buildClubsFeed(clubs, engagementByTopic = {}) {
  const apiKeySet = !!YOUTUBE_API_KEY();
  if (!clubs.length) return { videos: [], topics: [], apiKeySet };

  const clubTopics = [...new Set(await Promise.all(clubs.map(topicForClub)))];
  const allTopics   = [...new Set([...clubTopics, ...UNIVERSAL_TOPICS])];
  const pools       = await Promise.all(allTopics.map(fetchPoolForTopic));

  const seen = new Set();
  const selected = [];

  pools.forEach((pool, i) => {
    const topic = allTopics[i];
    const isUniversal = UNIVERSAL_TOPICS.includes(topic);
    const take = isUniversal
      ? MAX_UNIVERSAL_VIDEOS
      : Math.round(BASE_TAKE_PER_TOPIC * engagementWeight(engagementByTopic[topic]));

    for (const v of sampleWithoutReplacement(pool, take)) {
      if (seen.has(v.videoId)) continue;
      seen.add(v.videoId);
      selected.push({ ...v, topic });
    }
  });

  return { videos: shuffle(selected), topics: clubTopics, apiKeySet };
}

module.exports = { buildClubsFeed };
