// 施設名を漢字のまま音声合成に渡したときと、読み仮名で渡したときで、発音（音素の列）が変わるかを数える。
// 使い方: node tools/check_g2p.mjs  （data/raw/voice_config.json が要る。tools/fetch_data.sh の後に取る）
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initSync, WasmPhonemizer } from 'piper-plus/wasm/multilingual';

const root = resolve(import.meta.dirname, '..');
const wasm = await readFile(resolve(root, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm_bg.wasm'));
initSync({ module: wasm });
const config = JSON.parse(await readFile(resolve(root, 'data/raw/voice_config.json'), 'utf8'));
const idToSymbol = new Map();
for (const [symbol, ids] of Object.entries(config.phoneme_id_map)) for (const id of ids) if (!idToSymbol.has(id)) idToSymbol.set(id, symbol);
const phonemizer = new WasmPhonemizer(JSON.stringify(config));
const PAD = config.phoneme_id_map._?.[0] ?? 0;
const phones = text => {
  const result = phonemizer.phonemize(text, 'ja');
  // アクセントの記号（^ $ [ ] # ?）は外し、音の並びだけを比べる
  return [...result.phonemeIds].filter(id => id !== PAD).map(id => idToSymbol.get(id) ?? `#${id}`)
    .filter(sym => !['^', '$', '[', ']', '#', '?', '_'].includes(sym)).join(' ');
};

// 発音として同じとみなすゆれ: 無声化（大文字）・エイ/エー・オウ/オー
const loose = p => ` ${p.toLowerCase()} `.replaceAll(' e i ', ' e e ').replaceAll(' o u ', ' o o ').replaceAll(' e i ', ' e e ').replaceAll(' o u ', ' o o ').trim();

const data = JSON.parse(await readFile(resolve(root, 'public/data/shelters.json'), 'utf8'));
const rows = [];
let differ = 0;
for (const s of data.shelters) {
  const asText = phones(s.name);
  const asKana = phones(s.kana);
  const same = loose(asText) === loose(asKana);
  // 「集会所」の しょ／じょ だけの違いは、読み間違いと分けて数える
  const onlyShuukaijo = !same && loose(asText) === loose(phones(s.kana.replaceAll('シュウカイジョ', 'シュウカイショ')));
  if (!same && !onlyShuukaijo) differ++;
  rows.push({ id: s.id, name: s.name, kana: s.kana, same, onlyShuukaijo, asText, asKana });
}
// 町名だけでも同じことを調べる
const towns = JSON.parse(await readFile(resolve(root, 'public/data/towns.json'), 'utf8'));
const townRows = towns.map(t => ({ town: t.town, kana: t.kana, same: loose(phones(t.town)) === loose(phones(t.kana)) }));

const report = {
  checkedAt: new Date().toISOString().slice(0, 10),
  engine: 'piper-plus 0.9.1 WasmPhonemizer（OpenJTalk 系の日本語辞書）・声 piper-plus-tsukuyomi-chan の config',
  shelters: data.shelters.length,
  sheltersPronouncedDifferently: differ,
  towns: towns.length,
  townsPronouncedDifferently: townRows.filter(t => !t.same).length,
  sheltersOnlyShuukaijo: rows.filter(r => r.onlyShuukaijo).length,
  differentShelters: rows.filter(r => !r.same && !r.onlyShuukaijo),
  onlyShuukaijo: rows.filter(r => r.onlyShuukaijo).map(r => r.name),
  differentTowns: townRows.filter(t => !t.same),
};
await writeFile(resolve(root, 'data/g2p_report.json'), JSON.stringify(report, null, 1));
console.log(`shelters ${differ}/${rows.length} differ (+${report.sheltersOnlyShuukaijo} shuukaijo only), towns ${report.townsPronouncedDifferently}/${towns.length} differ`);
