import { describe, expect, it } from "vitest";
import { parseSwitchBotDevices } from "./config";

describe("parseSwitchBotDevices", () => {
  it("<deviceId>:<場所> をカンマで区切って読む", () => {
    expect(parseSwitchBotDevices(" AAA:living, BBB:room ,CCC:balcony,")).toEqual([
      { deviceId: "AAA", location: "living" },
      { deviceId: "BBB", location: "room" },
      { deviceId: "CCC", location: "balcony" },
    ]);
  });

  it.each([
    ["場所が無い", "AAA"],
    ["区切りが多い", "AAA:living:x"],
    ["場所に . を含む", "AAA:living.east"],
    ["場所に大文字を含む", "AAA:Living"],
    ["空", " , "],
    ["場所が重複する", "AAA:living,BBB:living"],
  ])("%s ときは例外にする", (_, value) => {
    expect(() => parseSwitchBotDevices(value)).toThrow(/SWITCHBOT_DEVICES/);
  });
});
