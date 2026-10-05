/* How students sign up for an Other Events event (events.registration_type):
     internal → SOAC's own registration form (the default, and the only mode
                Sports Fiesta / Galore events ever use)
     external → "Register" sends students to an outside website (registration_url)
     none     → announcement only: no Register button, no registrations */
const REGISTRATION_TYPES = ['internal', 'external', 'none'];

/* Same rule as payment links: a pasted link without a scheme would otherwise be
   treated as a path on our own site instead of leaving for the external page. */
const normalizeUrl = (raw) => {
  const link = String(raw || '').trim();
  if (!link) return '';
  return /^https?:\/\//i.test(link) ? link : `https://${link}`;
};

/* Validates the admin's choice → { type, url } or { error }.
   The link is kept only for external registration. */
const resolveRegistration = (rawType, rawUrl) => {
  const type = REGISTRATION_TYPES.includes(rawType) ? rawType : 'internal';
  if (type !== 'external') return { type, url: '' };

  const url = normalizeUrl(rawUrl);
  if (!url) return { error: 'Add the link to the website where students register.' };
  let parsed;
  try { parsed = new URL(url); } catch { parsed = null; }
  if (!parsed || !parsed.hostname.includes('.')) return { error: 'Enter a valid registration website link, e.g. https://example.com/register' };
  if (url.length > 1000) return { error: 'The registration link is too long.' };
  return { type, url };
};

module.exports = { REGISTRATION_TYPES, resolveRegistration };
