// Mackerel のサービスに投稿済みのメトリックから監視を作り、すでにあれば上書きする。
//   MACKEREL_API_KEY=... node scripts/mackerel-monitors.mjs [--dry-run]
// メトリックの一覧は Mackerel から読むので、デバイスを足したら、値が 1 回投稿されたあとに実行し直す。
// 監視は名前で照合する。場所の名前を変えたときの古い監視は消さず、一覧を表示するだけにとどめる。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BASE_CONFIG_PATH, stripJsonc } from "./deploy-config.mjs";

const API_BASE = "https://api.mackerelio.com/api/v0";
// CO2 の濃度の換気の目安。建築物衛生法の室内の基準が 1000 ppm
const CO2_WARNING = 1000;
const CO2_CRITICAL = 1500;
const BATTERY_WARNING = 20;
const BATTERY_CRITICAL = 10;
// 投稿は 5 分ごとなので、20 分（4 回分）届かなければ警告にする（途切れの閾値は 10 分の倍数に限られる）
const MISSING_WARNING_MINUTES = 20;
const MISSING_CRITICAL_MINUTES = 60;
// metric-names のうち、この期間に値のある名前だけを今も投稿しているとみなす
const RECENT_SECONDS = 60 * 60;

// 監視を並べる順。ここに無い種類は後ろに回す
const KIND_ORDER = ["temperature", "humidity", "co2", "light_level", "battery"];

/** @typedef {{ kind: string; location: string; name: string }} Metric */

/**
 * `<種類>.<場所>` の名前を分ける。形の違う名前は、この Worker のものではないので除く。
 * @param {string[]} names
 * @returns {Metric[]}
 */
export function parseMetricNames(names) {
  return names.flatMap((name) => {
    const match = /^([a-z0-9_-]+)\.([a-z0-9_-]+)$/.exec(name);
    return match?.[1] && match[2] ? [{ kind: match[1], location: match[2], name }] : [];
  });
}

/** @param {string} kind */
function kindRank(kind) {
  const index = KIND_ORDER.indexOf(kind);
  return index === -1 ? KIND_ORDER.length : index;
}

/** @param {Metric[]} metrics */
function sortMetrics(metrics) {
  return [...metrics].sort(
    (a, b) =>
      kindRank(a.kind) - kindRank(b.kind) ||
      a.kind.localeCompare(b.kind) ||
      a.location.localeCompare(b.location),
  );
}

/**
 * @param {string} service
 * @param {string[]} metricNames
 */
export function buildMonitors(service, metricNames) {
  const metrics = sortMetrics(parseMetricNames(metricNames));
  const base = { type: "service", service, maxCheckAttempts: 1 };
  const monitors = [];

  // 途切れは場所ごとに 1 つの監視で見る。1 台の値はまとめて投稿されるので、どの種類でも同じになる
  const locations = [...new Set(metrics.map((metric) => metric.location))].sort();
  for (const location of locations) {
    const own = metrics.filter((metric) => metric.location === location);
    const watched = own.find((metric) => metric.kind === "temperature") ?? own[0];
    if (!watched) continue;
    monitors.push({
      ...base,
      name: `${service} ${location} の値の途切れ`,
      memo: "Worker の停止や SwitchBot API の失敗で値が来なくなると通知する",
      metric: watched.name,
      duration: 1,
      operator: ">",
      missingDurationWarning: MISSING_WARNING_MINUTES,
      missingDurationCritical: MISSING_CRITICAL_MINUTES,
    });
  }
  for (const metric of metrics.filter((m) => m.kind === "co2")) {
    monitors.push({
      ...base,
      name: `${service} ${metric.location} の CO2`,
      memo: `${CO2_WARNING} ppm が換気の目安`,
      metric: metric.name,
      // 10 分の平均で見て、一時的な上振れでは通知しない
      duration: 2,
      operator: ">",
      warning: CO2_WARNING,
      critical: CO2_CRITICAL,
    });
  }
  for (const metric of metrics.filter((m) => m.kind === "battery")) {
    monitors.push({
      ...base,
      name: `${service} ${metric.location} の電池`,
      memo: "電池の交換の目安",
      metric: metric.name,
      duration: 1,
      operator: "<",
      warning: BATTERY_WARNING,
      critical: BATTERY_CRITICAL,
    });
  }
  return monitors;
}

