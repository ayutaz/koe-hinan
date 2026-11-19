// デモ動画を自動で録る。画面は Playwright で録画し、読み上げの音声は同じ文をブラウザの中で合成して、あとで重ねる。
// 使い方: npm run build && node tools/record_demo.mjs && uv run --no-project python tools/compose_demo.py
//   公開ページで録るときは KOE_HINAN_URL=https://ayutaz.github.io/koe-hinan/ を付ける
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, '.artifacts/demo');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const hosted = process.env.KOE_HINAN_URL;
const BASE = hosted ?? 'http://127.0.0.1:4174/koe-hinan/';
let server;
if (!hosted) {
  server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { cwd: root, shell: true, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* まだ */ } await new Promise(r => setTimeout(r, 500)); }
}

const SCENES = {
  town: { label: '谷原（ヤハラ）' },
  map: { lat: 35.75879, lon: 139.628773 },
  compare: ['谷原小学校、向山小学校、小竹小学校、豊玉中学校。', 'ヤワラショウガッコウ、コウヤマショウガッコウ、コタケショウガッコウ、トヨタマチュウガッコウ。'],
};
const wavSeconds = b64 => { const b = Buffer.from(b64, 'base64'); return b.readUInt32LE(40) / b.readUInt32LE(28); };

const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });

// 1) 録画の前に、案内の文と音声を用意する（録画しない別のページで）
const prep = await browser.newContext();
const p0 = await prep.newPage();
await p0.goto(BASE);
await p0.waitForFunction(() => document.querySelectorAll('#town option').length > 1);
const clips = await p0.evaluate(async ({ SCENES }) => {
  const k = window.koeHinan;
  const towns = await (await fetch('data/towns.json')).json();
  const t = towns.find(x => `${x.town}（${x.kana}）` === SCENES.town.label);
  const townSpeech = k.buildText(k.evaluate({ lat: t.lat, lon: t.lon })).speech;
  const mapSpeech = k.buildText(k.evaluate(SCENES.map)).speech;
  return {
    town: { text: townSpeech, wav: await k.synthWav(townSpeech) },
    map: { text: mapSpeech, wav: await k.synthWav(mapSpeech) },
    raw: { text: SCENES.compare[0], wav: await k.synthWav(SCENES.compare[0]) },
    kana: { text: SCENES.compare[1], wav: await k.synthWav(SCENES.compare[1]) },
  };
}, { SCENES });
await prep.close();
for (const [name, c] of Object.entries(clips)) { c.seconds = wavSeconds(c.wav); writeFileSync(resolve(out, `${name}.wav`), Buffer.from(c.wav, 'base64')); delete c.wav; }

// 2) 録画
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } } });
// 画面の文字を大きくした状態（アプリの「文字を大きく」）で録る
await context.addInitScript(() => { try { localStorage.setItem('koe-hinan:large', '1'); } catch { /* なし */ } });
const page = await context.newPage();
const t0 = Date.now();
const timeline = [];
const now = () => (Date.now() - t0) / 1000;
const sleep = ms => page.waitForTimeout(ms);

const overlay = async (title, sub = '', full = false) => page.evaluate(([title, sub, full]) => {
  let el = document.getElementById('demo-caption');
  if (!el) {
    el = document.createElement('div');
    el.id = 'demo-caption';
    document.body.append(el);
  }
  el.style.cssText = full
    ? 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:18px;background:#0b4f8a;color:#fff;font:bold 40px/1.4 system-ui,"Noto Sans JP",sans-serif;text-align:center;padding:40px'
    : 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:rgba(10,20,30,.86);color:#fff;font:bold 28px/1.45 system-ui,"Noto Sans JP",sans-serif;text-align:center;padding:16px 28px';
  el.innerHTML = '';
  const a = document.createElement('div'); a.textContent = title; el.append(a);
  if (sub) { const b = document.createElement('div'); b.textContent = sub; b.style.cssText = `font-weight:normal;font-size:${full ? 24 : 20}px;opacity:.92;white-space:pre-line`; el.append(b); }
  el.hidden = !title;
}, [title, sub, full]);
const hideOverlay = () => page.evaluate(() => { const el = document.getElementById('demo-caption'); if (el) el.hidden = true; });
const scrollTo = sel => page.evaluate(s => document.querySelector(s)?.scrollIntoView({ block: 'start' }), sel);

