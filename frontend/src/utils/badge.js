/* Badging API — the small red count on the app icon (home screen / taskbar /
   dock for an installed PWA). Chrome/Edge (desktop + installed Android PWA)
   support it; Firefox and Safari/iOS don't as of writing — this is
   progressive enhancement, so every call is wrapped and silently no-ops
   where unsupported. */
export async function syncAppBadge(count) {
  if (!('setAppBadge' in navigator)) return;
  try {
    if (count > 0) await navigator.setAppBadge(count);
    else await navigator.clearAppBadge();
  } catch { /* ignore — badge is best-effort */ }
}

/* Fetches the true unread count from the backend and applies it to the app
   icon. Call on layout mount and after marking notifications read, so the
   badge stays correct even without a push having just arrived (e.g. the user
   reopens the app after being away). */
export async function refreshAppBadge(api) {
  try {
    const { count } = await api.get('/users/me/notifications/unread-count');
    await syncAppBadge(count || 0);
  } catch { /* ignore — badge is best-effort */ }
}