/**
 * 既存の監視と照合して、作るもの、上書きするもの、どちらにも当たらない既存のものに分ける。
 * 上書きでは、画面で付けたミュートと通知の再送間隔を残す（PUT は省いた項目を既定値に戻すため）。
 * 同じ名前の既存の監視が複数あれば、最初の 1 つを上書きし、残りは duplicated に分ける。
 * @param {string} service
 * @param {{ id: string; type: string; name: string; service?: string; isMute?: boolean; notificationInterval?: number }[]} existing
 * @param {{ name: string }[]} desired
 */
export function planMonitors(service, existing, desired) {
  const own = existing.filter(
    (monitor) => monitor.type === "service" && monitor.service === service,
  );
  /** @type {Map<string, (typeof own)[number]>} */
  const byName = new Map();
  const duplicated = [];
  for (const monitor of own) {
    if (byName.has(monitor.name)) {
      duplicated.push(monitor);
    } else {
      byName.set(monitor.name, monitor);
    }
  }
  const create = [];
  const update = [];
  for (const monitor of desired) {
    const current = byName.get(monitor.name);
    if (current) {
      const kept =
        current.notificationInterval === undefined
          ? {}
          : { notificationInterval: current.notificationInterval };
      update.push({
        id: current.id,
        body: { ...monitor, ...kept, isMute: current.isMute ?? false },
      });
    } else {
      create.push(monitor);
    }
  }
  const names = new Set(desired.map((monitor) => monitor.name));
  const unmatched = [...byName.values()].filter((monitor) => !names.has(monitor.name));
  return { create, update, unmatched, duplicated };
}

/** wrangler.jsonc の vars から、投稿先のサービス名を読む */
function readServiceName() {
  const config = JSON.parse(stripJsonc(readFileSync(BASE_CONFIG_PATH, "utf8")));
  const service = config.vars?.MACKEREL_SERVICE;
  if (typeof service !== "string" || service === "") {
    throw new Error("wrangler.jsonc の vars に MACKEREL_SERVICE がありません");
  }
  return service;
}

/** @param {string} apiKey */
function client(apiKey) {
  /**
   * @param {string} method
   * @param {string} path
   * @param {unknown} [body]
   */
  return async (method, path, body) => {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(`Mackerel ${method} ${path}: HTTP ${response.status} ${text.slice(0, 500)}`);
    }
    return JSON.parse(text);
  };
}

/** @param {string[]} argv */
async function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const apiKey = process.env.MACKEREL_API_KEY;
  if (!apiKey) throw new Error("環境変数 MACKEREL_API_KEY を設定してください");
  const service = readServiceName();
  const api = client(apiKey);

  const { names } = await api("GET", `/services/${encodeURIComponent(service)}/metric-names`);
  // metric-names は投稿をやめた古い名前も返すので、直近に値がある名前だけで監視を組み立てる。
  // 古い名前を含めると、場所の名前を変えたあとも古い場所の監視を作り直し続ける。
  const to = Math.floor(Date.now() / 1000);
  /** @type {string[]} */
  const recent = [];
  /** @type {string[]} */
  const stale = [];
  for (const name of parseMetricNames(names).map((metric) => metric.name)) {
    const query = new URLSearchParams({ name, from: String(to - RECENT_SECONDS), to: String(to) });
    const { metrics } = await api(
      "GET",
      `/services/${encodeURIComponent(service)}/metrics?${query}`,
    );
    (metrics.length > 0 ? recent : stale).push(name);
  }
  if (recent.length === 0) {
    throw new Error(
      `サービス ${service} に直近の値がありません。値が投稿されてから実行してください`,
    );
  }
  const { monitors: existing } = await api("GET", "/monitors");
  const plan = planMonitors(service, existing, buildMonitors(service, recent));
  for (const name of stale) {
    process.stdout.write(`直近 1 時間に値の無いメトリック（監視を作らない）: ${name}\n`);
  }
  for (const monitor of plan.duplicated) {
    process.stdout.write(
      `同じ名前の監視が複数ある（上書きしていない）: ${monitor.name} (${monitor.id})\n`,
    );
  }

  if (dryRun) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  for (const monitor of plan.create) {
    await api("POST", "/monitors", monitor);
    process.stdout.write(`監視を作った: ${monitor.name}\n`);
  }
  for (const { id, body } of plan.update) {
    await api("PUT", `/monitors/${id}`, body);
    process.stdout.write(`監視を上書きした: ${body.name}\n`);
  }
  for (const monitor of plan.unmatched) {
    process.stdout.write(`このスクリプトの定義に無い監視（消していない）: ${monitor.name}\n`);
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
