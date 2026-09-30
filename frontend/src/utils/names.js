/* A person's name without leading titles (Prof., Dr., Mr., …). Used when a name
   is filled in automatically — e.g. from an existing account while assigning
   club staff — so a plain name is shown unless the admin types a title. */
const TITLES = /^\s*(?:(?:prof(?:essor)?|dr|mr|mrs|ms|miss)\.?\s+)+/i;

export const plainName = (name = '') => String(name).replace(TITLES, '').trim();
