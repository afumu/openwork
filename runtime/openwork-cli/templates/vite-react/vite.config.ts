import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const hmr = process.env.OPENWORK_DISABLE_HMR === '1' ? false : undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    hmr,
    host: '0.0.0.0',
    port: <%= port %>,
  },
});
