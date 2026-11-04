# 設計

## 流れ

Cron Trigger（5 分ごと）の 1 回の発火で、次を行う（`src/collect.ts`）。

1. 取得元から全デバイスの値を並行して読む。
2. 読めた値を Mackerel のサービスメトリックに投稿し、並行して D1 に保存する。
3. どこかで失敗していれば、最後にまとめて例外を投げ、発火を失敗にする。

1 台の読み取りに失敗しても、ほかのデバイスの値は投稿・保存する。
Mackerel への投稿と D1 への保存は、片方が失敗してももう片方を行う。
SwitchBot と Mackerel へのリクエストは 10 秒でタイムアウトさせる。
失敗した発火は、失敗の内容と一緒に Workers のログ（observability）に残る。

再送はしない。次の発火が 5 分後に新しい値を送るためである。
Mackerel は 24 時間より古い時刻の値を受け付けないので、24 時間を過ぎた抜けは後から Mackerel に入れ直せない。

1 回の発火で読んだ値は、すべて発火の予定時刻（`scheduledTime` を秒に切り捨てた値）を時刻にする。
SwitchBot のデバイスの状態を返す API は測定時刻を返さないので、予定時刻を使って Mackerel と D1 の時刻を揃える。

## 値の形とメトリック名の規則

取得元は値を `Reading`（`src/reading.ts`）の `{ kind, location, value }` で返す。

- `kind` は種類（`temperature`、`co2` など）、`location` は場所（`living` など）。
- どちらも英小文字、数字、`_`、`-` だけにする。
  Mackerel のメトリック名は `<kind>.<location>` になる。
  `.` が種類と場所の区切りになるので、どちらにも `.` は使わない。
- メトリック名は取得元のメーカーを含まない。
  別のメーカーのセンサーを足しても、同じ種類は同じグラフに並ぶ。

## Mackerel のダッシュボードと監視

Mackerel のサービスのグラフは、メトリック名の最後の `.` より前でまとまる。
`temperature.living` と `temperature.room` は `temperature.*` という 1 つのグラフに並ぶ。

ダッシュボードは Mackerel の画面で管理する。
場所ごとの見出しや並び順は、メトリック名からは決まらないためである。
グラフウィジェットはサービスのグラフ（`temperature.*` など）を指すので、場所を足しても自動で並ぶ。

監視は `scripts/mackerel-monitors.mjs` が作る。
Mackerel に投稿済みのメトリック名のうち、直近 1 時間に値のあるものから定義を組み立てるので、場所や種類の一覧を `SWITCHBOT_DEVICES` とスクリプトに二重に書かない。

- 場所ごとの値の途切れ。20 分で warning、60 分で critical。
  1 台の値はまとめて投稿されるので、場所ごとに 1 つのメトリック（あれば温度）で見る。
- CO2 が 10 分の平均で 1000 ppm を超えたら warning、1500 ppm で critical
- 電池が 20 % を下回ったら warning、10 % で critical

監視は名前（`home living の値の途切れ`、`home room の CO2` など）で既存のものと照合して上書きする。
上書きしても、画面で付けたミュートと通知の再送間隔は残る。
閾値などほかの項目は、画面で変えても次の実行で戻る。
Mackerel のメトリック名の一覧には投稿をやめた名前も残りうるので、値の途切れた名前は定義に使わない。
そのため場所の名前を変えると、古い場所の監視は定義に無いものになり、スクリプトは消さずにその名前を表示する。

## D1

`readings` テーブル（`migrations/0001_readings.sql`）に、Mackerel と同じ値を縦持ちで入れる。
種類や場所が増えても、migration は要らない。

| 列            | 内容            |
| ------------- | --------------- |
| `location`    | 場所            |
| `kind`        | 種類            |
| `measured_at` | UNIX 時間（秒） |
| `value`       | 値              |

主キーは `(location, kind, measured_at)` で、同じ発火を再実行しても `INSERT OR REPLACE` で上書きになる。
主キーが `location` から始まるので、場所を指定せず期間だけで絞る問い合わせは全件を走査する。
そうした問い合わせを作るときは、`measured_at` から始まるインデックスを足す。

書き込みは 1 回の発火で 10 行ほど、1 日で約 2,900 行になる。
容量は年に 50 MB 程度で、上限の最も小さい Free プランの 1 データベースの上限 500 MB にも当分届かない。

ログ（開閉や人感のイベントなど）を入れるときは、メトリックの行と JOIN できるよう、同じデータベースに別のテーブルを足す。
D1 はデータベースをまたぐ JOIN ができない。

## 取得元

取得元は `src/sources/` に 1 ファイルずつ置き、`Reading[]` を返す関数を `src/collect.ts` から呼ぶ。
今は SwitchBot API v1.1（`src/sources/switchbot.ts`）だけである。

SwitchBot の取得元は、デバイスの状態を返す API（`GET /v1.1/devices/{deviceId}/status`）の応答から次の項目を拾う。
deviceType では分けず、数値で返った項目をそのまま使う。

| 応答の項目    | 種類                                            | 返すデバイスの例                            |
| ------------- | ----------------------------------------------- | ------------------------------------------- |
| `temperature` | `temperature`（℃）                              | Hub 2 / Hub 3、Meter Pro CO2、Outdoor Meter |
| `humidity`    | `humidity`（%）                                 | 同上                                        |
| `CO2`         | `co2`（ppm）                                    | Meter Pro CO2                               |
| `battery`     | `battery`（%）                                  | Meter Pro CO2、Outdoor Meter                |
| `lightLevel`  | `light_level`（Hub 2 は 1〜20、Hub 3 は 1〜10） | Hub 2 / Hub 3                               |

SwitchBot API の上限は 1 日 10,000 回で、3 台を 5 分ごとに読むと 1 日 864 回になる。
