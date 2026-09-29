/* One-time helper: get a Gmail API refresh token for the sending account.

   1. Put GMAIL_USER, GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in backend/.env
      (OAuth client of type "Desktop app" from Google Cloud Console).
   2. Run:  node scripts/gmail-auth.js
   3. Open the printed link, sign in as GMAIL_USER and allow access.
   4. Copy the printed GMAIL_REFRESH_TOKEN into backend/.env and Railway. */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');

const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_USER } = process.env;
const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
  console.error('Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in backend/.env first.');
  process.exit(1);
}

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id:     GMAIL_CLIENT_ID,
  redirect_uri:  REDIRECT_URI,
  response_type: 'code',
  scope:         SCOPE,
  access_type:   'offline',
  prompt:        'consent', // always return a refresh token
  ...(GMAIL_USER ? { login_hint: GMAIL_USER } : {}),
});

const server = http.createServer(async (req, res) => {
  const url  = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  const err  = url.searchParams.get('error');
  if (!code && !err) { res.writeHead(404).end(); return; }

  if (err) {
    res.end(`Authorization failed: ${err}. You can close this tab.`);
    console.error(`\nAuthorization failed: ${err}`);
    server.close();
    return;
  }

  console.log('Got the authorization code from Google — exchanging it for a refresh token…');
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     GMAIL_CLIENT_ID,
        client_secret: GMAIL_CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code',
      }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.refresh_token) throw new Error(data.error_description || data.error || 'No refresh token returned');

    res.end('Done! Go back to the terminal to copy your refresh token. You can close this tab.');
    console.log('\nAdd this to backend/.env and to Railway Variables:\n');
    console.log(`GMAIL_REFRESH_TOKEN=${data.refresh_token}\n`);
  } catch (e) {
    res.end(`Token exchange failed: ${e.message}`);
    console.error(`\nToken exchange failed: ${e.message}`);
  } finally {
    server.close();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Open this link and sign in${GMAIL_USER ? ` as ${GMAIL_USER}` : ''}:\n\n${authUrl}\n`);
  console.log('Waiting for you to finish signing in in the browser (this script does nothing until then)…');
});

// Don't wait forever if the browser step never completes
setTimeout(() => {
  console.error('\nNo response from the browser after 5 minutes. Run the script again and finish the sign-in in the browser.');
  process.exit(1);
}, 5 * 60 * 1000).unref();
