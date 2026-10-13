#!/bin/bash
# icon.svg から PNG アイコン一式を作り直す
# 使い方: bash tools/make-icons.sh（要 Node.js。初回だけ npx が変換ツールを取得する）
set -e
cd "$(dirname "$0")/.."
R="npx -y @resvg/resvg-js-cli@2.6.2-beta.1"
$R --fit-width 192 icon.svg icon-192.png
$R --fit-width 512 icon.svg icon-512.png
$R --fit-width 180 icon.svg apple-touch-icon.png
# マスカブル: 丸く切り抜かれても欠けないよう、絵を中央に 72% の大きさで置く
sed -e 's|<g id="art">|<g id="art" transform="translate(128 128) scale(0.72) translate(-128 -128)">|' icon.svg | $R --fit-width 512 - icon-512-maskable.png
# iOS アプリ用の元画像（ios-app/ がある場合）。このあと ios-app で npm run icons を実行すると、アイコンと起動画面が作られる
if [ -d ios-app ]; then
  mkdir -p ios-app/assets
  $R --fit-width 1024 icon.svg ios-app/assets/icon.png
  # 起動画面（2732×2732）: 紙色（ダークは黒）の地の中央にアイコンを置く
  for v in light dark; do
    if [ "$v" = light ]; then BG="#F3EFE6"; OUT=ios-app/assets/splash.png; else BG="#07080C"; OUT=ios-app/assets/splash-dark.png; fi
    { echo "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"2732\" height=\"2732\" viewBox=\"0 0 2732 2732\"><rect width=\"2732\" height=\"2732\" fill=\"$BG\"/><g transform=\"translate(1366 1366) scale(2.2) translate(-128 -128)\">";
      sed -n '/<rect width="256"/p; /<g id="art">/,/<\/g>/p' icon.svg | grep -v '<g id="art">' | grep -v '</g>';
      echo "</g></svg>"; } | $R - "$OUT"
  done
fi
echo "アイコンを作り直しました"
