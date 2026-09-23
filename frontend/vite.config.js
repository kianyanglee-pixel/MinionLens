import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'https://your-backend.onrender.com', // Change to your Flask port (e.g., 5000 or 8000)
        changeOrigin: true,
        secure: false,
      },
    },
  },
});