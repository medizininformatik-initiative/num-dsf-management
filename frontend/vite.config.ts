/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const VENDOR_CHUNKS: Record<string, string> = {
  react: 'react-vendor',
  'react-dom': 'react-vendor',
  scheduler: 'react-vendor',
  'react-router': 'react-vendor',
  'react-router-dom': 'react-vendor',
  '@remix-run/router': 'react-vendor',
  '@tanstack/react-query': 'query-vendor',
  '@tanstack/query-core': 'query-vendor',
  'react-hook-form': 'form-vendor',
  zod: 'form-vendor',
  '@hookform/resolvers': 'form-vendor',
  '@standard-schema/utils': 'form-vendor',
  sonner: 'ui-vendor',
};

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_DEMO === 'true' ? '/num-dsf-allowlist/' : '/',
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Rolldown (Vite 8) takes only the function form; each entry also
        // claims the packages the old object form pulled in as dependencies.
        manualChunks(id: string) {
          const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id)?.[1];
          if (!pkg) return undefined;
          return VENDOR_CHUNKS[pkg];
        },
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/auth': { target: 'http://backend:3000', changeOrigin: true },
      '/api': { target: 'http://backend:3000', changeOrigin: true },
    },
  },
  preview: { port: 4173, host: '0.0.0.0' },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/test-setup.ts',
        'src/api/**',
        'src/main.tsx',
        '**/*.d.ts',
      ],
      thresholds: {
        statements: 51,
        branches: 58,
        functions: 36,
        lines: 51,
      },
    },
  },
});
