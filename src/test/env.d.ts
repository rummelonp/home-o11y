import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      /** vitest.config.ts が migrations/ を読んで渡す。 */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