await page.goto(BASE);
await overlay('声の避難ガイド', '圏外でも地名を正しく読む（練馬区・洪水）\nスマートフォンのブラウザの中だけで、浸水の想定と近くの避難場所を声で伝えます', true);
await sleep(6000);
await overlay('1. 最初に一度だけ「準備する」', 'アプリ・避難場所と浸水想定のデータ・声を、端末にためます');
await page.getByRole('button', { name: '準備する' }).click();
await page.locator('#prepare-status').filter({ hasText: '準備ができました' }).waitFor({ timeout: 280_000 });
await sleep(2500);

await overlay('2. 通信を切ります', '機内モード・圏外と同じ状態にして、ページを開き直します');
await sleep(3000);
await context.setOffline(true);
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('#town option').length > 1);
await overlay('通信なし：準備したデータと声だけで動きます', '');
await page.locator('#prepare-status').filter({ hasText: '準備ができています' }).waitFor();
await sleep(3500);

await overlay('3. 町から選ぶ：谷原（やはら）', '');
await scrollTo('#where-title');
await sleep(1500);
await page.locator('#town').selectOption({ label: SCENES.town.label });
await page.locator('#result').filter({ hasText: '一番近いのは' }).waitFor();
await sleep(800);
await scrollTo('#speech-status');
await overlay('案内を、端末の中で作った声で読み上げます', '一覧の谷原小学校は、町名（やはら）と違い「やわら」と読みます');
await page.locator('#speech-status').filter({ hasText: '読み上げています' }).waitFor({ timeout: 120_000 });
timeline.push({ clip: 'town', at: now() });
await sleep(clips.town.seconds * 1000 + 1500);

await overlay('4. 地図で選ぶ：石神井川の近く', '通信がないので背景の地図は出ませんが、浸水想定（青）と避難場所（点）は出ます');
await page.getByRole('button', { name: '地図で選ぶ' }).click();
await page.locator('#map canvas').first().waitFor();
await scrollTo('#map');
await sleep(2500);
const pt = await page.evaluate(({ lat, lon }) => {
  const p = window.koeHinan.mapPoint(lat, lon);
  const r = document.getElementById('map').getBoundingClientRect();
  return { x: r.left + p.x, y: r.top + p.y };
}, SCENES.map);
await page.mouse.click(pt.x, pt.y);
await page.locator('#result').filter({ hasText: '洪水浸水想定区域です' }).waitFor();
await overlay('浸水の想定の深さと、洪水に指定された近くの避難場所', '');
await page.locator('#speech-status').filter({ hasText: '読み上げています' }).waitFor({ timeout: 120_000 });
timeline.push({ clip: 'map', at: now() });
await sleep(clips.map.seconds * 1000 + 1500);

await overlay('5. なぜ読み仮名を整えるのか', '施設名を漢字のまま音声合成に渡すと…', true);
await sleep(3500);
await overlay('漢字のまま', SCENES.compare[0], true);
await sleep(800);
timeline.push({ clip: 'raw', at: now() });
await sleep(clips.raw.seconds * 1000 + 1200);
await overlay('読み仮名で（練馬区のオープンデータを突き合わせて作成）', SCENES.compare[1], true);
await sleep(800);
timeline.push({ clip: 'kana', at: now() });
await sleep(clips.kana.seconds * 1000 + 1200);
await overlay('漢字のままでは、163か所のうち29か所で読みが変わりました', '小竹→こだけ・向山→むかいやま・谷原→たにはら・豊玉中学校→とよたまなかがっこう など（piper-plus の読みで比較）', true);
await sleep(7000);
await overlay('声の避難ガイド（練馬区・洪水）', 'https://ayutaz.github.io/koe-hinan/\n声: Piper Plus:つくよみちゃん／データ: 練馬区・国土地理院・国土交通省・デジタル庁', true);
await sleep(6000);
const end = now();
await context.close();
await browser.close();
server?.kill();

const video = readdirSync(out).find(f => f.endsWith('.webm'));
renameSync(resolve(out, video), resolve(out, 'screen.webm'));
writeFileSync(resolve(out, 'timeline.json'), JSON.stringify({ end, timeline, clips }, null, 1));
console.log(JSON.stringify({ end, timeline }, null, 1));
process.exit(0);
