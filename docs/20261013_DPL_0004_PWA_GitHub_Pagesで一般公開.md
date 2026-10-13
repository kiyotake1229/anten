# GitHub Pages で一般公開（サポートページを含む）

- 管理番号: #0004
- 種類: DPL（デプロイ関連）
- 対象: PWA と公開用の素材（PWA）
- 作成日: 2026-10-13
- 関連: #0003（公開した版）、#0005（iOS のビルド確認も同じリポジトリで行う）

## 概要

`新感覚/` を git で管理し、GitHub の `kiyotake1229/anten`（公開）に push して GitHub Pages で公開した。App Store 申請に必要なサポート URL とプライバシーポリシーは `support.html` に置いた。

## 対象ファイル

- `support.html` … サポートページ（遊び方の要点・よくある質問・お知らせについて・プライバシーポリシー・お問い合わせ）。新規
- `.gitignore` … `node_modules` / `www` / `Pods` / `public` など、作られるものを除外
- `.nojekyll` … GitHub Pages で Jekyll を通さない（`_` で始まる名前などをそのまま配る）
- `README.md` … 公開 URL を記載

## 手順（再現用）

```bash
cd 新感覚
git init -b main && git add -A && git commit -m "[#0001][#0002] ..."
gh repo create kiyotake1229/anten --public --source=. --remote=origin --push
gh api -X POST repos/kiyotake1229/anten/pages -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/'
```

以後は `index.html` を直してコミット・push すると、数十秒〜数分で反映される。`sw.js` はページをネット優先で取るので、版を上げなくても次に開いたときに届く。

## 確認URL

| 環境 | URL |
|------|-----|
| 本番（アプリ） | https://kiyotake1229.github.io/anten/ |
| サポート・プライバシーポリシー | https://kiyotake1229.github.io/anten/support.html （ポリシーは `#privacy`） |
| リポジトリ | https://github.com/kiyotake1229/anten |
| お問い合わせ（Issues） | https://github.com/kiyotake1229/anten/issues |

## 作業概要と概算費用

| 項目 | 内容 | 工数 |
|------|------|------|
| 実装 | support.html、git 整備、公開 | 1h |
| 合計 | | 1h（0.1人日） |
