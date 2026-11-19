import { expect, test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

// 通信のある所で「準備する」→ 通信を切って開き直す → 町を選ぶ → 案内が出て、端末の中で読み上げる。
test('準備のあと、通信なしで案内と読み上げが動く', async ({ page, context }) => {
  const metrics: Record<string, unknown> = {};
  await page.goto('./');
  await expect(page.locator('#town option')).toHaveCount(42);
  const t0 = Date.now();
  await page.getByRole('button', { name: '準備する' }).click();
  await expect(page.locator('#prepare-status')).toContainText('準備ができました。機内モード', { timeout: 280_000 });
  metrics.prepareSeconds = (Date.now() - t0) / 1000;

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#town option')).toHaveCount(42);
  await expect(page.locator('#prepare-status')).toContainText('準備ができています');

  // 谷原（やはら）の町を選ぶ → 漢字のままだと読み違える町
  await page.locator('#town').selectOption({ label: '谷原（ヤハラ）' });
  await expect(page.locator('#result')).toContainText('指定緊急避難場所で一番近いのは');
  await expect(page.locator('#speech-status')).toContainText('読み上げました', { timeout: 120_000 });
  metrics.firstSpeech = await page.locator('#speech-status').textContent();

  // 2回目以降の合成時間
  await page.locator('#town').selectOption({ label: '向山（コウヤマ）' });
  await expect(page.locator('#speech-status')).toContainText('読み上げました', { timeout: 120_000 });
  metrics.secondSpeech = await page.locator('#speech-status').textContent();
  metrics.result = await page.locator('#result').innerText();

  // 地図（背景のタイルは出ないが、浸水想定と避難場所は描ける）
  await page.getByRole('button', { name: '地図で選ぶ' }).click();
  await expect(page.locator('#map canvas').first()).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '.artifacts/offline.png', fullPage: true });

  mkdirSync('.artifacts', { recursive: true });
  writeFileSync('.artifacts/offline-metrics.json', JSON.stringify(metrics, null, 1));
});
