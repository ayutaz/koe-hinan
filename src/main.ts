import 'leaflet/dist/leaflet.css';
import './style.css';
import type { Map as LeafletMap, CircleMarker, LayerGroup } from 'leaflet';
import { buildText, DEPTH, evaluate, roundDistance, type Dataset, type FloodFeature, type GuideResult, type Shelter } from './guide';
import type { Point } from './geo';
import { offlineState, registerOffline, saveVoiceOffline } from './offline';
import { lastSynthesisMilliseconds, loadVoice, speak, stopSpeech, unlockAudio } from './tts';

type Town = { town: string; kana: string; lat: number; lon: number };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const base = import.meta.env.BASE_URL;

let data: Dataset | undefined;
let dataReady: ReturnType<typeof loadData> | undefined;
let lastSpeech = '';
let map: LeafletMap | undefined;
let pin: CircleMarker | undefined;
let L: typeof import('leaflet') | undefined;

async function loadData(): Promise<{ data: Dataset; towns: Town[]; sources: { name: string; license: string; url: string }[] }> {
  const [shelters, flood, towns] = await Promise.all([
    fetch(`${base}data/shelters.json`).then(r => r.json()),
    fetch(`${base}data/flood.geojson`).then(r => r.json()),
    fetch(`${base}data/towns.json`).then(r => r.json()),
  ]);
  return { data: { shelters: shelters.shelters as Shelter[], flood: flood.features as FloodFeature[] }, towns, sources: shelters.sources };
}

function setStatus(id: string, text: string): void { $(id).textContent = text; }

async function refreshPrepared(): Promise<void> {
  const state = await offlineState();
  if (state?.shell && state.voice) setStatus('prepare-status', '準備ができています。機内モードや圏外でも使えます。');
}

async function prepare(): Promise<void> {
  const button = $<HTMLButtonElement>('prepare');
  button.disabled = true;
  try {
    setStatus('prepare-status', 'アプリとデータを保存しています…');
    await registerOffline();
    if (import.meta.env.PROD) {
      setStatus('prepare-status', '声のデータ（約40MB）を保存しています…');
      await saveVoiceOffline();
    }
    await loadVoice(message => setStatus('prepare-status', message));
    const state = await offlineState();
    setStatus('prepare-status', state?.shell && state.voice
      ? '準備ができました。機内モードや圏外でも使えます。'
      : '声の準備ができました（この環境では端末への保存を確かめられませんでした）。');
  } catch (error) {
    setStatus('prepare-status', `準備できませんでした: ${(error as Error).message}`);
  } finally {
    button.disabled = false;
  }
}

function renderResult(r: GuideResult): void {
  const text = buildText(r);
  lastSpeech = text.speech;
  $('result-card').hidden = false;
  const result = $('result');
  result.replaceChildren(...text.display.map(line => Object.assign(document.createElement('p'), { textContent: line })));
  if (r.depth) {
    const badge = Object.assign(document.createElement('p'), { className: `badge rank${r.depth.rank}`, textContent: `浸水の想定 ${DEPTH[r.depth.rank].text}（${r.depth.river}）` });
    result.prepend(badge);
  }
  const list = $('nearby');
  list.replaceChildren(...(r.outsideArea ? [] : r.nearest.map(n => {
    const li = document.createElement('li');
    const d = roundDistance(n.meters);
    const name = Object.assign(document.createElement('strong'), { textContent: n.shelter.name });
    const kana = Object.assign(document.createElement('span'), { className: 'kana', textContent: `（${n.shelter.kana}）` });
    const meta = Object.assign(document.createElement('span'), {
      className: 'meta',
      textContent: `${n.direction.text}へ直線 約${d.text}・${n.shelter.address}${n.shelter.capacity ? `・想定収容 ${n.shelter.capacity}人` : ''}`,
    });
    li.append(name, kana, document.createElement('br'), meta);
    return li;
  })));
  $('result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  void say(lastSpeech);
}

async function say(text: string): Promise<void> {
  if (!text) return;
  try {
    await speak(text, message => setStatus('speech-status', message));
    const ms = lastSynthesisMilliseconds;
    setStatus('speech-status', ms ? `読み上げました（音声を作るのに ${(ms / 1000).toFixed(1)} 秒・この端末の中で作成）` : '読み上げました');
  } catch (error) {
    setStatus('speech-status', `読み上げられませんでした: ${(error as Error).message}。先に「準備する」を押してください。`);
  }
}

async function guideAt(point: Point, label: string): Promise<void> {
  if (!data) {
    setStatus('where-status', 'データを読み込んでいます…');
    try { await dataReady; } catch { /* 下で知らせる */ }
  }
  if (!data) { setStatus('where-status', 'データを読み込めませんでした。通信のある所で一度開いてください。'); return; }
  setStatus('where-status', label);
  const r = evaluate(point, data);
  if (map && L) {
    pin?.remove();
    pin = L.circleMarker([point.lat, point.lon], { radius: 9, color: '#c62828', weight: 3, fillColor: '#ffffff', fillOpacity: 1 }).addTo(map);
  }
  renderResult(r);
}

function locate(): void {
  unlockAudio();
  if (!('geolocation' in navigator)) { setStatus('where-status', 'この端末では位置を取れません。地図か町から選んでください。'); return; }
  setStatus('where-status', '位置を調べています…（GPS は通信がなくても使えます）');
  navigator.geolocation.getCurrentPosition(
    pos => void guideAt({ lat: pos.coords.latitude, lon: pos.coords.longitude }, `今いる場所（誤差 約${Math.round(pos.coords.accuracy)}m）で案内します。`),
    err => setStatus('where-status', `位置を取れませんでした（${err.code === err.PERMISSION_DENIED ? '位置情報の利用が許可されていません' : '時間切れか圏外'}）。地図か町から選んでください。`),
    { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
  );
}

async function showMap(): Promise<void> {
  unlockAudio();
  $('map').hidden = false;
  $('map-note').hidden = false;
  if (map) { map.invalidateSize(); return; }
  if (!data) { try { await dataReady; } catch { /* 下で知らせる */ } }
  if (!data || map) return;
  L = await import('leaflet');
  map = L.map('map', { preferCanvas: true }).setView([35.745, 139.62], 13);
  L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>',
  }).addTo(map);
  const colors: Record<number, string> = { 1: '#b3d7f5', 2: '#6fb0e8', 3: '#2f7fd0', 4: '#1a4fa0', 5: '#12306b', 6: '#0a1d42' };
  const floodLayer: LayerGroup = L.layerGroup();
  for (const f of data.flood) {
    const p = f.properties;
    const style = p.kind === 'depth'
      ? { stroke: false, fillColor: colors[p.rank ?? 1], fillOpacity: 0.45 }
      : { color: '#8e24aa', weight: 1, fillColor: '#8e24aa', fillOpacity: 0.25 };
    L.geoJSON(f as never, { style: () => style, interactive: false }).addTo(floodLayer);
  }
  floodLayer.addTo(map);
  for (const s of data.shelters) {
    L.circleMarker([s.lat, s.lon], {
      radius: 5, weight: 1, color: '#1b5e20', fillColor: s.hazards.flood ? '#43a047' : '#bdbdbd', fillOpacity: 0.95,
    }).bindTooltip(`${s.name}${s.hazards.flood ? '' : '（洪水は対象外）'}`).addTo(map);
  }
  map.on('click', e => void guideAt({ lat: e.latlng.lat, lon: e.latlng.lng }, '地図で選んだ場所で案内します。'));
}

