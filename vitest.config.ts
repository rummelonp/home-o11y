import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url)));

export default defineConfig({
  test: {
    projects: [
      {
        // src のテストは workerd の中で動かし、D1 も miniflare の実装を使う
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              // wrangler の設定を読むと手元の .dev.vars も入るので、テストの値で上書きして結果を揃える
              bindings: {
                TEST_MIGRATIONS: migrations,
                SWITCHBOT_TOKEN: "test-token",
                SWITCHBOT_SECRET: "test-secret",
                SWITCHBOT_DEVICES: "HUB000000001:living,CO2000000001:room,OUT000000001:balcony",
                MACKEREL_API_KEY: "test-mackerel-key",
              },
            },
          }),
        ],
        test: {
          name: "worker",
          include: ["src/**/*.test.ts"],
          setupFiles: ["./src/test/setup.ts"],
          // workerd 内のモジュールの読み込みが vitest 5 の fs module cache を読めず、キャッシュが
          // あると全ファイルが失敗する（@cloudflare/vitest-plugin 1.4.0 で確認）。
          fsModuleCache: false,
        },
      },
      {
        test: {
          name: "scripts",
          include: ["scripts/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
