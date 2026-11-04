# デプロイと運用

コマンドはリポジトリの直下で実行する。
`--remote` を付けたコマンドと `pnpm deploy:remote` は、`deploy.env` に書いた Cloudflare アカウントを操作する。
`wrangler deploy` は直接実行せず、`pnpm deploy:remote` を使う。
直接実行すると、database_id の無い `wrangler.jsonc` を読み、wrangler が新しい D1 を作って `wrangler.jsonc` に書き込む。

## 初回のセットアップ

1. Mackerel で、サービス `home` を作る（サービスメトリックは、存在するサービスにしか投稿できない）。
   API キーは、Write 権限のあるものを使う。
2. SwitchBot アプリで、SwitchBot API の token と secret を取り出す（プロフィール → 設定 → アプリバージョンを 10 回タップ → 開発者向けオプション）。
3. デバイスの deviceId を調べる。

   ```bash
   read -rs SWITCHBOT_TOKEN && read -rs SWITCHBOT_SECRET && export SWITCHBOT_TOKEN SWITCHBOT_SECRET
   node scripts/switchbot-devices.mjs
   ```

   1Password に入れてあるなら、「[1Password から secret を渡す](#1password-から-secret-を渡す)」の `.env.op` を作り、`op run` で渡す。

   ```bash
   op run --env-file=.env.op -- node scripts/switchbot-devices.mjs
   ```

4. Cloudflare にログインし、D1 のデータベースを作る。
   `--update-config=false` を付けないと、wrangler が git で管理している `wrangler.jsonc` に binding を書き込む。
   アカウントが複数あるときは、ここで選んだアカウントを手順 5 の `CLOUDFLARE_ACCOUNT_ID` にも書く。

   ```bash
   pnpm exec wrangler login
   pnpm exec wrangler d1 create home-o11y --update-config=false
   ```

5. `cp deploy.env.example deploy.env` を実行する。
   手順 4 で表示された database_id を `D1_DATABASE_ID` に、手順 3 の deviceId と場所を `SWITCHBOT_DEVICES` に書く。
6. D1 にテーブルを作る。

   ```bash
   pnpm db:migrate:remote
   ```

7. Worker の secret に入れる 3 つの値を `deploy.secrets.env`（gitignore 済み）に書き、secret と一緒に Worker をデプロイする。
   `wrangler.jsonc` の `secrets.required` に 3 つの名前を並べてあるので、初回のデプロイは secret が揃わないと止まる。
   dotenv の形式では `$VAR` が展開されるので、値に `$` を含むときは `\$` と書く。
   デプロイしたら `deploy.secrets.env` を消す。

   ```
   SWITCHBOT_TOKEN=...
   SWITCHBOT_SECRET=...
   MACKEREL_API_KEY=...
   ```

   ```bash
   pnpm deploy:remote -- --secrets-file deploy.secrets.env
   rm deploy.secrets.env
   ```

   1Password に入れてあるなら、`deploy.secrets.env` を作らずに `.env.op` を渡す（[1Password から secret を渡す](#1password-から-secret-を渡す)）。

   ```bash
   op run --env-file=.env.op -- pnpm deploy:remote -- --secrets-file .env.op
   ```

8. 5 分ほど待ち、Mackerel のサービス `home` にグラフが出ること、D1 に行が入ることを確かめる。
   値が入らないときは、Cloudflare のダッシュボードで Worker の Logs を開き、失敗した発火のログを読む。

   ```bash
   pnpm exec wrangler d1 execute DB --remote --config wrangler.deploy.json \
     --command "SELECT * FROM readings ORDER BY measured_at DESC LIMIT 20"
   ```

9. 監視を作る（中身は [design.md](./design.md) の「Mackerel のダッシュボードと監視」）。
   Mackerel に投稿済みのメトリック名から定義を作るので、手順 8 で値が入ってから実行する。
   `--dry-run` を付けると、作る定義を表示するだけで書き込まない。

   ```bash
   op run --env-file=.env.op -- node scripts/mackerel-monitors.mjs
   ```

   1Password を使わないなら、`MACKEREL_API_KEY` を環境変数に入れて `node scripts/mackerel-monitors.mjs` を実行する。
   ダッシュボードは Mackerel の画面で作る。

この Worker は Cron Trigger を 1 本使う。
Workers の Free プランでは、Cron Trigger はアカウント全体で 5 本までである。

## 1Password から secret を渡す

`.env.op`（gitignore 済み）に、Worker の 3 つの secret の名前と、1Password の `op://` の参照だけを書く。
平文の値はこのファイルにも、シェルの履歴にも残らない。

```
SWITCHBOT_TOKEN=op://<vault>/<item>/<token のフィールド>
SWITCHBOT_SECRET=op://<vault>/<item>/<secret のフィールド>
MACKEREL_API_KEY=op://<vault>/<item>/<API キーのフィールド>
```

`op run --env-file=.env.op -- <コマンド>` は、参照を値に解決した環境変数を付けてコマンドを実行する。
`--secrets-file .env.op` を一緒に渡すと、wrangler はファイルの値（`op://` の参照）より、同じ名前の環境変数（解決した値）を使う。
そのため `.env.op` は `op run` を通してだけ渡す。
`op run` を通さずに渡すと、`op://` の参照の文字列がそのまま secret に入る。
`.env.op` に 3 つ以外の名前を書くと、それも secret としてアップロードされる。

## 更新

migration を含む版は、デプロイより先に migration を適用する。
デプロイが先だと、新しい版が使うテーブルや列がまだ無く、保存が失敗する。
migration からデプロイまでの間は前の版が動くので、migration はテーブルや列を足すだけにし、前の版の保存を壊さない形で書く。

```bash
pnpm db:migrate:remote
pnpm deploy:remote
```

secret は前の版から引き継ぐので、2 回目からのデプロイには渡さなくてよい。

## secret の入れ替え

`wrangler secret put` には、`deploy.env` から生成した `wrangler.deploy.json` を `--config` で渡す（`CLOUDFLARE_ACCOUNT_ID` はこのファイルにだけ入るため）。
`wrangler.deploy.json` が無ければ、先に `node scripts/deploy.mjs config` で生成する。

```bash
pnpm exec wrangler secret put MACKEREL_API_KEY --config wrangler.deploy.json
```

## デバイスの追加と場所の変更

`deploy.env` の `SWITCHBOT_DEVICES` を書き換えて、`pnpm deploy:remote` を実行する。
場所の名前を変えると、Mackerel では別のメトリックになり、D1 では別の `location` の行になる。
変える前の値は前の名前のまま残る。

デプロイしたら、新しい名前の値が Mackerel に 1 回入るのを待ってから、`scripts/mackerel-monitors.mjs` を実行し直す（初回のセットアップの手順 9）。
スクリプトは新しい名前の場所の監視を作り、同じ名前の既存の監視を上書きする。
ダッシュボードの数値ウィジェットは、Mackerel の画面で足す（グラフウィジェットには自動で並ぶ）。
前の名前の監視は消えずに残り、スクリプトが古い監視の名前を表示するので、要らなければ Mackerel の画面で消す。

## 手元で動かす

`.dev.vars`（gitignore 済み）に、Worker の 3 つの secret とデバイスの一覧を書く。

```
SWITCHBOT_TOKEN=...
SWITCHBOT_SECRET=...
MACKEREL_API_KEY=...
SWITCHBOT_DEVICES=XXXXXXXXXXXX:living,XXXXXXXXXXXX:room,XXXXXXXXXXXX:balcony
```

手元の D1 にテーブルを作り、Cron の発火を 1 回起こす。
手元で動かしても、SwitchBot API を呼び、値を Mackerel のサービス `home` に投稿する。
D1 の値は手元（`.wrangler/`）に入る。

```bash
pnpm db:migrate
pnpm dev
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```
