import { defineConfig } from '@playwright/test';

// 本番ビルド（npm run build）を vite preview で配り、Chrome で確かめる。
// 公開ページで確かめるときは KOE_HINAN_URL=https://ayutaz.github.io/koe-hinan/ を付ける。
const hosted = process.env.KOE_HINAN_URL;
export default defineConfig({
  testDir: './tests',
  outputDir: '.artifacts/browser',
  workers: 1,
  timeout: 300_000,
  use: {
    channel: 'chrome',
    baseURL: hosted ?? 'http://127.0.0.1:4173/koe-hinan/',
    headless: true,
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: hosted ? undefined : { command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173/koe-hinan/', reuseExistingServer: true },
});
