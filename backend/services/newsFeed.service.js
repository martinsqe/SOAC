/**
 * newsFeed.service.js
 *
 * Fetches and merges news articles (NewsAPI) and YouTube videos
 * that are relevant to the student's joined clubs.
 *
 * Algorithm:
 *   1. Map each club's name + category + tags → search queries
 *   2. Fetch news + videos in parallel (one batched query per source)
 *   3. Score each item: recency (0-100) + keyword relevance (+5-30/match)
 *   4. Deduplicate by URL, sort by score DESC, cache 30 min
 *
 * Both API keys are optional — the feed degrades gracefully if either
 * (or both) keys are missing.
 */

const https  = require('https');
const cache  = require('./cache');

/* Trim so a stray space in .env (" abc") never breaks the key */
const NEWS_API_KEY    = () => (process.env.NEWS_API_KEY    || '').trim();
const YOUTUBE_API_KEY = () => (process.env.YOUTUBE_API_KEY || '').trim();

const FEED_CACHE_TTL = 1800; // 30 minutes

/* Log key status once on boot so you can see immediately in server output */
setImmediate(() => {
  const n = NEWS_API_KEY()    ? '✓ set' : '✗ missing';
  const y = YOUTUBE_API_KEY() ? '✓ set' : '✗ missing';
  console.log(`[NewsFeed] NEWS_API_KEY ${n}  |  YOUTUBE_API_KEY ${y}`);
});

/* ── Category → keyword bundles ──────────────────────────────────────────── */
const CATEGORY_KEYWORDS = {
  tech:      ['technology', 'programming', 'artificial intelligence', 'software engineering', 'innovation'],
  sports:    ['sports', 'athletics', 'fitness', 'cricket', 'football', 'competition'],
  cultural:  ['culture', 'arts', 'music', 'dance', 'heritage', 'film'],
  health:    ['health', 'wellness', 'nutrition', 'medicine', 'mental health'],
  community: ['community service', 'environment', 'social impact', 'sustainability', 'volunteering'],
};

/* ── HTTP helper ─────────────────────────────────────────────────────────── */
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

/* ── Query builder ───────────────────────────────────────────────────────── */
/**
 * Produces an array of search strings from the student's clubs.
 * Strategy:
 *   - Club name itself (most specific)
 *   - 2 category keywords joined with OR
 *   - Any club tags (up to 2 per club)
 * Capped at 6 total to avoid burning API quota.
 */
function buildQueries(clubs) {
  const seen    = new Set();
  const queries = [];

  const push = (q) => {
    const key = q.toLowerCase().trim();
    if (key && !seen.has(key)) { seen.add(key); queries.push(q); }
  };

  for (const club of clubs) {
    push(club.name);

    const catWords = CATEGORY_KEYWORDS[club.category] || [];
    if (catWords.length >= 2) push(`${catWords[0]} OR ${catWords[1]}`);

    const tags = (club.tags || []).filter((t) => t && t.length > 3);
    tags.slice(0, 2).forEach(push);
  }

  return queries.slice(0, 6);
}

/* ── NewsAPI fetch ───────────────────────────────────────────────────────── */
async function fetchNews(queries) {
  const key = NEWS_API_KEY();
  if (!key) return [];

  const q   = queries.map((q) => `(${q})`).join(' OR ');
  const url =
    `https://newsapi.org/v2/everything` +
    `?q=${encodeURIComponent(q)}` +
    `&pageSize=20&sortBy=publishedAt&language=en` +
    `&apiKey=${encodeURIComponent(key)}`;

  const { ok, data } = await httpsGet(url);

  if (!ok) {
    console.warn('[NewsFeed] NewsAPI network error — check connectivity');
    return [];
  }
  if (data?.status !== 'ok') {
    console.warn('[NewsFeed] NewsAPI error:', data?.code, data?.message);
    return [];
  }

  return (data.articles || [])
    .filter((a) => a.title && a.title !== '[Removed]' && a.url)
    .map((a) => ({
      id:          'news_' + Buffer.from(a.url).toString('base64').slice(0, 20),
      type:        'news',
      title:       a.title,
      description: a.description || '',
      url:         a.url,
      image:       a.urlToImage  || null,
      source:      a.source?.name || 'News',
      publishedAt: a.publishedAt,
      author:      a.author      || null,
    }));
}

