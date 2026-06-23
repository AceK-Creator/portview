import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
    base: '/',
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
                description: '개인용 투자 자산, 배당 관리 특화 앱',
                theme_color: '#071426',
                background_color: '#071426',
                lang: 'ko',
                display: 'standalone',
                start_url: '/',
                scope: '/',
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
