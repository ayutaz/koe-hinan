import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// スマホの幅で、浸水想定区域の中の場所を「今いる場所」として案内する。読み上げた音声も保存する（動画と確認用）。
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['geolocation'], geolocation: { latitude: 35.75879, longitude: 139.628773 } });

test('スマホ: 今いる場所（石神井川の近く）で案内する', async ({ page }) => {
  mkdirSync('.artifacts', { recursive: true });
  await page.goto('./');
  await page.getByRole('button', { name: '今いる場所で案内する' }).click();
  await expect(page.locator('#result')).toContainText('洪水浸水想定区域です');
  await expect(page.locator('#speech-status')).toContainText('読み上げました', { timeout: 180_000 });
  await page.screenshot({ path: '.artifacts/mobile-result.png', fullPage: true });
  // 読み上げの文と音声を保存する
  const out = await page.evaluate(async () => {
    const w = window as unknown as { koeHinan: { evaluate: (p: { lat: number; lon: number }) => unknown; buildText: (r: unknown) => { speech: string } } };
    const r = w.koeHinan.evaluate({ lat: 35.75879, lon: 139.628773 });
    return w.koeHinan.buildText(r).speech;
  });
  writeFileSync('.artifacts/mobile-speech.txt', out);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});
