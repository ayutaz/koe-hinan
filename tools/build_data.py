"""data/raw/ の元データから、アプリが読むデータ（public/data/）と読み仮名の表（data/readings.csv）を作る。

使い方: uv run --no-project --with shapely python tools/build_data.py
"""
from __future__ import annotations

import csv
import glob
import json
import os
import re
import unicodedata
from collections import Counter, defaultdict

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "public", "data")

# 練馬区の範囲（避難先が区の境の外のこともあるので少し広め）
BBOX = (139.54, 35.70, 139.70, 35.80)

HAZARD_COLS = {
    "flood": "災害種別_洪水",
    "landslide": "災害種別_崖崩れ、土石流及び地滑り",
    "stormSurge": "災害種別_高潮",
    "earthquake": "災害種別_地震",
    "tsunami": "災害種別_津波",
    "fire": "災害種別_大規模な火事",
    "inland": "災害種別_内水氾濫",
    "volcano": "災害種別_火山現象",
}

RIVER_KANA = {"石神井川": "シャクジイガワ", "神田川": "カンダガワ"}

# 町字データにない語の読み（一般語と、町名ではない固有の名前）。
# 固有の名前は練馬区のデータ（AED設置箇所一覧・投票所一覧）の読みと突き合わせて確かめる。
WORDS = {
    # 一般語
    "小学校": "ショウガッコウ", "中学校": "チュウガッコウ",
    "第一": "ダイイチ", "第二": "ダイニ", "第三": "ダイサン", "第四": "ダイヨン",
    "第六": "ダイロク", "第八": "ダイハチ",
    "東": "ヒガシ", "西": "ニシ", "南": "ミナミ", "北": "キタ", "中央": "チュウオウ",
    "地域集会所": "チイキシュウカイジョ", "地区区民館": "チククミンカン", "敬老館": "ケイロウカン",
    "区民センター": "クミンセンター", "地域包括支援センター": "チイキホウカツシエンセンター",
    "防災学習センター": "ボウサイガクシュウセンター", "生涯学習センター": "ショウガイガクシュウセンター",
    "分館": "ブンカン", "厚生文化会館": "コウセイブンカカイカン", "勤労福祉会館": "キンロウフクシカイカン",
    "男女共同参画センター": "ダンジョキョウドウサンカクセンター", "庭園": "テイエン",
    "区役所": "クヤクショ", "駅前": "エキマエ", "学園": "ガクエン", "緑": "ミドリ", "桜": "サクラ",
    "ステーション": "ステーション",
    # 町名ではない固有の名前
    "練馬区": "ネリマク", "開進": "カイシン", "豊溪": "ホウケイ", "豊渓": "ホウケイ", "光和": "コウワ",
    "北原": "キタハラ", "泉新": "センシン", "橋戸": "ハシド", "八坂": "ヤサカ", "南が丘": "ミナミガオカ",
    "四季の香": "シキノカオリ", "春の風": "ハルノカゼ", "夏の雲": "ナツノクモ", "秋の陽": "アキノヒ",
    "関": "セキ", "立野": "タテノ", "春日": "カスガ",
}

# 練馬区の2つのデータで読みが食い違う・誤記とみられるものを、ここで決める（理由つき）。
OVERRIDES: dict[str, tuple[str, str]] = {
    "中村小学校": ("ナカムラショウガッコウ",
               "AED設置箇所一覧は「ナカムラシショウガッコウ」、投票所一覧は「ナカムラショウガッコウ」。町名（ナカムラ）と同じ投票所一覧の読みを採り、AED設置箇所一覧の「シ」は誤記とみた"),
    "豊溪小学校": ("ホウケイショウガッコウ",
               "AED設置箇所一覧と投票所一覧に「ホウケイショウガッコウ」がある（名称の字体が「豊渓」などで違い、名前では突き合わなかった）"),
    "東大泉中央地域集会所": ("ヒガシオオイズミチュウオウチイキシュウカイジョ",
                    "町名「東大泉」はアドレス・ベース・レジストリで「ヒガシオオイズミ」。AED設置箇所一覧の括弧書きに「トウダイイズミチュウオウチイキシュウカイジョ」とあるが誤記とみた"),
}