/* ── YouTube Data API fetch ──────────────────────────────────────────────── */
async function fetchVideos(queries) {
  const key = YOUTUBE_API_KEY();
  if (!key) return [];

  const q   = queries.slice(0, 3).join(' | ');
  const url =
    `https://www.googleapis.com/youtube/v3/search` +
    `?part=snippet&type=video` +
    `&q=${encodeURIComponent(q)}` +
    `&maxResults=12&order=date&relevanceLanguage=en` +
    `&key=${encodeURIComponent(key)}`;

  const { ok, data } = await httpsGet(url);

  if (!ok) {
    console.warn('[NewsFeed] YouTube network error — check connectivity');
    return [];
  }
  if (data?.error) {
    console.warn('[NewsFeed] YouTube API error:', data.error.code, data.error.message);
    return [];
  }
  if (!data?.items) {
    console.warn('[NewsFeed] YouTube returned unexpected response:', JSON.stringify(data).slice(0, 200));
    return [];
  }

  return (data.items || [])
    .filter((v) => v.id?.videoId && v.snippet?.title)
    .map((v) => ({
      id:          'video_' + v.id.videoId,
      type:        'video',
      title:       v.snippet.title,
      description: v.snippet.description || '',
      url:         `https://www.youtube.com/watch?v=${v.id.videoId}`,
      image:
        v.snippet.thumbnails?.high?.url   ||
        v.snippet.thumbnails?.medium?.url ||
        v.snippet.thumbnails?.default?.url || null,
      source:      v.snippet.channelTitle || 'YouTube',
      publishedAt: v.snippet.publishedAt,
      videoId:     v.id.videoId,
    }));
}

/* ── Scoring ─────────────────────────────────────────────────────────────── */
/**
 * Score an item based on:
 *  - Recency    (0-100 pts)
 *  - Relevance  (+5-30 per keyword hit in title/description)
 *
 * Higher score = ranked earlier in the feed.
 */
function scoreItem(item, clubs) {
  let score = 0;

  /* Recency */
  const ageMs = Date.now() - new Date(item.publishedAt).getTime();
  const hours = ageMs / 3_600_000;
  if      (hours <   6) score += 100;
  else if (hours <  24) score +=  75;
  else if (hours <  72) score +=  50;
  else if (hours < 168) score +=  25;
  else                  score +=   5;

  /* Relevance: check title + description against club keywords */
  const titleLower = (item.title       || '').toLowerCase();
  const descLower  = (item.description || '').toLowerCase();

  for (const club of clubs) {
    /* Club name words (skip short words like "of", "the") */
    const nameWords = club.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    for (const word of nameWords) {
      if (titleLower.includes(word)) score += 30;
      if (descLower.includes(word))  score += 10;
    }

    /* Category keywords */
    const catWords = CATEGORY_KEYWORDS[club.category] || [];
    for (const kw of catWords.slice(0, 3)) {
      const kwLower = kw.toLowerCase();
      if (titleLower.includes(kwLower)) score += 15;
      if (descLower.includes(kwLower))  score +=  5;
    }

    /* Tags */
    for (const tag of (club.tags || []).slice(0, 3)) {
      const tagLower = (tag || '').toLowerCase();
      if (tagLower.length > 3 && titleLower.includes(tagLower)) score += 10;
    }
  }

  return score;
}

/* ── Main export ─────────────────────────────────────────────────────────── */
/**
 * buildFeed(clubs)
 *
 * Returns { items, queries, apiStatus } where:
 *   items     – sorted, deduplicated feed items
 *   queries   – the search strings that were used (for UI transparency)
 *   apiStatus – { news: bool, youtube: bool } indicating which APIs are active
 */
async function buildFeed(clubs) {
  const hasNewsKey    = !!NEWS_API_KEY();
  const hasYoutubeKey = !!YOUTUBE_API_KEY();

  if (!clubs.length) {
    return { items: [], queries: [], apiStatus: { news: hasNewsKey, youtube: hasYoutubeKey } };
  }

  /* Cache key: sorted club IDs so order doesn't matter */
  const clubKey  = clubs.map((c) => c.id).sort().join('-');
  const cacheKey = `newsfeed:${clubKey}`;
  const cached   = await cache.get(cacheKey);
  if (cached) return cached;

  const queries = buildQueries(clubs);

  /* Fetch both sources in parallel */
  const [newsItems, videoItems] = await Promise.all([
    fetchNews(queries),
    fetchVideos(queries),
  ]);

  /* Deduplicate by URL */
  const seen = new Set();
  const all  = [...newsItems, ...videoItems].filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });

  /* Score → sort */
  all.sort((a, b) => scoreItem(b, clubs) - scoreItem(a, clubs));

  const result = {
    items:     all,
    queries,
    apiStatus: { news: hasNewsKey, youtube: hasYoutubeKey },
  };

  await cache.set(cacheKey, result, FEED_CACHE_TTL);
  return result;
}

module.exports = { buildFeed };
