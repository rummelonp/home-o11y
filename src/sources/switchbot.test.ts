import { describe, expect, it } from "vitest";
import { readingsFromStatus, signedHeaders } from "./switchbot";

describe("signedHeaders", () => {
  it("Node の crypto で作った HMAC-SHA256 の base64 と一致する", async () => {
    const headers = await signedHeaders(
      { token: "test-token", secret: "test-secret" },
      1700000000000,
      "00000000-0000-4000-8000-000000000000",
    );
    expect(headers).toEqual({
      Authorization: "test-token",
      // node -e 'crypto.createHmac("sha256", secret).update(token + t + nonce).digest("base64")'
      sign: "ObPx7jZBqVFCJwAv6dn0co/1gzLeAchdaJQBjOZFHOA=",
      t: "1700000000000",
      nonce: "00000000-0000-4000-8000-000000000000",
    });
  });
});

// body は SwitchBotAPI の devices/hubs/hub-2.md、devices/sensors/*.md の例
describe("readingsFromStatus", () => {
  it("Hub 2 の温度、湿度、照度を拾う", () => {
    const body = {
      deviceId: "HUB000000001",
      deviceType: "WoHub2",
      hubDeviceId: "HUB000000001",
      temperature: 13,
      humidity: 18,
      lightLevel: 19,
      version: "V0.1-23.11-0.4",
    };
    expect(readingsFromStatus("living", body)).toEqual([
      { kind: "temperature", location: "living", value: 13 },
      { kind: "humidity", location: "living", value: 18 },
      { kind: "light_level", location: "living", value: 19 },
    ]);
  });

  it("Meter Pro CO2 の CO2 と電池を拾う", () => {
    const body = {
      deviceId: "CO2000000001",
      deviceType: "MeterPro(CO2)",
      hubDeviceId: "HUB000000001",
      temperature: 22.5,
      version: "V0.1",
      humidity: 31,
      CO2: 1203,
      battery: 100,
    };
    expect(readingsFromStatus("room", body)).toEqual([
      { kind: "temperature", location: "room", value: 22.5 },
      { kind: "humidity", location: "room", value: 31 },
      { kind: "co2", location: "room", value: 1203 },
      { kind: "battery", location: "room", value: 100 },
    ]);
  });

  it("数値でない項目と欠けた項目は拾わない", () => {
    const body = { deviceType: "WoIOSensor", temperature: "22.5", humidity: null, battery: 60 };
    expect(readingsFromStatus("balcony", body)).toEqual([
      { kind: "battery", location: "balcony", value: 60 },
    ]);
  });
});
