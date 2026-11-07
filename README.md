# AI Closet

服の登録、着用記録、振り返りを行うモバイルファーストの Web アプリです。

## 構成

- `apps/web`: Next.js 静的エクスポート + Firebase Authentication の画面
- `apps/api`: Cloud Run で動かす Hono API
- `packages/shared`: API 契約と服タグの正規語彙
- `infra/database`: Cloud SQL PostgreSQL の初期スキーマ

## ローカル起動

```bash
npm install
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
npm run dev:api
npm run dev:web
```

よく使う操作は `make help` で一覧表示できる。Web と API の開発サーバーは別ターミナルで `make dev-web` と `make dev-api` を実行する。

実クラウド接続前は `NEXT_PUBLIC_DEMO_MODE=true` にすると、UI のデモデータを表示できます。

GCP 構築・デプロイは [docs/GCP_SETUP.md](docs/GCP_SETUP.md) を参照してください。フロントエンドの制約は [docs/STATIC_FRONTEND_RULES.md](docs/STATIC_FRONTEND_RULES.md) を参照してください。
