import { metricName, type Reading } from "./reading";

const API_BASE = "https://api.mackerelio.com/api/v0";

/**
 * サービスメトリックを投稿する。サービスは Mackerel 側で先に作っておく必要がある。
 * time は unix 秒。24 時間より古い time の値は、200 を返したうえで捨てられる。
 */
export async function postServiceMetrics(
  apiKey: string,
  service: string,
  time: number,
  readings: Reading[],
): Promise<void> {
  const body = readings.map((reading) => ({
    name: metricName(reading),
    time,
    value: reading.value,
  }));
  const response = await fetch(`${API_BASE}/services/${encodeURIComponent(service)}/tsdb`, {
    method: "POST",
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // 応答を待ち続けると、同じ発火の D1 への保存の結果まで報告が遅れる
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`Mackerel: HTTP ${response.status} ${detail}`);
  }
}