def read_csv(path: str) -> list[dict]:
    raw = open(path, "rb").read()
    for enc in ("utf-8-sig", "cp932"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    return list(csv.DictReader(text.splitlines()))


def kata(s: str) -> str:
    """ひらがなをカタカナに。"""
    return "".join(chr(ord(c) + 0x60) if "ぁ" <= c <= "ゖ" else c for c in s)


def nfkc(s: str) -> str:
    return unicodedata.normalize("NFKC", s).strip()


def norm_name(s: str) -> str:
    s = nfkc(s)
    s = re.sub(r"[（(].*?[）)]", "", s)
    s = s.replace("練馬区立", "")
    return s.replace(" ", "")


def norm_kana(s: str) -> str:
    s = nfkc(s)
    s = re.sub(r"[（(].*?[）)]", "", s)
    s = s.replace("ネリマクリツ", "")
    return s.replace(" ", "").replace("・", "")


def build_lexicon(towns: list[dict]) -> dict[str, str]:
    lex = dict(WORDS)
    for t in towns:
        oaza, kana = t["oaza_cho"], t["oaza_cho_kana"]
        if not oaza:
            continue
        lex[oaza] = kana
        # 「〇〇町」の語幹（春日町→春日、大泉町→大泉 など）
        if oaza.endswith("町") and len(oaza) > 2:
            for suf in ("チョウ", "マチ"):
                if kana.endswith(suf):
                    lex.setdefault(oaza[:-1], kana[: -len(suf)])
        # 「豊玉上」→「豊玉」のような方角・位置つきの町
        for d, dk in (("上", "カミ"), ("中", "ナカ"), ("北", "キタ"), ("南", "ミナミ"), ("東", "ヒガシ")):
            if oaza.endswith(d) and kana.endswith(dk) and len(oaza) > 2:
                lex.setdefault(oaza[:-1], kana[: -len(dk)])
    return lex


def compose(name: str, lex: dict[str, str]) -> tuple[str | None, list[str]]:
    """辞書の最長一致で読みを組み立てる。組み立てられなければ None。"""
    i, out, used = 0, [], []
    keys = sorted(lex, key=len, reverse=True)
    while i < len(name):
        c = name[i]
        if "ぁ" <= c <= "ゖ" or "ァ" <= c <= "ヺ" or c == "ー":
            j = i
            while j < len(name) and ("ぁ" <= name[j] <= "ゖ" or "ァ" <= name[j] <= "ヺ" or name[j] == "ー"):
                j += 1
            out.append(kata(name[i:j]))
            used.append(name[i:j])
            i = j
            continue
        for k in keys:
            if name.startswith(k, i):
                out.append(lex[k])
                used.append(k)
                i += len(k)
                break
        else:
            return None, used
    return "".join(out), used


def official_readings() -> dict[str, dict[str, set[str]]]:
    """練馬区の AED 設置箇所一覧と投票所一覧から、名称→読みの候補を集める。"""
    res: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for label, pattern, ncol, kcol in (
        ("AED設置箇所一覧", "nerima_od/131202_aed.csv", "名称", "名称_カナ"),
        ("投票所一覧", "nerima_od/131202_polling_place.csv", "名称", "名称_カナ"),
    ):
        for path in glob.glob(os.path.join(RAW, pattern)):
            for r in read_csv(path):
                n, k = r.get(ncol, ""), r.get(kcol, "")
                if n and k:
                    res[norm_name(n)][label].add(norm_kana(k))
    return res


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    towns = read_csv(os.path.join(RAW, "abr", "mt_town_city131202.csv"))
    lex = build_lexicon(towns)
    town_kana = {t["oaza_cho"]: t["oaza_cho_kana"] for t in towns if t["oaza_cho"]}
    official = official_readings()

    shelters_raw = read_csv(os.path.join(RAW, "nerima_evacuation_space.csv"))
    gsi = {nfkc(r["施設・場所名"]).replace(" ", ""): r for r in read_csv(os.path.join(RAW, "gsi_13120_2.csv"))}

    shelters, readings = [], []
    stats = Counter()
    for r in shelters_raw:
        name = nfkc(r["名称"])
        composed, used = compose(name, lex)
        cands = official.get(norm_name(name), {})
        flat = sorted({k for ks in cands.values() for k in ks})
        note = ""
        if name in OVERRIDES:
            kana, note = OVERRIDES[name]
            source = "手で決めた（理由は備考）"
            status = "決定"
        elif len(flat) == 1:
            kana = flat[0]
            source = "・".join(f"練馬区「{l}」" for l in sorted(cands))
            status = "区のデータ2件で一致" if len(cands) >= 2 else "区のデータ1件"
        elif len(flat) > 1:
            kana = flat[0]
            source = "練馬区のデータ（候補が複数）"
            status = "要確認"
            note = "区のデータの中で読みが食い違う: " + " / ".join(flat)
        elif composed:
            kana = composed
            source = "町字データと一般語から組み立て"
            status = "組み立て（未確認）"
        else:
            kana = ""
            source = ""
            status = "読みなし"
        if composed and kana and composed != kana and status != "要確認":
            note = (note + "；" if note else "") + f"町名などから組み立てた読み（{composed}）と違う"
            stats["組み立てと違う"] += 1
        stats[status] += 1

        oaza = re.sub(r"[0-9０-９]+丁目$", "", nfkc(r["所在地_町字"]))
        hazards = {k: r.get(c, "").strip() == "1" for k, c in HAZARD_COLS.items()}
        cap = re.match(r"(\d+)人", nfkc(r.get("想定収容人数", "")))
        g = gsi.get(name.replace(" ", ""))
        shelters.append({
            "id": r["ID"],
            "name": name,
            "kana": kana,
            "town": oaza,
            "townKana": town_kana.get(oaza, ""),
            "address": nfkc(r["所在地_連結表記"]),
            "lat": round(float(r["緯度"]), 6),
            "lon": round(float(r["経度"]), 6),
            "hazards": hazards,
            "capacity": int(cap.group(1)) if cap else None,
            "inGsi": g is not None,
        })
        readings.append({
            "ID": r["ID"], "名称": name, "読み": kana, "読みの出どころ": source, "確認": status,
            "AED設置箇所一覧": " / ".join(sorted(cands.get("AED設置箇所一覧", []))),
            "投票所一覧": " / ".join(sorted(cands.get("投票所一覧", []))),
            "町名などから組み立てた読み": composed or "", "備考": note,
        })

    # 国土地理院のデータとの照合
    nerima_names = {s["name"].replace(" ", "") for s in shelters}
    only_gsi = sorted(set(gsi) - nerima_names)
    only_nerima = sorted(nerima_names - set(gsi))
    flood_mismatch = sorted(
        s["name"] for s in shelters
        if s["name"] in gsi and (gsi[s["name"]]["洪水"].strip() == "1") != s["hazards"]["flood"]
    )

    # 町を選ぶ一覧（町ごとの避難場所の平均の位置）
    by_town = defaultdict(list)
    for s in shelters:
        by_town[s["town"]].append(s)
    town_list = sorted(
        ({"town": t, "kana": town_kana.get(t, ""),
          "lat": round(sum(x["lat"] for x in v) / len(v), 6),
          "lon": round(sum(x["lon"] for x in v) / len(v), 6)} for t, v in by_town.items()),
        key=lambda x: x["kana"],
    )

    # 浸水想定（想定最大規模）と家屋倒壊等氾濫想定区域
    flood_feats = []
    flood_stats = Counter()
    for cat, kind in (("20", "depth"), ("41", "collapseFlow"), ("42", "collapseErosion")):
        groups = defaultdict(list)
        for path in glob.glob(os.path.join(RAW, "a31a", "**", f"A31a-{cat}-*.geojson"), recursive=True):
            fc = json.load(open(path, encoding="utf-8"))
            for ft in fc["features"]:
                p = ft["properties"]
                river = next((v for k, v in p.items() if k.endswith("02")), "")
                if river not in RIVER_KANA:
                    continue
                geom = shape(ft["geometry"])
                minx, miny, maxx, maxy = geom.bounds
                if maxx < BBOX[0] or minx > BBOX[2] or maxy < BBOX[1] or miny > BBOX[3]:
                    continue
                rank = p.get("A31a_205") if cat == "20" else None
                groups[(river, rank)].append(geom)
        for (river, rank), geoms in sorted(groups.items(), key=lambda x: (x[0][0], x[0][1] or 0)):
            merged = unary_union(geoms).simplify(0.00008, preserve_topology=True)
            geo = mapping(merged)

            def rnd(c):
                return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 5), round(c[1], 5)]

            geo = {"type": geo["type"], "coordinates": rnd(geo["coordinates"])}
            flood_feats.append({"type": "Feature",
                                "properties": {"kind": kind, "river": river, "riverKana": RIVER_KANA[river], "rank": rank},
                                "geometry": geo})
            flood_stats[(kind, river)] += len(geoms)

    meta = {
        "generated": "data/raw の元データから tools/build_data.py で作成",
        "sources": [
            {"name": "練馬区 指定緊急避難場所一覧", "license": "CC BY 4.0", "url": "https://www.city.nerima.tokyo.jp/kusei/tokei/opendata/opendatasite/bosai/evacuation_space.html"},
            {"name": "練馬区 AED設置箇所一覧・投票所一覧（読み仮名の照合に使用）", "license": "CC BY 4.0", "url": "https://www.city.nerima.tokyo.jp/category/opendata/index.html"},
            {"name": "国土地理院 指定緊急避難場所データ（照合に使用）", "license": "国土地理院コンテンツ利用規約", "url": "https://www.gsi.go.jp/bousaichiri/hinanbasho.html"},
            {"name": "国土交通省 国土数値情報 洪水浸水想定区域データ（河川単位）2024年度", "license": "CC BY 4.0", "url": "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A31a-2024.html"},
            {"name": "デジタル庁 アドレス・ベース・レジストリ 町字データ", "license": "公共データ利用規約 第1.0版", "url": "https://www.digital.go.jp/policies/base_registry_address"},
        ],
    }
    json.dump({**meta, "shelters": shelters}, open(os.path.join(OUT, "shelters.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump({"type": "FeatureCollection", "features": flood_feats}, open(os.path.join(OUT, "flood.geojson"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(town_list, open(os.path.join(OUT, "towns.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(ROOT, "data", "readings.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(readings[0]))
        w.writeheader()
        w.writerows(readings)

    report = {
        "shelters": len(shelters),
        "floodDesignated": sum(s["hazards"]["flood"] for s in shelters),
        "readingStatus": dict(stats),
        "gsiCount": len(gsi), "onlyGsi": only_gsi, "onlyNerima": only_nerima, "floodMismatch": flood_mismatch,
        "towns": len(town_list),
        "floodPolygons": {f"{k[0]}:{k[1]}": v for k, v in flood_stats.items()},
        "sizes": {n: os.path.getsize(os.path.join(OUT, n)) for n in ("shelters.json", "flood.geojson", "towns.json")},
        "needsReview": [x for x in readings if x["確認"] in ("要確認", "組み立て（未確認）", "読みなし") or x["備考"]],
    }
    json.dump(report, open(os.path.join(ROOT, "data", "build_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("ok")


if __name__ == "__main__":
    main()
