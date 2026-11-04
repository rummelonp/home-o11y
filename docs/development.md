# 開発

Node は 24 系（`.node-version`）、パッケージマネージャーは pnpm（バージョンは `package.json` の `packageManager`）。

```bash
pnpm install
pnpm lint          # biome check
pnpm format        # biome check --write
pnpm typecheck     # 生成した型が wrangler.jsonc と合うかの検査と、tsc --noEmit
pnpm test          # vitest run
pnpm types         # wrangler.jsonc から worker-configuration.d.ts を生成する
pnpm db:migrate    # 手元の D1 に migration を適用する
```

コミット時は lefthook が、ステージしたファイルに biome を実行する。

## テスト

テストは workerd の中で動かし、D1 には miniflare の実装を使う（`vitest.config.ts`）。
テストごとに空の D1 へ migration を適用し直す（`src/test/setup.ts`）。
SwitchBot と Mackerel への通信は、`vi.spyOn(globalThis, "fetch")` で差し替えて確かめる。
`vitest.config.ts` の bindings はテスト用の値で、手元の `.dev.vars` を上書きする。

## 変えるときに揃える箇所

- `wrangler.jsonc` の binding、vars、`secrets.required` を変えたら、`pnpm types` で `worker-configuration.d.ts` を生成し直してコミットに含める。
  `Env` の型は手書きしない。
  生成し直していないと `pnpm typecheck` が失敗する。
- `compatibility_date` は、手元の workerd（`wrangler` が入れる版）が対応する日付までにする。
  それより新しいと、テストと `wrangler dev` が起動しない。
- 場所の書式は、次のすべてで揃える。
  - 検査: `src/config.ts`、`scripts/deploy-config.mjs`
  - テスト: `src/config.test.ts`、`scripts/deploy-config.test.ts`
  - 説明: `deploy.env.example`、`src/reading.ts`、[design.md](./design.md) の「値の形とメトリック名の規則」
- メトリックの名前（`kind` と `location`）を変えると、Mackerel では別のメトリックになり、D1 では別の行になる。
  前の名前の値は自動では移らない。
- 適用済みの migration は書き換えず、新しいファイルを足す。
  migration はテーブルや列を足すだけにする（理由は [deploy.md](./deploy.md) の「更新」）。
- 取得元を足すときは、`src/sources/` に `Reading[]` を返す関数を置き、`src/collect.ts` から呼ぶ。
  1 つの取得元の失敗で、ほかの取得元の値の投稿と保存を止めない。
