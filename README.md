# home-o11y

家のセンサーの値を 5 分ごとに読み、Mackerel のサービスメトリックに投稿しつつ、Cloudflare D1 に貯める Worker。
Mackerel の Free プランはグラフを 1 日分しか表示しないので、長い期間の値は D1 から取り出す。

今の取得元は SwitchBot API v1.1 で、温度、湿度、CO2、電池の残量、照度を拾う。
Mackerel のメトリック名は `<種類>.<場所>`（`temperature.living`、`co2.room` など）になる。

## ドキュメント

- [docs/deploy.md](./docs/deploy.md): 初回のセットアップ、更新、secret の入れ替え、デバイスの追加、手元で動かす手順
- [docs/design.md](./docs/design.md): 発火 1 回の流れと失敗の扱い、値の形とメトリック名の規則、D1 のテーブル、取得元ごとに拾う項目
- [docs/development.md](./docs/development.md): 開発のコマンド、テストの仕組み、変えるときに揃える箇所
