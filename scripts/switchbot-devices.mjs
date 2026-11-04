// SwitchBot API のデバイス一覧を表示する。deploy.env の SWITCHBOT_DEVICES に書く deviceId を調べるため。
//   SWITCHBOT_TOKEN=... SWITCHBOT_SECRET=... node scripts/switchbot-devices.mjs
// 署名の作り方は src/sources/switchbot.ts の signedHeaders と同じ。
import { createHmac, randomUUID } from "node:crypto";

const token = process.env.SWITCHBOT_TOKEN;
const secret = process.env.SWITCHBOT_SECRET;
if (!token || !secret) {
  process.stderr.write("環境変数 SWITCHBOT_TOKEN と SWITCHBOT_SECRET を設定してください\n");
  process.exit(1);
}

const t = String(Date.now());
const nonce = randomUUID();
const sign = createHmac("sha256", secret)
  .update(token + t + nonce)
  .digest("base64");
const response = await fetch("https://api.switch-bot.com/v1.1/devices", {
  headers: { Authorization: token, sign, t, nonce },
});
const json =
  /** @type {{ statusCode?: number; body: { deviceList: { deviceId: string; deviceType: string; deviceName: string }[] } }} */ (
    await response.json()
  );
if (json.statusCode !== 100) {
  process.stderr.write(`SwitchBot: HTTP ${response.status} ${JSON.stringify(json)}\n`);
  process.exit(1);
}
for (const device of json.body.deviceList) {
  process.stdout.write(`${device.deviceId}\t${device.deviceType}\t${device.deviceName}\n`);
}
