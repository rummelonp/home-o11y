// コミットされた wrangler.jsonc と、デプロイ先ごとの値（deploy.env）から、デプロイ用の設定を合成する。
// 合成結果は wrangler.deploy.json に書く。`main` と `migrations_dir` は設定ファイルからの相対パスなので、
// wrangler.jsonc と同じディレクトリに置かないと解決できなくなる。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
export const BASE_CONFIG_PATH = `${ROOT_DIR}wrangler.jsonc`;
export const DEPLOY_ENV_PATH = `${ROOT_DIR}deploy.env`;
export const GENERATED_CONFIG_PATH = `${ROOT_DIR}wrangler.deploy.json`;

const D1_BINDING = "DB";

/**
 * @typedef {{
 *   d1DatabaseId: string;
 *   switchbotDevices: string;
 *   accountId: string | undefined;
 * }} DeployValues
 */

/**
 * 文字列リテラルの終わりの位置を返す。`start` は開きの引用符の位置。
 * @param {string} text
 * @param {number} start
 */
function stringEnd(text, start) {
  let i = start + 1;
  while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
  return i;
}

/**
 * JSONC のコメントと末尾カンマを取り除く。文字列リテラルの中の `//` などには触れない。
 * @param {string} text
 * @returns {string}
 */
export function stripJsonc(text) {
  let withoutComments = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      const end = stringEnd(text, i);
      withoutComments += text.slice(i, end + 1);
      i = end + 1;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      withoutComments += ch;
      i++;
    }
  }

  let out = "";
  i = 0;
  while (i < withoutComments.length) {
    const ch = withoutComments[i];
    if (ch === '"') {
      const end = stringEnd(withoutComments, i);
      out += withoutComments.slice(i, end + 1);
      i = end + 1;
    } else if (ch === "," && /^\s*[}\]]/.test(withoutComments.slice(i + 1))) {
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

const KNOWN_KEYS = new Set(["D1_DATABASE_ID", "SWITCHBOT_DEVICES", "CLOUDFLARE_ACCOUNT_ID"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// src/config.ts の parseSwitchBotDevices と同じ形。Worker は Cron の発火まで設定を読まないので、
// 誤りをデプロイの前に止める
const DEVICE_ENTRY_PATTERN = /^[^\s:,]+:[a-z0-9_-]+$/;

/**
 * deploy.env の内容から、デプロイ先ごとの値を取り出す。
 * 必須の値の欠落と形式の誤りは、すべてまとめて problems で返す。
 * @param {string} envText
 * @returns {{ values: DeployValues; warnings: string[] } | { problems: string[] }}
 */
export function readDeployValues(envText) {
  // エディタによっては先頭に BOM が付き、最初のキー名が一致しなくなる
  const env = parseEnv(envText.replace(/^﻿/, ""));
  /** @param {string} key */
  const get = (key) => {
    const value = env[key]?.trim();
    return value === undefined || value === "" ? undefined : value;
  };
  const warnings = Object.keys(env)
    .filter((key) => !KNOWN_KEYS.has(key))
    .map((key) => `未知のキー ${key} は使われません`);
  const problems = [];
  const d1DatabaseId = get("D1_DATABASE_ID");
  if (d1DatabaseId === undefined) problems.push("D1_DATABASE_ID がありません");
  else if (!UUID_PATTERN.test(d1DatabaseId)) {
    problems.push(
      "D1_DATABASE_ID は UUID 形式（wrangler d1 create が表示する database_id）にしてください",
    );
  }
  const switchbotDevices = get("SWITCHBOT_DEVICES");
  if (switchbotDevices === undefined) problems.push("SWITCHBOT_DEVICES がありません");
  else {
    const entries = switchbotDevices
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
    if (entries.length === 0) problems.push("SWITCHBOT_DEVICES にデバイスがありません");
    const invalid = entries.filter((entry) => !DEVICE_ENTRY_PATTERN.test(entry));
    if (invalid.length > 0) {
      problems.push(
        `SWITCHBOT_DEVICES は <deviceId>:<場所> をカンマで区切り、場所は英小文字、数字、_、- だけにしてください（誤り: ${invalid.join(", ")}）`,
      );
    }
    const locations = entries
      .filter((entry) => DEVICE_ENTRY_PATTERN.test(entry))
      .map((entry) => entry.split(":")[1]);
    const duplicated = locations.filter((location, i) => locations.indexOf(location) !== i);
    if (duplicated.length > 0) {
      problems.push(`SWITCHBOT_DEVICES の場所 ${duplicated.join(", ")} が重複しています`);
    }
  }
  if (problems.length > 0 || d1DatabaseId === undefined || switchbotDevices === undefined) {
    return { problems };
  }
  return {
    values: { d1DatabaseId, switchbotDevices, accountId: get("CLOUDFLARE_ACCOUNT_ID") },
    warnings,
  };
}

/**
 * wrangler.jsonc を表すオブジェクトに、デプロイ先ごとの値を重ねる。入力は変更しない。
 * @param {Record<string, any>} base
 * @param {DeployValues} values
 * @returns {Record<string, any>}
 */
export function composeConfig(base, values) {
  /** @type {Record<string, any>} */
  const config = structuredClone(base);
  const d1 = (config.d1_databases ?? []).find(
    (/** @type {{ binding: string }} */ b) => b.binding === D1_BINDING,
  );
  if (d1 === undefined) {
    throw new Error(`wrangler.jsonc に D1 binding "${D1_BINDING}" がありません`);
  }
  d1.database_id = values.d1DatabaseId;
  config.vars = { ...config.vars, SWITCHBOT_DEVICES: values.switchbotDevices };
  if (values.accountId !== undefined) config.account_id = values.accountId;
  return config;
}

/**
 * @typedef {{ envPath: string; basePath: string; outPath: string; warn: (message: string) => void }} GenerateOptions
 */

/**
 * deploy.env を読んで設定を合成し、wrangler.deploy.json に書いてそのパスを返す。
 * 値が足りない、または誤っているときは、その内容を説明する例外を投げる。
 * @param {Partial<GenerateOptions>} [options] テストで差し替える。生成物は basePath と同じディレクトリに置く
 * @returns {string}
 */
export function writeGeneratedConfig(options = {}) {
  const {
    envPath = DEPLOY_ENV_PATH,
    basePath = BASE_CONFIG_PATH,
    outPath = GENERATED_CONFIG_PATH,
    warn = (message) => process.stderr.write(`warning: ${message}\n`),
  } = options;
  if (!existsSync(envPath)) {
    throw new Error(`${envPath} がありません。deploy.env.example をコピーして値を書いてください`);
  }
  const result = readDeployValues(readFileSync(envPath, "utf8"));
  if ("problems" in result) {
    throw new Error(
      `${envPath} を直してください:\n${result.problems.map((p) => `- ${p}`).join("\n")}`,
    );
  }
  for (const message of result.warnings) warn(`${envPath}: ${message}`);
  let base;
  try {
    base = JSON.parse(stripJsonc(readFileSync(basePath, "utf8")));
  } catch (error) {
    throw new Error(`${basePath} を読めません: ${error instanceof Error ? error.message : error}`);
  }
  writeFileSync(outPath, `${JSON.stringify(composeConfig(base, result.values), null, 2)}\n`);
  return outPath;
}
