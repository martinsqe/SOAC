/**
 * aiTopic.js
 *
 * AI-refined search-topic generation for the Clubs Feed algorithm.
 *
 * clubsFeed.service.js's topicForClub() derives a YouTube search query from
 * a club's tags via simple string concatenation ("Basketball | Fitness
 * highlights tutorial tips"). That's mechanical — it can't read the club's
 * description/vision for nuance a coordinator wrote in prose (e.g. a club
 * that's really about competitive tournament prep vs. casual pickup games,
 * both tagged "Basketball"). This module asks Claude to read the club's full
 * profile and write a sharper query instead.
 *
 * Model choice: Claude Haiku 4.5. This is a one-shot "read a short profile,
 * write one line" task with no reasoning chain, tool use, or agentic loop —
 * exactly the "simplest tier" case (see claude-api skill). It also only ever
 * runs once per club (~40 clubs total) since the result is cached for 30
 * days below, so model cost is a non-issue either way, but Haiku is the
 * right-sized tool for the job and returns in well under a second.
 *
 * Degrades to null (never throws) if ANTHROPIC_API_KEY isn't set or the API
 * call fails for any reason — callers fall back to the rule-based topic.
 */

const cache = require('./cache');

const ANTHROPIC_API_KEY = () => (process.env.ANTHROPIC_API_KEY || '').trim();

/* Cached per club for 30 days — a club's description/tags/vision rarely
   change, and re-running the model on every request would be both wasteful
   and pointless (the same input always deserves the same query). */
const AI_TOPIC_CACHE_TTL = 30 * 24 * 3600;
const MODEL = 'claude-haiku-4-5';

let client = null;
let clientInitAttempted = false;

function getClient() {
  if (clientInitAttempted) return client;
  clientInitAttempted = true;
  const key = ANTHROPIC_API_KEY();
  if (!key) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey: key });
  } catch (err) {
    console.error('[aiTopic] failed to init Anthropic client:', err.message);
    client = null;
  }
  return client;
}

setImmediate(() => {
  console.log(`[aiTopic] ANTHROPIC_API_KEY ${ANTHROPIC_API_KEY() ? '✓ set' : '✗ missing — using rule-based topics only'}`);
});

const SYSTEM_PROMPT =
  'You write a single, focused YouTube search query that will surface the best ' +
  'highlight, tutorial, and skills-training videos for a specific student club. ' +
  'Read the club profile and identify what it is actually about — not just its ' +
  'category. Respond with ONLY the search query text, nothing else: no quotes, ' +
  'no explanation, no punctuation wrapper. Keep it to 4-8 words, written the way ' +
  'someone would actually type it into YouTube search.';

function buildUserPrompt(club) {
  const lines = [
    `Club name: ${club.name}`,
    `Category: ${club.category}`,
  ];
  if (club.tags?.length) lines.push(`Tags: ${club.tags.join(', ')}`);
  if (club.description) lines.push(`Description: ${club.description}`);
  if (club.vision) lines.push(`Vision: ${club.vision}`);
  return lines.join('\n');
}

/**
 * generateAiTopic(club) → Promise<string|null>
 * club needs at least { id, name, category }; tags/description/vision
 * improve quality when present. Returns null (never throws) on any failure
 * or when ANTHROPIC_API_KEY is unset.
 */
async function generateAiTopic(club) {
  if (!club?.id) return null;

  const cacheKey = `clubsfeed:aitopic:${club.id}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const anthropic = getClient();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 40,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(club) }],
    });

    const text = response.content
      ?.find((b) => b.type === 'text')
      ?.text?.trim();

    if (!text) return null;

    await cache.set(cacheKey, text, AI_TOPIC_CACHE_TTL);
    return text;
  } catch (err) {
    console.error(`[aiTopic] generation failed for club ${club.id}:`, err.message);
    return null;
  }
}

module.exports = { generateAiTopic };
