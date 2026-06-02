import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/portview/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
      },
      manifest: {
        name: 'PortView',
        short_name: 'PortView',
        description: '개인용 투자 포트폴리오 관리 앱',
        theme_color: '#071426',
        background_color: '#071426',
        lang: 'ko',
        display: 'standalone',
        start_url: '/portview/',
        scope: '/portview/',
        icons: [
          {
            src: 'portview-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'portview-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
  },
});
