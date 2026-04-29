import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const hmr = process.env.OPENWORK_DISABLE_HMR === '1' ? false : undefined;

export default defineConfig({
  plugins: [vue()],
  server: {
    hmr,
    host: '0.0.0.0',
    port: <%= port %>,
  },
});
