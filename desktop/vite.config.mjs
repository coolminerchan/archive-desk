import { defineConfig } from 'vite'

export default defineConfig({
  root: 'ui',
  base: './',
  build: { outDir: '../rendered', emptyOutDir: true }
})
