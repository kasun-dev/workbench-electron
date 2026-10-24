import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './', // required so the production build loads from file://
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist' },
});
