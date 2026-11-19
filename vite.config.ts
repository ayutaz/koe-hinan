import { defineConfig } from 'vite';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { voiceModelUrl, voiceConfigUrl } from './src/voice-assets.ts';

// ビルドの後に、アプリの全ファイル（データと読み上げの部品を含む）を一覧にした Service Worker を書き出す。
export default defineConfig({
  base: '/koe-hinan/',
  plugins: [{
    name: 'koe-hinan-offline',
    apply: 'build',
    async closeBundle() {
      const directory = resolve('dist');
      const entries = await readdir(directory, { recursive: true, withFileTypes: true });
      // demo/ はデモ動画（アプリは使わない）なので端末にためない
      const files = entries.filter(entry => entry.isFile() && entry.name !== 'sw.js')
        .map(entry => relative(directory, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/')).sort();
      const digest = createHash('sha256');
      for (const file of files) { digest.update(file); digest.update(await readFile(resolve(directory, file))); }
      const template = await readFile('scripts/sw-template.js', 'utf8');
      digest.update(template);
      digest.update(JSON.stringify([voiceModelUrl, voiceConfigUrl]));
      const worker = template.replace('__SHELL_FILES__', JSON.stringify(files))
        .replace('__VOICE_URLS__', JSON.stringify([voiceModelUrl, voiceConfigUrl]))
        .replace('__BUILD_VERSION__', digest.digest('hex').slice(0, 16));
      await writeFile(resolve(directory, 'sw.js'), worker);
    },
  }],
});
