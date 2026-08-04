import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main:  'index.html',
        login: 'login.html',
      },
    },
  },
  publicDir: 'public',
});
