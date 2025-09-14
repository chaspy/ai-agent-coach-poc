import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5179,
    proxy: {
      '/agent': {
        target: 'http://localhost:4120',
        changeOrigin: true,
      },
      '/agent-lg': {
        target: 'http://localhost:4121',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/agent-lg/, '/agent'),
      },
      '/agent-oa': {
        target: 'http://localhost:4122',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/agent-oa/, '/agent'),
      },
    },
  },
});
