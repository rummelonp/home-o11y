import { describe, expect, it } from "vitest";
import { buildMonitors, parseMetricNames, planMonitors } from "./mackerel-monitors.mjs";

const NAMES = [
  "battery.balcony",
  "battery.room",
  "co2.room",
  "humidity.balcony",
  "humidity.living",
  "humidity.room",
  "light_level.living",
  "temperature.balcony",
  "temperature.living",
  "temperature.room",
];

describe("parseMetricNames", () => {
  it("<種類>.<場所> の形でない名前は除く", () => {
    expect(parseMetricNames(["co2.room", "custom.a.b", "nodot", "Upper.room"])).toEqual([
      { kind: "co2", location: "room", name: "co2.room" },
    ]);
  });
});

describe("buildMonitors", () => {
  const monitors = buildMonitors("home", NAMES) as {
    name: string;
    metric: string;
    operator: string;
    warning?: number;
    missingDurationWarning?: number;
    missingDurationCritical?: number;
    critical?: number;
    duration?: number;
  }[];

  it("場所ごとの途切れと、CO2 と電池の閾値を監視する", () => {
    expect(monitors.map((m) => [m.name, m.metric])).toEqual([
      ["home balcony の値の途切れ", "temperature.balcony"],
      ["home living の値の途切れ", "temperature.living"],
      ["home room の値の途切れ", "temperature.room"],
      ["home room の CO2", "co2.room"],
      ["home balcony の電池", "battery.balcony"],
      ["home room の電池", "battery.room"],
    ]);
    expect(monitors[0]).toMatchObject({ missingDurationWarning: 20, missingDurationCritical: 60 });
    expect(monitors.find((m) => m.metric === "co2.room")).toMatchObject({
      operator: ">",
      warning: 1000,
      critical: 1500,
      duration: 2,
    });
    expect(monitors.find((m) => m.metric === "battery.room")).toMatchObject({
      operator: "<",
      warning: 20,
    });
  });

  it("温度の無い場所は、ほかの種類で途切れを見る", () => {
    expect(buildMonitors("home", ["co2.study"])[0]).toMatchObject({
      name: "home study の値の途切れ",
      metric: "co2.study",
    });
  });
});

describe("planMonitors", () => {
  it("同じ名前の監視は上書きしてミュートを残し、定義に無いものは消さずに分ける", () => {
    const desired = buildMonitors("home", ["temperature.room", "co2.room"]);
    const plan = planMonitors(
      "home",
      [
        { id: "a", type: "service", service: "home", name: "home room の値の途切れ", isMute: true },
        { id: "b", type: "service", service: "home", name: "home old の値の途切れ" },
        { id: "c", type: "service", service: "other", name: "home room の CO2" },
        { id: "d", type: "connectivity", name: "connectivity" },
      ],
      desired,
    );
    expect(plan.update).toEqual([{ id: "a", body: { ...desired[0], isMute: true } }]);
    expect(plan.create.map((m) => m.name)).toEqual(["home room の CO2"]);
    expect(plan.unmatched.map((m) => m.id)).toEqual(["b"]);
  });

  it("上書きでは再送間隔を残し、ミュートが無ければ解除を明示する", () => {
    const desired = buildMonitors("home", ["co2.room"]);
    const plan = planMonitors(
      "home",
      [
        {
          id: "a",
          type: "service",
          service: "home",
          name: "home room の CO2",
          notificationInterval: 60,
        },
      ],
      desired.filter((m) => m.name === "home room の CO2"),
    );
    expect(plan.update[0]?.body).toMatchObject({ notificationInterval: 60, isMute: false });
  });

  it("定義が空でも、そのサービスの既存の監視を定義に無いものとして分ける", () => {
    const plan = planMonitors(
      "home",
      [{ id: "a", type: "service", service: "home", name: "home old の値の途切れ" }],
      [],
    );
    expect(plan.unmatched.map((m) => m.id)).toEqual(["a"]);
  });

  it("同じ名前の既存の監視が複数あれば、最初の 1 つだけを上書きし、残りを分ける", () => {
    const desired = buildMonitors("home", ["temperature.room"]);
    const name = "home room の値の途切れ";
    const plan = planMonitors(
      "home",
      [
        { id: "a", type: "service", service: "home", name },
        { id: "b", type: "service", service: "home", name },
      ],
      desired,
    );
    expect(plan.update.map((u) => u.id)).toEqual(["a"]);
    expect(plan.duplicated.map((m) => m.id)).toEqual(["b"]);
    expect(plan.unmatched).toEqual([]);
  });
});
