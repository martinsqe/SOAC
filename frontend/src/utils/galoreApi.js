/* Galore portal API — its own token (soac_galore_token), never the club login's
   (soac_token), so logging in or out of one never touches the other. */
const TOKEN_KEY = 'soac_galore_token';

export const galoreToken = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage blocked */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ } },
};

async function request(method, path, body) {
  const token = galoreToken.get();
  const isForm = body instanceof FormData;
  const res = await fetch(`/api/galore-portal${path}`, {
    method,
    headers: {
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'Something went wrong. Please try again.');
    err.status = res.status;
    throw err;
  }
  /* A password change signs out older sessions and hands back a fresh token */
  if (data.token && path === '/change-password') galoreToken.set(data.token);
  return data;
}

export const galoreApi = {
  get:      (path)       => request('GET', path),
  post:     (path, body) => request('POST', path, body || {}),
  put:      (path, body) => request('PUT', path, body || {}),
  patch:    (path, body) => request('PATCH', path, body || {}),
  postForm: (path, fd)   => request('POST', path, fd),
};
