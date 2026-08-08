/* Temporary on-device diagnostic log for the push notification pipeline —
   mirrors console.log/error into localStorage so it can be read directly off
   a phone screen (via PushDebugPanel) when remote debugging isn't available.
   Capped to the most recent 60 entries. Safe to delete once push is fully
   confirmed working across all target devices. */
const KEY = 'soac_push_debug_log';
const MAX_ENTRIES = 60;

export function pushDebugLog(...args) {
  console.log(...args);
  try {
    const line = `${new Date().toLocaleTimeString()}  ${args.map(a =>
      typeof a === 'object' ? JSON.stringify(a) : String(a)
    ).join(' ')}`;
    const existing = JSON.parse(localStorage.getItem(KEY) || '[]');
    existing.push(line);
    while (existing.length > MAX_ENTRIES) existing.shift();
    localStorage.setItem(KEY, JSON.stringify(existing));
  } catch { /* logging must never break the app */ }
}

export function pushDebugError(...args) {
  console.error(...args);
  pushDebugLog('[ERROR]', ...args.map(a => (a instanceof Error ? a.message : a)));
}

export function getPushDebugLog() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function clearPushDebugLog() {
  localStorage.removeItem(KEY);
}
