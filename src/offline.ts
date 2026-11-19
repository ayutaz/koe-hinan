// アプリとデータ・声を端末にためる Service Worker とのやりとり。
let registration: Promise<ServiceWorkerRegistration | null> | undefined;

export function registerOffline(): Promise<ServiceWorkerRegistration | null> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return Promise.resolve(null);
  return registration ??= (async () => {
    const result = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', changed); reject(new Error('timeout')); }, 120_000);
        const changed = () => { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve(); };
        navigator.serviceWorker.addEventListener('controllerchange', changed);
        if (navigator.serviceWorker.controller) changed();
      });
    }
    return result;
  })().catch(() => null);
}

export type OfflineState = { shell: boolean; voice: boolean };

async function workerRequest(type: 'STATUS' | 'CACHE_VOICE'): Promise<OfflineState> {
  if (!await registerOffline() || !navigator.serviceWorker.controller) throw new Error('この環境では端末にためられません（HTTPS の公開ページで開いてください）。');
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('応答がありません。通信のある所でもう一度試してください。')); }, type === 'CACHE_VOICE' ? 300_000 : 5000);
    channel.port1.onmessage = event => {
      clearTimeout(timer);
      channel.port1.close();
      if (event.data.error) reject(new Error('声のデータを保存できませんでした。通信と端末の空き容量を確かめてください。'));
      else resolve(event.data);
    };
    navigator.serviceWorker.controller!.postMessage({ type }, [channel.port2]);
  });
}

export async function offlineState(): Promise<OfflineState | null> {
  if (!import.meta.env.PROD) return null;
  try { return await workerRequest('STATUS'); } catch { return null; }
}

export async function saveVoiceOffline(): Promise<OfflineState> { return workerRequest('CACHE_VOICE'); }
