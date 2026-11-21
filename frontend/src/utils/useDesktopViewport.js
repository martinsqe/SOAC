import { useEffect } from 'react';

/* While a page using this is open, a phone lays it out at `width` CSS pixels
   (the big-screen layout) and zooms it to fit the screen: the same page as on a
   computer, just smaller, with no sideways scrolling and pinch-zoom to read
   closer. Screens at least that wide are unaffected. In that mode <html> gets
   the class "galore-phone" (text a little larger so it stays readable). The
   normal viewport is put back when the page is left. */
const DEFAULT = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
const PHONE_WIDTH = 720;

/* true on a screen that gets the zoomed big-screen layout (a phone) */
export const isPhoneScreen = (width = PHONE_WIDTH) =>
  typeof window !== 'undefined' && Math.min(window.screen?.width || width, window.screen?.height || width) < width;

export default function useDesktopViewport(width = PHONE_WIDTH) {
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return undefined;
    const before = meta.getAttribute('content') || DEFAULT;
    const narrow = isPhoneScreen(width);
    if (narrow) {
      meta.setAttribute('content', `width=${width}, viewport-fit=cover`);
      document.documentElement.classList.add('galore-phone');
    }
    return () => {
      meta.setAttribute('content', before);
      document.documentElement.classList.remove('galore-phone');
    };
  }, [width]);
}
