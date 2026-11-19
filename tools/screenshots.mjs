// 説明資料に使う画面を撮る（スマホの幅・通信なし）。
// 使い方: npm run build && node tools/screenshots.mjs  → .artifacts/shots/*.png
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, '.artifacts/shots');
mkdirSync(out, { recursive: true });
const BASE = 'http://127.0.0.1:4175/koe-hinan/';
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], { cwd: root, shell: true, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* まだ */ } await new Promise(r => setTimeout(r, 500)); }

const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP' });
const page = await context.newPage();
await page.goto(BASE);
await page.getByRole('button', { name: '準備する' }).click();
await page.locator('#prepare-status').filter({ hasText: '準備ができました' }).waitFor({ timeout: 280_000 });
await context.setOffline(true);
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('#town option').length > 1);
await page.locator('#prepare-status').filter({ hasText: '準備ができています' }).waitFor();
await page.screenshot({ path: resolve(out, 'top.png') });

// 地図（通信なし）で石神井川の近くを押す
await page.getByRole('button', { name: '地図で選ぶ' }).click();
await page.locator('#map canvas').first().waitFor();
await page.evaluate(() => document.getElementById('where-title').scrollIntoView({ block: 'start' }));
await page.waitForTimeout(1500);
await page.screenshot({ path: resolve(out, 'map.png') });
const pt = await page.evaluate(() => {
  const p = window.koeHinan.mapPoint(35.75879, 139.628773);
  const r = document.getElementById('map').getBoundingClientRect();
  return { x: r.left + p.x, y: r.top + p.y };
});
await page.mouse.click(pt.x, pt.y);
await page.locator('#speech-status').filter({ hasText: '読み上げました' }).waitFor({ timeout: 120_000 });
await page.evaluate(() => document.getElementById('result-title').scrollIntoView({ block: 'start' }));
await page.waitForTimeout(500);
await page.screenshot({ path: resolve(out, 'result.png') });

// 町から選ぶ（谷原）
await page.locator('#town').selectOption({ label: '谷原（ヤハラ）' });
await page.locator('#speech-status').filter({ hasText: '読み上げました' }).waitFor({ timeout: 120_000 });
await page.evaluate(() => document.getElementById('result-title').scrollIntoView({ block: 'start' }));
await page.waitForTimeout(500);
await page.screenshot({ path: resolve(out, 'town.png') });

await browser.close();
server.kill();
console.log('ok');
process.exit(0);
