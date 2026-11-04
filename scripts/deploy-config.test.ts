import { describe, expect, it } from "vitest";
import { composeConfig, readDeployValues } from "./deploy-config.mjs";

const DATABASE_ID = "01234567-89ab-cdef-0123-456789abcdef";

describe("readDeployValues", () => {
  it("D1 の ID とデバイスの一覧を読む", () => {
    const result = readDeployValues(
      `D1_DATABASE_ID=${DATABASE_ID}\nSWITCHBOT_DEVICES=AAA:living, BBB:room\n`,
    );
    expect(result).toEqual({
      values: {
        d1DatabaseId: DATABASE_ID,
        switchbotDevices: "AAA:living, BBB:room",
        accountId: undefined,
      },
      warnings: [],
    });
  });

  it("欠けた値と形式の誤りをまとめて返す", () => {
    expect(
      readDeployValues("SWITCHBOT_DEVICES=AAA:living.east,BBB,CCC:room,DDD:room,\nOTHER=1\n"),
    ).toEqual({
      problems: [
        "D1_DATABASE_ID がありません",
        expect.stringContaining("誤り: AAA:living.east, BBB"),
        "SWITCHBOT_DEVICES の場所 room が重複しています",
      ],
    });
  });

  it("カンマだけの値はデバイスが無いとして止める", () => {
    expect(readDeployValues(`D1_DATABASE_ID=${DATABASE_ID}\nSWITCHBOT_DEVICES= , \n`)).toEqual({
      problems: ["SWITCHBOT_DEVICES にデバイスがありません"],
    });
  });
});

describe("composeConfig", () => {
  it("D1 の ID と SWITCHBOT_DEVICES を重ね、元の設定は変えない", () => {
    const base = {
      name: "home-o11y",
      d1_databases: [{ binding: "DB", database_name: "home-o11y" }],
      vars: { MACKEREL_SERVICE: "home" },
    };
    const config = composeConfig(base, {
      d1DatabaseId: DATABASE_ID,
      switchbotDevices: "AAA:living",
      accountId: undefined,
    });
    expect(config).toEqual({
      name: "home-o11y",
      d1_databases: [{ binding: "DB", database_name: "home-o11y", database_id: DATABASE_ID }],
      vars: { MACKEREL_SERVICE: "home", SWITCHBOT_DEVICES: "AAA:living" },
    });
    expect(base.d1_databases[0]).not.toHaveProperty("database_id");
  });
});
