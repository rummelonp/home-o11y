/**
 * 取得元に依存しない 1 つの測定値。Mackerel のメトリック名は `${kind}.${location}` になる。
 * kind と location は英小文字、数字、`_`、`-` だけで作る（`.` はメトリック名の区切りになる）。
 */
export type Reading = {
  kind: string;
  location: string;
  value: number;
};

export function metricName(reading: Reading): string {
  return `${reading.kind}.${reading.location}`;
}
