import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // 'dist' is the Vite build output (untracked, deployed by CI since #97);
  // 'docs' is the legacy pre-2026-10-04 build dir, ignored in case a stale
  // local copy is still on disk.
  // 'build' is the gitignored local scratch dir (measurement probes,
  // prototype .mjs harnesses) — not project code; linting it made
  // `npm run lint` fail on whatever scratch happened to be on disk.
  globalIgnores(['dist', 'docs', 'build']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // Node measurement/test harnesses. Browser globals stay in scope too:
    // the CDP/Puppeteer harnesses serialize callbacks that run in page
    // context (window, document) from inside Node files.
    files: ['tests/**/*.{js,jsx}', 'scripts/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // AudioWorkletGlobalScope — no preset in the globals package.
    files: ['public/capture-processor.js'],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        sampleRate: 'readonly',
        currentTime: 'readonly',
      },
    },
  },
])
