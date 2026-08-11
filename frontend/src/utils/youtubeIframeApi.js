/* Loads YouTube's IFrame Player API script once and resolves with window.YT.
   Using the real API (YT.Player + onReady/onStateChange callbacks) instead of
   raw postMessage guessing is what makes play/pause/mute actually reliable —
   commands sent to a raw <iframe> before its internal player signals ready
   can be silently dropped, which is why naive postMessage control is flaky. */
let apiPromise = null;

export function loadYouTubeIframeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve) => {
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevCallback?.();
      resolve(window.YT);
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return apiPromise;
}
