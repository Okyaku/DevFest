# 静的フロントエンド実装ルール

フロントエンドは Next.js の静的エクスポートを Firebase Hosting へ配置する。サーバー処理はすべて Cloud Run API に置く。

```text
Browser (Firebase Hosting)
  ├─ Firebase Authentication
  └─ HTTPS + Firebase ID token → Cloud Run API
                                      ├─ Cloud SQL
                                      ├─ Cloud Storage
                                      └─ Vertex AI Gemini
```

## 禁止するもの

- `app/api/**/route.ts`（Next.js API Routes）
- Server Actions（`"use server"`）
- SSR に依存する実装（`cookies()`、`headers()`、リクエスト時の DB / Secret Manager アクセス）
- Firebase Admin SDK、Cloud SQL、Vertex AI、Cloud Storage SDK を `apps/web` に追加すること
- `NEXT_PUBLIC_` 環境変数へ秘密情報を置くこと

## 実装方法

- ブラウザで必要な画面は Client Component とし、Firebase Auth で ID トークンを取得する。
- データ操作は `Authorization: Bearer <Firebase ID token>` を付けて Cloud Run API に送る。
- API URL は `NEXT_PUBLIC_API_BASE_URL` のみを利用する。値はビルド時に静的ファイルへ埋め込まれる。
- 画像は Cloud Run から取得した短命の署名 URL でアップロード・表示する。
- Next.js の設定 `output: "export"` を外さない。`npm run build --workspace=@ai-closet/web` の出力先は `apps/web/out`。

## デプロイ

```bash
npm run deploy:web
```

このコマンドは Web をビルドして Firebase Hosting だけを更新する。Cloud Run API は別途 `gcloud run deploy` で更新する。
