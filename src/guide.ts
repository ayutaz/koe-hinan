// いる場所から、浸水の想定と近くの避難場所を選び、画面の文と読み上げの文を作る。
import { bbox, bearingDegrees, contains, direction8, distanceMeters, type Point, type PolygonGeometry } from './geo';

export type Shelter = {
  id: string; name: string; kana: string; town: string; townKana: string; address: string;
  lat: number; lon: number; capacity: number | null;
  hazards: { flood: boolean; inland: boolean; earthquake: boolean; fire: boolean; [k: string]: boolean };
};
export type FloodFeature = {
  type: 'Feature';
  properties: { kind: 'depth' | 'collapseFlow' | 'collapseErosion'; river: string; riverKana: string; rank: number | null };
  geometry: PolygonGeometry;
};
export type Dataset = { shelters: Shelter[]; flood: FloodFeature[] };

export type Nearby = { shelter: Shelter; meters: number; direction: { text: string; kana: string } };
export type GuideResult = {
  point: Point;
  depth: { rank: number; river: string; riverKana: string } | null;
  collapse: { river: string; riverKana: string; kind: 'collapseFlow' | 'collapseErosion' } | null;
  nearest: Nearby[];
  outsideArea: boolean;
};

/** 練馬区の避難場所から遠すぎるときは、区の外とみなす（メートル）。 */
export const OUTSIDE_METERS = 2500;

export const DEPTH: Record<number, { text: string; speech: string; advice: string }> = {
  1: { text: '0.5m未満', speech: '0.5メートル未満', advice: '床下ほどの浸水が想定されています。' },
  2: { text: '0.5〜3m', speech: '0.5メートルから3メートル', advice: '1階が浸水するおそれのある深さです。' },
  3: { text: '3〜5m', speech: '3メートルから5メートル', advice: '2階まで浸水するおそれのある深さです。区域の外へ避難してください。' },
  4: { text: '5〜10m', speech: '5メートルから10メートル', advice: '2階が水につかるおそれのある深さです。区域の外へ避難してください。' },
  5: { text: '10〜20m', speech: '10メートルから20メートル', advice: '建物が水につかるおそれのある深さです。区域の外へ避難してください。' },
  6: { text: '20m以上', speech: '20メートル以上', advice: '建物が水につかるおそれのある深さです。区域の外へ避難してください。' },
};

type Indexed = FloodFeature & { box: [number, number, number, number] };
const indexCache = new WeakMap<FloodFeature[], Indexed[]>();
function indexed(features: FloodFeature[]): Indexed[] {
  let out = indexCache.get(features);
  if (!out) { out = features.map(f => ({ ...f, box: bbox(f.geometry) })); indexCache.set(features, out); }
  return out;
}

export function evaluate(point: Point, data: Dataset, count = 3): GuideResult {
  let depth: GuideResult['depth'] = null;
  let collapse: GuideResult['collapse'] = null;
  for (const f of indexed(data.flood)) {
    const [x0, y0, x1, y1] = f.box;
    if (point.lon < x0 || point.lon > x1 || point.lat < y0 || point.lat > y1) continue;
    if (!contains(f.geometry, point)) continue;
    const p = f.properties;
    if (p.kind === 'depth' && p.rank && (!depth || p.rank > depth.rank)) depth = { rank: p.rank, river: p.river, riverKana: p.riverKana };
    if (p.kind !== 'depth' && !collapse) collapse = { river: p.river, riverKana: p.riverKana, kind: p.kind };
  }
  const nearest = data.shelters
    .filter(s => s.hazards.flood)
    .map(s => ({ shelter: s, meters: distanceMeters(point, s), direction: direction8(bearingDegrees(point, s)) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, count);
  return { point, depth, collapse, nearest, outsideArea: !nearest.length || nearest[0].meters > OUTSIDE_METERS };
}

/** 距離を丸める。1km 未満は50m単位、それ以上は0.1km単位。 */
export function roundDistance(meters: number): { text: string; speech: string } {
  if (meters < 1000) {
    const m = Math.max(50, Math.round(meters / 50) * 50);
    return { text: `${m}m`, speech: `${m}メートル` };
  }
  const km = (Math.round(meters / 100) / 10).toFixed(1);
  return { text: `${km}km`, speech: `${km}キロメートル` };
}

export type GuideText = { display: string[]; speech: string };

/** 画面に出す文（漢字）と、読み上げる文（地名・施設名は読み仮名）を作る。 */
export function buildText(r: GuideResult): GuideText {
  if (r.outsideArea) {
    return {
      display: ['選んだ場所は練馬区の外のようです。この案内は練馬区の中だけで使えます。地図か町の一覧から、練馬区の中の場所を選んでください。'],
      speech: '選んだ場所は、練馬区の外のようです。練馬区の中の場所を選んでください。',
    };
  }
  const display: string[] = [];
  const speech: string[] = [];
  const collapseText = r.collapse
    ? `${r.collapse.river}の家屋倒壊等氾濫想定区域${r.depth ? 'にも入っています' : 'です'}。川の流れや岸がけずられて、家が倒れるおそれがあります。早めに区域の外へ避難してください。`
    : '';
  const collapseSpeech = r.collapse
    ? `川の近くで、家が倒れるおそれのある区域${r.depth ? 'にも入っています' : 'です'}。早めに、区域の外へ避難してください。`
    : '';
  if (r.depth) {
    const d = DEPTH[r.depth.rank];
    display.push(`ここは${r.depth.river}の洪水浸水想定区域です（想定最大規模の雨で、深さ${d.text}）。${d.advice}`);
    speech.push(`ここは、${r.depth.riverKana}の、洪水浸水想定区域です。想定される深さは、${d.speech}です。${d.advice}`);
    if (collapseText) { display.push(collapseText); speech.push(collapseSpeech); }
  } else if (r.collapse) {
    display.push(`ここは${collapseText}`);
    speech.push(`ここは、${r.collapse.riverKana}の、${collapseSpeech}`);
  } else {
    display.push('ここは石神井川・神田川の洪水浸水想定区域の外です（ほかの川や、大雨で下水があふれる浸水の想定は含みません）。');
    speech.push('ここは、シャクジイガワと、カンダガワの、洪水浸水想定区域の外です。');
  }
  const first = r.nearest[0];
  const dist = roundDistance(first.meters);
  display.push(`洪水のときの指定緊急避難場所で一番近いのは、${first.direction.text}へ直線でおよそ${dist.text}の「${first.shelter.name}」（${first.shelter.address}）です。`);
  speech.push(`洪水のときの避難場所で、いちばん近いのは、${first.direction.kana}へ、直線でおよそ${dist.speech}の、${first.shelter.kana}です。`);
  display.push('避難場所の最新の情報と、避難の呼びかけは、練馬区の発表で確かめてください。');
  speech.push('最新の情報は、練馬区の発表で、たしかめてください。');
  return { display, speech: speech.join('') };
}
