import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bearingDegrees, contains, direction8, distanceMeters } from './geo';
import { buildText, evaluate, OUTSIDE_METERS, roundDistance, type Dataset, type FloodFeature, type Shelter } from './guide';

const root = resolve(__dirname, '..');
const real: Dataset = {
  shelters: JSON.parse(readFileSync(resolve(root, 'public/data/shelters.json'), 'utf8')).shelters,
  flood: JSON.parse(readFileSync(resolve(root, 'public/data/flood.geojson'), 'utf8')).features,
};

describe('geo', () => {
  it('measures distance and bearing', () => {
    const a = { lat: 35.7356, lon: 139.6517 };
    const b = { lat: 35.7446, lon: 139.6517 }; // 約1km北
    expect(distanceMeters(a, b)).toBeGreaterThan(990);
    expect(distanceMeters(a, b)).toBeLessThan(1010);
    expect(direction8(bearingDegrees(a, b)).text).toBe('北');
    expect(direction8(bearingDegrees(b, a)).text).toBe('南');
    expect(direction8(bearingDegrees(a, { lat: 35.7446, lon: 139.6627 })).text).toBe('北東');
    expect(direction8(350).text).toBe('北');
    expect(direction8(200).text).toBe('南');
  });

  it('handles polygons with holes', () => {
    const geometry = { type: 'Polygon' as const, coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ] };
    expect(contains(geometry, { lat: 2, lon: 2 })).toBe(true);
    expect(contains(geometry, { lat: 5, lon: 5 })).toBe(false);
    expect(contains(geometry, { lat: 11, lon: 5 })).toBe(false);
  });
});

describe('guide (synthetic)', () => {
  const shelter = (id: string, lat: number, lon: number, flood: boolean): Shelter => ({
    id, name: `${id}小学校`, kana: `${id}ショウガッコウ`, town: 'x', townKana: 'x', address: 'x', lat, lon, capacity: null,
    hazards: { flood, inland: flood, earthquake: true, fire: true },
  });
  const square = (kind: FloodFeature['properties']['kind'], rank: number | null): FloodFeature => ({
    type: 'Feature', properties: { kind, river: '石神井川', riverKana: 'シャクジイガワ', rank },
    geometry: { type: 'Polygon', coordinates: [[[139.0, 35.0], [139.01, 35.0], [139.01, 35.01], [139.0, 35.01], [139.0, 35.0]]] },
  });
  const data: Dataset = {
    shelters: [shelter('近い地震だけ', 35.0051, 139.0051, false), shelter('ア', 35.008, 139.005, true), shelter('イ', 35.02, 139.005, true)],
    flood: [square('depth', 2), square('depth', 3), square('collapseFlow', null)],
  };

  it('chooses only flood shelters and the deepest rank', () => {
    const r = evaluate({ lat: 35.005, lon: 139.005 }, data);
    expect(r.depth?.rank).toBe(3);
    expect(r.collapse?.kind).toBe('collapseFlow');
    expect(r.nearest.map(n => n.shelter.id)).toEqual(['ア', 'イ']);
    expect(r.nearest[0].direction.text).toBe('北');
    expect(r.outsideArea).toBe(false);
  });

  it('speaks readings, not kanji names', () => {
    const t = buildText(evaluate({ lat: 35.005, lon: 139.005 }, data));
    expect(t.speech).toContain('アショウガッコウ');
    expect(t.speech).toContain('シャクジイガワ');
    expect(t.speech).not.toContain('ア小学校');
    expect(t.speech).not.toContain('石神井川');
    expect(t.display.join('')).toContain('「ア小学校」');
  });

  it('does not say "outside" when only the house-collapse zone applies', () => {
    const only: Dataset = { shelters: data.shelters, flood: [square('collapseFlow', null)] };
    const t = buildText(evaluate({ lat: 35.005, lon: 139.005 }, only));
    expect(t.display[0]).toBe('ここは石神井川の家屋倒壊等氾濫想定区域です。川の流れや岸がけずられて、家が倒れるおそれがあります。早めに区域の外へ避難してください。');
    expect(t.display.join('')).not.toContain('区域の外です');
    expect(t.speech).toContain('シャクジイガワの、川の近くで、家が倒れるおそれのある区域です');
  });

  it('says it is outside when far from every shelter', () => {
    const r = evaluate({ lat: 36, lon: 140 }, data);
    expect(r.outsideArea).toBe(true);
    expect(buildText(r).speech).toContain('練馬区の外');
  });

  it('rounds distance', () => {
    expect(roundDistance(12)).toEqual({ text: '50m', speech: '50メートル' });
    expect(roundDistance(312)).toEqual({ text: '300m', speech: '300メートル' });
    expect(roundDistance(1234)).toEqual({ text: '1.2km', speech: '1.2キロメートル' });
  });
});

describe('guide (練馬区のデータ)', () => {
  it('has 163 shelters with readings, 154 for floods', () => {
    expect(real.shelters).toHaveLength(163);
    expect(real.shelters.filter(s => s.hazards.flood)).toHaveLength(154);
    for (const s of real.shelters) expect(s.kana).toMatch(/^[ァ-ヺー]+$/);
  });

  it('guides from every shelter location and never speaks a kanji facility name', () => {
    for (const s of real.shelters) {
      const r = evaluate(s, real);
      expect(r.outsideArea).toBe(false);
      expect(r.nearest[0].meters).toBeLessThan(OUTSIDE_METERS);
      const t = buildText(r);
      for (const n of r.nearest) expect(t.speech).not.toContain(n.shelter.name);
    }
  });

  it('finds flood areas along the rivers', () => {
    const inside = real.shelters.filter(s => evaluate(s, real).depth);
    expect(inside.length).toBeGreaterThan(0);
    // 区の真ん中から離れた所（区の外）は区の外と判定する
    expect(evaluate({ lat: 35.68, lon: 139.77 }, real).outsideArea).toBe(true);
  });
});
