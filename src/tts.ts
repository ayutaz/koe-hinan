import type { PiperPlus, ProgressInfo } from 'piper-plus';
import { voiceModelUrl } from './voice-assets';
import { registerOffline } from './offline';

// 端末の中だけで読み上げる（piper-plus・つくよみちゃんの声）。
let engine: Promise<PiperPlus> | undefined;
// iPhone などでは、ユーザーが押した直後でないと音を出せない。1つの audio 要素を押した時点で鳴らして使い回す。
const player = typeof Audio === 'undefined' ? undefined : new Audio();
let currentUrl: string | undefined;
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

/** ボタンを押した処理の中で同期的に呼ぶ。 */
export function unlockAudio(): void {
  if (!player || currentUrl) return;
  player.src = SILENCE;
  player.play().catch(() => {});
}
export let voiceLoadMilliseconds: number | null = null;
export let lastSynthesisMilliseconds: number | null = null;

export function loadVoice(onProgress: (message: string) => void = () => {}): Promise<PiperPlus> {
  if (!engine) {
    const start = performance.now();
    engine = (async () => {
      await registerOffline();
      const [{ PiperPlus }, ort] = await Promise.all([import('piper-plus'), import('onnxruntime-web/wasm')]);
      // GitHub Pages のように COOP/COEP ヘッダのない所でも動くよう、1スレッドで動かす
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = new URL(`${import.meta.env.BASE_URL}vendor/ort/`, document.baseURI).href;
      const tts = await PiperPlus.initialize({
        model: voiceModelUrl,
        ort,
        wasmG2pUrl: new URL(`${import.meta.env.BASE_URL}vendor/piper/piper_plus_wasm.js`, document.baseURI).href,
        onProgress: (info: ProgressInfo) => onProgress(`声を準備中 ${Math.round(info.progress * 100)}%`),
      });
      voiceLoadMilliseconds = performance.now() - start;
      return tts;
    })().catch(error => { engine = undefined; throw error; });
  }
  return engine;
}

export function stopSpeech(): void {
  if (!player) return;
  player.pause();
  if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = undefined; }
}

/** 文を合成して再生する。再生が終わるか止められると解決する。 */
export async function speak(text: string, onProgress: (message: string) => void = () => {}): Promise<void> {
  stopSpeech();
  const tts = await loadVoice(onProgress);
  onProgress('読み上げの音声を作っています…');
  const start = performance.now();
  const audio = await tts.synthesize(text, { language: 'ja', lengthScale: 1.25, ssml: false });
  lastSynthesisMilliseconds = performance.now() - start;
  if (!player) return;
  const url = URL.createObjectURL(audio.toBlob());
  currentUrl = url;
  player.src = url;
  onProgress('読み上げています');
  try {
    const done = new Promise<void>(resolve => {
      player.addEventListener('ended', () => resolve(), { once: true });
      player.addEventListener('pause', () => resolve(), { once: true });
    });
    await player.play();
    await done;
  } finally {
    if (currentUrl === url) { URL.revokeObjectURL(url); currentUrl = undefined; }
  }
}
