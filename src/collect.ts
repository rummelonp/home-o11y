import { parseSwitchBotDevices } from "./config";
import { postServiceMetrics } from "./mackerel";
import type { Reading } from "./reading";
import { fetchDeviceReadings } from "./sources/switchbot";
import { storeReadings } from "./store";

/**
 * 全デバイスの値を読み、Mackerel に投稿して D1 に保存する。
 * 1 台の失敗では残りを止めず、Mackerel と D1 も互いに独立に試す。失敗があれば最後にまとめて投げ、
 * Cron の発火を失敗として残す。再送はしない（次の発火が新しい値を送る）。
 * @param measuredAt unix 秒。SwitchBot の status に測定時刻は無いので、全メトリックをこの時刻にそろえる
 */
export async function collect(env: Env, measuredAt: number): Promise<void> {
  const devices = parseSwitchBotDevices(env.SWITCHBOT_DEVICES);
  const credentials = { token: env.SWITCHBOT_TOKEN, secret: env.SWITCHBOT_SECRET };
  const fetched = await Promise.allSettled(
    devices.map((device) => fetchDeviceReadings(credentials, device)),
  );
  const readings: Reading[] = fetched.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  const errors: unknown[] = fetched.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );

  if (readings.length > 0) {
    const sent = await Promise.allSettled([
      postServiceMetrics(env.MACKEREL_API_KEY, env.MACKEREL_SERVICE, measuredAt, readings),
      storeReadings(env.DB, measuredAt, readings),
    ]);
    for (const result of sent) if (result.status === "rejected") errors.push(result.reason);
  }

  const messages = errors.map((error) => (error instanceof Error ? error.message : String(error)));
  const log = { event: "collect", measuredAt, readings: readings.length, errors: messages };
  if (errors.length === 0) {
    console.log(JSON.stringify(log));
    return;
  }
  console.error(JSON.stringify(log));
  throw new AggregateError(errors, messages.join("; "));
}
