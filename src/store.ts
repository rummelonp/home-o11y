import type { Reading } from "./reading";

/**
 * 主キーが同じ行は上書きする。Cron の同じ発火を再実行しても行は増えない。
 */
export async function storeReadings(
  db: D1Database,
  measuredAt: number,
  readings: Reading[],
): Promise<void> {
  const statement = db.prepare(
    "INSERT OR REPLACE INTO readings (location, kind, measured_at, value) VALUES (?, ?, ?, ?)",
  );
  await db.batch(
    readings.map((reading) =>
      statement.bind(reading.location, reading.kind, measuredAt, reading.value),
    ),
  );
}
