import type { SwitchBotDevice } from "../config";
import type { Reading } from "../reading";

const API_BASE = "https://api.switch-bot.com/v1.1";
const SUCCESS_STATUS_CODE = 100;
// 応答の無い 1 台が、ほかの台の値の投稿と保存を待たせ続けないようにする
const REQUEST_TIMEOUT_MS = 10_000;

// status の body の項目名から、Reading の kind への対応。数値で返る項目だけを拾う。
// deviceType では分けず、返ってきた項目をそのまま使う（Hub 2 / Hub 3 は lightLevel、
// Meter Pro CO2 は CO2 と battery、Outdoor Meter は battery を返す）。
const FIELD_KINDS: Record<string, string> = {
  temperature: "temperature",
  humidity: "humidity",
  CO2: "co2",
  battery: "battery",
  lightLevel: "light_level",
};

export type SwitchBotCredentials = {
  token: string;
  secret: string;
};

/**
 * v1.1 の認証ヘッダーを作る。sign は base64(HMAC-SHA256(secret, token + t + nonce))。
 * API の README の手順は sign の大文字化を求めているが、公式の JS / Python のサンプルはしておらず、
 * base64 は大文字にすると別の値になるので、しない。
 */
export async function signedHeaders(
  credentials: SwitchBotCredentials,
  timestamp: number,
  nonce: string,
): Promise<Record<string, string>> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(credentials.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const t = String(timestamp);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(credentials.token + t + nonce),
  );
  return {
    Authorization: credentials.token,
    sign: btoa(String.fromCharCode(...new Uint8Array(signature))),
    t,
    nonce,
  };
}

export function readingsFromStatus(location: string, body: Record<string, unknown>): Reading[] {
  return Object.entries(FIELD_KINDS).flatMap(([field, kind]) => {
    const value = body[field];
    return typeof value === "number" && Number.isFinite(value) ? [{ kind, location, value }] : [];
  });
}

export async function fetchDeviceReadings(
  credentials: SwitchBotCredentials,
  device: SwitchBotDevice,
): Promise<Reading[]> {
  const headers = await signedHeaders(credentials, Date.now(), crypto.randomUUID());
  const response = await fetch(
    `${API_BASE}/devices/${encodeURIComponent(device.deviceId)}/status`,
    { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`SwitchBot ${device.location}: HTTP ${response.status} ${detail}`);
  }
  let json: { statusCode?: unknown; message?: unknown; body?: unknown };
  try {
    json = await response.json();
  } catch (error) {
    throw new Error(`SwitchBot ${device.location}: 応答が JSON ではありません`, { cause: error });
  }
  if (json.statusCode !== SUCCESS_STATUS_CODE || typeof json.body !== "object" || !json.body) {
    throw new Error(
      `SwitchBot ${device.location}: statusCode ${String(json.statusCode)} ${String(json.message)}`,
    );
  }
  const readings = readingsFromStatus(device.location, json.body as Record<string, unknown>);
  if (readings.length === 0) {
    throw new Error(`SwitchBot ${device.location}: status に測定値がありません`);
  }
  // SwitchBot は statusCode 100 のまま温度、湿度などを 0 にして返すことがある。
  // 0 を投稿するとグラフと監視が実際の変化と見分けられないので、その台の値は捨てて抜けにする。
  // 温度の 0 ℃ はありうるが、湿度 0 % は実際の環境では起きないので、これで見分ける。
  if (readings.some((reading) => reading.kind === "humidity" && reading.value === 0)) {
    throw new Error(`SwitchBot ${device.location}: 湿度が 0 の status は測定の失敗として捨てます`);
  }
  return readings;
}
