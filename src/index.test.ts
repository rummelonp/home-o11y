import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import worker from "./index";

// vitest.config.ts の SWITCHBOT_DEVICES と同じ ID
const STATUSES: Record<string, Record<string, unknown>> = {
  HUB000000001: { deviceType: "WoHub2", temperature: 21.5, humidity: 40, lightLevel: 12 },
  CO2000000001: {
    deviceType: "MeterPro(CO2)",
    temperature: 23.1,
    humidity: 45,
    CO2: 820,
    battery: 90,
  },
  OUT000000001: { deviceType: "WoIOSensor", temperature: 12.3, humidity: 70, battery: 100 },
};

// 2026-11-06T03:00:00Z。Cron の予定時刻はミリ秒で来て、秒に丸めて使う
const SCHEDULED_TIME = 1793934000000;
const MEASURED_AT = 1793934000;

type Captured = { switchbot: Request[]; mackerel: Request[] };

function mockFetch(
  options: {
    failDevice?: string;
    htmlDevice?: string;
    serverErrorDevice?: string;
    mackerelStatus?: number;
  } = {},
): Captured & { mackerelBodies: () => Promise<unknown[]> } {
  const captured: Captured = { switchbot: [], mackerel: [] };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === "api.switch-bot.com") {
      captured.switchbot.push(request);
      const deviceId = url.pathname.split("/")[3] ?? "";
      if (deviceId === options.htmlDevice) return new Response("<html>maintenance</html>");
      if (deviceId === options.serverErrorDevice) {
        return Response.json({ message: "Internal server error" }, { status: 500 });
      }
      if (deviceId === options.failDevice) {
        return Response.json({ statusCode: 190, message: "device internal error", body: {} });
      }
      return Response.json({ statusCode: 100, message: "success", body: STATUSES[deviceId] });
    }
    if (url.hostname === "api.mackerelio.com") {
      captured.mackerel.push(request.clone());
      const status = options.mackerelStatus ?? 200;
      return Response.json(status === 200 ? { success: true } : { error: "x" }, { status });
    }
    throw new Error(`unexpected fetch: ${request.url}`);
  });
  return {
    ...captured,
    mackerelBodies: () => Promise.all(captured.mackerel.map((r) => r.json())),
  };
}

async function runScheduled(): Promise<void> {
  const controller = createScheduledController({
    scheduledTime: SCHEDULED_TIME,
    cron: "*/5 * * * *",
  });
  await worker.scheduled(controller, env);
}

async function storedRows() {
  const { results } = await env.DB.prepare(
    "SELECT location, kind, measured_at, value FROM readings ORDER BY location, kind",
  ).all();
  return results;
}

describe("scheduled", () => {
  it("全デバイスの値を Mackerel に投稿し、D1 に保存する", async () => {
    const fetched = mockFetch();
    await runScheduled();

    expect(fetched.switchbot.map((r) => new URL(r.url).pathname).sort()).toEqual([
      "/v1.1/devices/CO2000000001/status",
      "/v1.1/devices/HUB000000001/status",
      "/v1.1/devices/OUT000000001/status",
    ]);
    const switchbotHeaders = fetched.switchbot[0]?.headers;
    expect(switchbotHeaders?.get("Authorization")).toBe("test-token");
    expect(switchbotHeaders?.get("sign")).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(switchbotHeaders?.get("t")).toMatch(/^\d{13}$/);

    expect(fetched.mackerel).toHaveLength(1);
    const mackerelRequest = fetched.mackerel[0];
    expect(mackerelRequest?.method).toBe("POST");
    expect(mackerelRequest?.url).toBe("https://api.mackerelio.com/api/v0/services/home/tsdb");
    expect(mackerelRequest?.headers.get("X-Api-Key")).toBe("test-mackerel-key");
    expect(mackerelRequest?.headers.get("Content-Type")).toBe("application/json");
    const [metrics] = await fetched.mackerelBodies();
    expect(metrics).toEqual(
      expect.arrayContaining([
        { name: "temperature.living", time: MEASURED_AT, value: 21.5 },
        { name: "light_level.living", time: MEASURED_AT, value: 12 },
        { name: "co2.room", time: MEASURED_AT, value: 820 },
        { name: "battery.balcony", time: MEASURED_AT, value: 100 },
      ]),
    );
    expect(metrics).toHaveLength(10);

    const rows = await storedRows();
    expect(rows).toHaveLength(10);
    expect(rows).toContainEqual({
      location: "room",
      kind: "co2",
      measured_at: MEASURED_AT,
      value: 820,
    });
  });

  it("1 台が失敗しても残りを投稿・保存し、発火は失敗にする", async () => {
    const fetched = mockFetch({ failDevice: "CO2000000001" });
    await expect(runScheduled()).rejects.toThrow(/room: statusCode 190/);

    const [metrics] = await fetched.mackerelBodies();
    expect(metrics).toHaveLength(6);
    const rows = await storedRows();
    expect(rows.map((row) => row.location)).not.toContain("room");
    expect(rows).toHaveLength(6);
  });

  it("Mackerel が失敗しても D1 には保存し、発火は失敗にする", async () => {
    mockFetch({ mackerelStatus: 503 });
    await expect(runScheduled()).rejects.toThrow(/Mackerel: HTTP 503/);
    expect(await storedRows()).toHaveLength(10);
  });

  it("D1 が失敗しても Mackerel には投稿し、発火は失敗にする", async () => {
    const fetched = mockFetch();
    vi.spyOn(env.DB, "batch").mockRejectedValue(new Error("D1 unavailable"));
    await expect(runScheduled()).rejects.toThrow(/D1 unavailable/);
    const [metrics] = await fetched.mackerelBodies();
    expect(metrics).toHaveLength(10);
  });

  it("HTTP のエラーは、応答の本文を付けて失敗にする", async () => {
    mockFetch({ serverErrorDevice: "HUB000000001" });
    await expect(runScheduled()).rejects.toThrow(
      'SwitchBot living: HTTP 500 {"message":"Internal server error"}',
    );
  });

  it("応答が JSON でない台は、場所を付けて失敗にする", async () => {
    mockFetch({ htmlDevice: "OUT000000001" });
    await expect(runScheduled()).rejects.toThrow(/balcony: 応答が JSON ではありません/);
    expect(await storedRows()).toHaveLength(7);
  });

  it("同じ発火を再実行しても行は増えない", async () => {
    mockFetch();
    await runScheduled();
    await runScheduled();
    expect(await storedRows()).toHaveLength(10);
  });
});
