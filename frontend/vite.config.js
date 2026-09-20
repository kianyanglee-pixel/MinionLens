import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000', // Change to your Flask port (e.g., 5000 or 8000)
        changeOrigin: true,
        secure: false,
      },
    },
  },
});