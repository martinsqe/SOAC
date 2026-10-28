const crypto = require('crypto');

/* Each kind of token gets its own signing secret, so a token minted for one
   purpose (a Galore portal login, a student-verification link) can never be
   accepted as a main SOAC login, and vice versa. A dedicated env var wins;
   otherwise the secret is derived from JWT_SECRET (one-way HMAC), so no new
   configuration is required. */
const derive = (purpose) =>
  crypto.createHmac('sha256', String(process.env.JWT_SECRET || '')).update(`soac:${purpose}`).digest('hex');

const galoreSecret      = () => process.env.GALORE_JWT_SECRET   || derive('galore');
const studentLinkSecret = () => process.env.STUDENT_LINK_SECRET || derive('student_verify');
const fileLinkSecret    = () => process.env.FILE_LINK_SECRET    || derive('file_link');

module.exports = { galoreSecret, studentLinkSecret, fileLinkSecret };
