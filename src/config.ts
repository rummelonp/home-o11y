export type SwitchBotDevice = {
  deviceId: string;
  location: string;
};

// Mackerel のメトリック名に使える文字のうち、`.`（グラフを分ける区切り）と大文字を除いたもの
const LOCATION_PATTERN = /^[a-z0-9_-]+$/;

/**
 * `<deviceId>:<場所>` をカンマで区切った値を読む。形式の誤りは例外にする。
 * scripts/deploy-config.mjs も同じ形をデプロイの前に確かめる。
 */
export function parseSwitchBotDevices(value: string): SwitchBotDevice[] {
  const devices = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const [deviceId, location, ...rest] = entry.split(":");
      if (deviceId === undefined || deviceId === "" || location === undefined || rest.length > 0) {
        throw new Error(`SWITCHBOT_DEVICES の ${entry} は <deviceId>:<場所> の形にしてください`);
      }
      if (!LOCATION_PATTERN.test(location)) {
        throw new Error(
          `SWITCHBOT_DEVICES の場所 ${location} は英小文字、数字、_、- だけにしてください`,
        );
      }
      return { deviceId, location };
    });
  if (devices.length === 0) throw new Error("SWITCHBOT_DEVICES にデバイスがありません");
  // 同じ場所が 2 台あると、同じメトリック名と D1 の主キーを奪い合い、片方の値が黙って消える
  const locations = devices.map((device) => device.location);
  const duplicated = locations.filter((location, i) => locations.indexOf(location) !== i);
  if (duplicated.length > 0) {
    throw new Error(`SWITCHBOT_DEVICES の場所 ${duplicated.join(", ")} が重複しています`);
  }
  return devices;
}
