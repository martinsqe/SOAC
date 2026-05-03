/**
 * API Client with advanced features:
 * - Automatic JWT token refresh on 401
 * - Exponential backoff retry for 5xx errors
 * - Request deduplication for GET requests
 * - Request/response timeout
 * - Content-Type validation
 */

const BASE = '/api';
const REQUEST_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;

const getToken = () => localStorage.getItem('soac_token');
const setToken = (t) => localStorage.setItem('soac_token', t);
const clearToken = () => localStorage.removeItem('soac_token');

let isRefreshing = false;
let refreshQueue = []; // callbacks waiting for the new token
let refreshTimeout = null; // timeout to clear queue if refresh hangs

// Request deduplication cache: key -> Promise
const deduplicationCache = new Map();

/**
 * Process queued refresh callbacks
 * @param {Error|null} error - Error if refresh failed
 * @param {string|null} token - New token if refresh succeeded
 */
function processQueue(error, token) {
  if (refreshTimeout) {
    clearTimeout(refreshTimeout);
    refreshTimeout = null;
  }
  
  refreshQueue.forEach(cb => {
    if (error) {
      cb.reject(error);
    } else {
      cb.resolve(token);
    }
  });
  refreshQueue = [];
}

/**
 * Sleep for exponential backoff: 2^attempt * 100 ms
 * Max 10 seconds
 */
function exponentialBackoff(attempt) {
  const ms = Math.min(Math.pow(2, attempt) * 100, 10000);
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute fetch with timeout
 */
function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
    ),
  ]);
}

/**
 * Refresh access token via /auth/refresh
 */
async function doRefresh() {
  try {
    const res = await fetchWithTimeout(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    
    const contentType = res.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      throw new Error('Invalid response from auth/refresh');
    }
    
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Session refresh failed');
    }
    
    setToken(data.accessToken);
    return data.accessToken;
  } catch (err) {
    clearToken();
    throw err;
  }
}

/**
 * Make HTTP request with auto-refresh, retry, and deduplication
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - API path
 * @param {*} body - Request body
 * @param {boolean} isFormData - Is body FormData?
 * @param {number} attempt - Current retry attempt
 */
async function request(method, path, body, isFormData = false, attempt = 0) {
  // Deduplication: deduplicate GET requests only
  const dedupeKey = method === 'GET' ? `${method}:${path}` : null;
  if (dedupeKey && deduplicationCache.has(dedupeKey)) {
    return deduplicationCache.get(dedupeKey);
  }

  const promise = _performRequest(method, path, body, isFormData, attempt);
  
  if (dedupeKey) {
    deduplicationCache.set(dedupeKey, promise);
    promise.finally(() => {
      // Clear cache entry after 100ms to allow subsequent requests
      setTimeout(() => deduplicationCache.delete(dedupeKey), 100);
    });
  }
  
  return promise;
}

/**
 * Internal: perform the actual request
 */
async function _performRequest(method, path, body, isFormData, attempt) {
  const headers = {};
  const token = getToken();
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const res = await fetchWithTimeout(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: isFormData ? body : body ? JSON.stringify(body) : undefined,
    });

    // Handle 401 Unauthorized — try refresh
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/refresh') {
      if (isRefreshing) {
        // Another refresh is in progress — wait for it
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Token refresh timeout'));
          }, 5000);
          
          refreshQueue.push({
            resolve: async (newToken) => {
              clearTimeout(timeout);
              try {
                resolve(await _performRequest(method, path, body, isFormData, 0));
              } catch (e) {
                reject(e);
              }
            },
            reject: (err) => {
              clearTimeout(timeout);
              reject(err);
            },
          });
        });
      }

      isRefreshing = true;
      try {
        await doRefresh();
        processQueue(null, getToken());
        return _performRequest(method, path, body, isFormData, 0);
      } catch (err) {
        processQueue(err, null);
        clearToken();
        // Dispatch event for AuthContext to handle logout
        window.dispatchEvent(new Event('soac:session-expired'));
        throw new Error('Session expired. Please log in again.');
      } finally {
        isRefreshing = false;
      }
    }

    // Handle 5xx errors with exponential backoff
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      await exponentialBackoff(attempt);
      return _performRequest(method, path, body, isFormData, attempt + 1);
    }

    // Validate response Content-Type
    const contentType = res.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      if (!res.ok) {
        throw new Error(`Server error (${res.status}): ${contentType ? 'Invalid response format' : 'No response'}`);
      }
    }

    const data = await res.json().catch(() => ({}));
    
    if (!res.ok) {
      throw new Error(data.message || `Request failed (${res.status})`);
    }
    
    return data;
  } catch (err) {
    // Don't retry network errors or timeouts on retry attempts that are already high
    if (attempt < MAX_RETRIES && (err.message.includes('timeout') || err.name === 'TypeError')) {
      await exponentialBackoff(attempt);
      return _performRequest(method, path, body, isFormData, attempt + 1);
    }
    throw err;
  }
}

export const api = {
  get:    (path)              => request('GET',    path),
  post:   (path, body)        => request('POST',   path, body),
  put:    (path, body)        => request('PUT',    path, body),
  patch:  (path, body)        => request('PATCH',  path, body),
  delete: (path)              => request('DELETE', path),
  postForm: (path, formData)  => request('POST',   path, formData, true),
  putForm:  (path, formData)  => request('PUT',    path, formData, true),
};

export default api;
