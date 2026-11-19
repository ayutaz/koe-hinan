#!/usr/bin/env bash
# 元データを data/raw/ に取る。
# 国土地理院の指定緊急避難場所データは、https://hinanmap.gsi.go.jp/index.html の
# 「ご利用上の注意」を読み、同意したうえで取ること（このスクリプトは同意の画面を通らない）。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw/nerima_od data/raw/abr data/raw/a31a
cd data/raw

NERIMA=https://www.city.nerima.tokyo.jp/kusei/tokei/opendata/opendatasite
# 練馬区 オープンデータ（CC BY 4.0）
curl -sSf -o nerima_evacuation_space.csv "$NERIMA/bosai/evacuation_space.files/131202_evacuation_space.csv"
for page in hokenfukushi/aed senkyo/touhyoujo; do
  dir=$(dirname "$page")
  for rel in $(curl -sSf "$NERIMA/$page.html" | grep -o 'href="[^"]*\.csv"' | sed 's/href="//;s/"$//'); do
    curl -sSf -o "nerima_od/$(basename "$rel")" "$NERIMA/$dir/$rel"
  done
done

# 国土地理院 指定緊急避難場所・指定避難所（練馬区 13120）
GSI=https://hinanmap.gsi.go.jp/hinanjocp
for f in 13120_1 13120_2; do
  curl -sSf -o "gsi_$f.csv" "$GSI/defaultFtpData/csv/$f.csv"
  curl -sSf -o "gsi_$f.geojson" "$GSI/defaultFtpData/geoJSON/$f.geojson"
done

# デジタル庁 アドレス・ベース・レジストリ 町字マスター（練馬区）
curl -sSf -o abr_mt_town_city131202.csv.zip https://data.address-br.digital.go.jp/mt_town/city/mt_town_city131202.csv.zip
unzip -oq abr_mt_town_city131202.csv.zip -d abr

# 国土数値情報 洪水浸水想定区域（河川単位）2024年度・東京都（CC BY 4.0）
curl -sSf -o A31a-24_13_10_GEOJSON.zip https://nlftp.mlit.go.jp/ksj/gml/data/A31a/A31a-24/A31a-24_13_10_GEOJSON.zip
unzip -oq A31a-24_13_10_GEOJSON.zip -d a31a
echo done
