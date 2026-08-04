import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectRegister: 'script',
      // vite-plugin-pwa doesn't register the SW under `vite dev` by default —
      // without this, there's no service worker at all in dev mode, which is why
      // neither the install prompt nor push subscription work there.
      devOptions: {
        enabled: true,
        type: 'module',
      },
      injectManifest: {
        injectionPoint: 'self.__WB_MANIFEST',
        // public/images has a stray unused 4MB HTML file (not referenced anywhere
        // in the app) — excluded so it never gets pulled into the SW precache.
        globIgnores: ['images/**/*.html'],
      },
      manifest: {
        name: 'SOAC RKU',
        short_name: 'SOAC',
        description: 'Student Organizations Advisory Council — RK University',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#635bff',
        icons: [
          { src: '/images/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/images/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/images/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,   // fail loudly instead of drifting to 5174/5175
    proxy: {
      '/api':     'http://localhost:5000',
      '/uploads': 'http://localhost:5000',
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
      },
    },
  },
})