function setupTowns(towns: Town[]): void {
  const select = $<HTMLSelectElement>('town');
  for (const t of towns) select.append(new Option(`${t.town}（${t.kana}）`, `${t.lat},${t.lon},${t.town}`));
  select.addEventListener('change', () => {
    if (!select.value) return;
    unlockAudio();
    const [lat, lon, town] = select.value.split(',');
    void guideAt({ lat: Number(lat), lon: Number(lon) }, `${town}の中の避難場所の平均の位置で案内します（目安）。`);
  });
}

function setupFont(): void {
  const button = $<HTMLButtonElement>('font');
  const apply = (on: boolean) => {
    document.documentElement.classList.toggle('large', on);
    button.setAttribute('aria-pressed', String(on));
    button.textContent = on ? '文字を標準に' : '文字を大きく';
  };
  let on = false;
  try { on = localStorage.getItem('koe-hinan:large') === '1'; } catch { /* 保存できなくても動く */ }
  apply(on);
  button.addEventListener('click', () => {
    on = !on;
    apply(on);
    try { localStorage.setItem('koe-hinan:large', on ? '1' : '0'); } catch { /* 保存できなくても動く */ }
  });
}

async function main(): Promise<void> {
  setupFont();
  $('prepare').addEventListener('click', () => { unlockAudio(); void prepare(); });
  $('locate').addEventListener('click', locate);
  $('pick-map').addEventListener('click', () => void showMap());
  $('replay').addEventListener('click', () => { unlockAudio(); void say(lastSpeech); });
  $('stop').addEventListener('click', () => { stopSpeech(); setStatus('speech-status', '止めました'); });
  try {
    dataReady = loadData();
    const loaded = await dataReady;
    data = loaded.data;
    setupTowns(loaded.towns);
    $('sources').replaceChildren(...loaded.sources.map(s => {
      const li = document.createElement('li');
      li.append(Object.assign(document.createElement('a'), { href: s.url, textContent: s.name }), `（${s.license}）`);
      return li;
    }));
  } catch {
    setStatus('where-status', 'データを読み込めませんでした。通信のある所で一度開いてください。');
  }
  void refreshPrepared();
  // テスト・計測・デモ動画用（画面には出ない）
  Object.assign(window, { koeHinan: {
    evaluate: (p: Point) => data && evaluate(p, data),
    buildText,
    lastSpeech: () => lastSpeech,
    mapPoint: (lat: number, lon: number) => map?.latLngToContainerPoint([lat, lon]),
    /** 文を端末の中で合成し、WAV を base64 で返す（再生はしない）。 */
    synthWav: async (text: string) => {
      const tts = await loadVoice();
      const audio = await tts.synthesize(text, { language: 'ja', lengthScale: 1.25, ssml: false });
      const bytes = new Uint8Array(audio.toWav());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    },
  } });
}

void main();
