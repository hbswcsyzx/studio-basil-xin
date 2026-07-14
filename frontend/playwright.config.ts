import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: process.env.STUDIO_E2E_URL ?? 'http://127.0.0.1:8788',
    channel: 'chrome',
    screenshot: 'only-on-failure',
  },
  outputDir: './test-results',
})

