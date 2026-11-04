# AGENTS.md

## 概要

家のセンサーの値を 5 分ごとの Cron Trigger で読み、Mackerel のサービスメトリックに投稿しつつ、Cloudflare D1 に貯める Worker。
HTTP リクエストは受けず、`scheduled` ハンドラーだけを実装する。
利用者向けの説明は [README.md](./README.md) にある。

- `src/index.ts`: `scheduled` ハンドラー
- `src/collect.ts`: 発火 1 回の流れ（読み取り、投稿、保存、失敗のまとめ）
- `src/sources/`: 取得元。1 ファイルにつき 1 つで、`Reading[]` を返す
- `src/mackerel.ts`、`src/store.ts`: Mackerel への投稿と D1 への保存
- `src/config.ts`: `SWITCHBOT_DEVICES` の解析
- `migrations/`: D1 の migration
- `scripts/`: `deploy.env` からのデプロイ用の設定の生成（`deploy-config.mjs`、`deploy.mjs`）と、SwitchBot の deviceId を調べるスクリプト

## ドキュメント

該当する作業のときに読む。

- [docs/development.md](./docs/development.md): コマンド、テストの仕組み、変えるときに揃える箇所。コードを変える前に読む
- [docs/deploy.md](./docs/deploy.md): 初回のセットアップ、更新、secret の入れ替え、デバイスの追加、手元で動かす手順
- [docs/design.md](./docs/design.md): 発火 1 回の流れと失敗の扱い、値の形とメトリック名の規則、D1 のテーブル、取得元ごとに拾う項目

## 外部への書き込み

Cloudflare のアカウント、Mackerel、SwitchBot API に作用するコマンドは、ユーザーが明示的に頼んだときだけ実行する。
コマンドの名前ではなく作用で判断する。たとえば次のものが当たる。

- Cloudflare のアカウントを変える wrangler のコマンド（`deploy`、`d1 create`、`d1 execute --remote`、`d1 migrations apply --remote`、`secret`、`delete`、`rollback`、`login` など）と、それを呼ぶ `pnpm deploy:remote`、`pnpm db:migrate:remote`
- `pnpm dev` での Cron の発火（`/__scheduled`）。`.dev.vars` の値で SwitchBot API を呼び、本番の Mackerel のサービス `home` に投稿する
- `scripts/switchbot-devices.mjs`。書き込みはしないが、SwitchBot API の 1 日の呼び出し回数の上限を消費する

デプロイを頼まれても `wrangler deploy` は直接実行せず、`pnpm deploy:remote` を使う。
直接実行すると、wrangler が新しい D1 を作り、`wrangler.jsonc` に書き込む。

secret の値は扱わない。
`deploy.secrets.env` と `.dev.vars` に値を書くのはユーザーで、エージェントはその中身を読まず、コマンドの引数にも値を書かない。
1Password の値が要るときは `op run --env-file=.env.op` で `op://` の参照を渡し、値を表示しない（`.env.op` は参照だけなので読んでよい）。
`deploy.env`、`deploy.secrets.env`、`.dev.vars`、`.env.op`、`wrangler.deploy.json` はコミットしない。

## 規約

- README、`docs/`、AGENTS.md、コメントは日本語の常体（である調）で書く。
  コメントはコードから自明でないこと（今も有効な判断の理由、制約）だけを書き、変更の経緯は書かない。
- 文書は読み手で置き場所を分ける。
  利用者向けの説明は README.md、エージェントだけに向けた規則は AGENTS.md に置く。
  両方が読むコマンド、手順、設計は `docs/` に置き、README.md と AGENTS.md からリンクする。
- 術語は分野で慣用されている語を使う（table は「テーブル」、index は「インデックス」）。
- 不具合を直したら回帰のテストを足し、修正を外すと落ちることを確かめる。
- コミットの前に `pnpm lint`、`pnpm typecheck`、`pnpm test` がすべて通ることを確かめる。
- 高リスクの領域は、D1 の migration（値が溜まってからは戻しにくい）、メトリックの名前、secret の扱い。
  migration でテーブルや列を消すか名前を変える変更と、メトリックの名前を変える変更は、ユーザーに確かめてから行う。
