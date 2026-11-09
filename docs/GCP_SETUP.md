# GCP セットアップ手順

この手順は Cloud Shell で実行する想定です。`YOUR_PROJECT_ID` は実際のプロジェクト ID に置き換えてください。Cloud SQL は継続課金されるため、デモ終了後には停止または削除してください。

## 1. コンソールで最初に行う操作

1. [Google Cloud Console](https://console.cloud.google.com/) で新しいプロジェクトを作成し、請求先アカウントとハッカソンクレジットを紐づける。
2. Firebase Console で **プロジェクトを追加** → 上記 GCP プロジェクトを選択する。
3. Firebase Authentication → **始める** → Sign-in method → **メール/パスワード** を有効にする。
4. Firebase Authentication → Settings → Authorized domains にデプロイ後の App Hosting ドメインを追加する。
5. Firebase のプロジェクト設定 → 全般 → 「ウェブアプリを追加」から設定値を取得する。これは公開値なので `apps/web/.env.local` と App Hosting の環境変数に設定してよい。

## 2. Cloud Shell で行う操作

Cloud Console 右上の Cloud Shell を開き、以下を順に実行します。

```bash
export PROJECT_ID=YOUR_PROJECT_ID
export REGION=asia-northeast1
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com sqladmin.googleapis.com storage.googleapis.com aiplatform.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com firebaseapphosting.googleapis.com
gcloud storage buckets create "gs://${PROJECT_ID}-ai-closet" --location="$REGION" --uniform-bucket-level-access
gcloud sql instances create ai-closet-db --database-version=POSTGRES_16 --tier=db-f1-micro --region="$REGION"
gcloud sql databases create aicloset --instance=ai-closet-db
gcloud sql users create aicloset --instance=ai-closet-db --password='ここに強いパスワード'
```

パスワードはリポジトリやチャットに残さず、次のように Secret Manager にのみ保存します。

```bash
printf '%s' 'postgresql://aicloset:パスワード@/aicloset?host=/cloudsql/YOUR_PROJECT_ID:asia-northeast1:ai-closet-db' | gcloud secrets create database-url --data-file=-
```

## 3. DB 初期化と API デプロイ

ローカル端末から行う場合は Cloud SQL Auth Proxy を使って `infra/database/` の SQL を番号順（`001_initial.sql` → `002_profile_fields.sql` → `003_ai_logic.sql`）に適用します。その後、リポジトリのルートで以下を実行します。

```bash
gcloud run deploy ai-closet-api --source apps/api --region asia-northeast1 --allow-unauthenticated --max-instances 2 --set-env-vars FIREBASE_PROJECT_ID=YOUR_PROJECT_ID,GCS_BUCKET=YOUR_PROJECT_ID-ai-closet,ALLOWED_ORIGINS=http://localhost:3000,VERTEX_AI_MODEL=gemini-3.1-flash-lite,VERTEX_AI_TRY_ON_MODEL=gemini-3.1-flash-lite-image,VERTEX_AI_LOCATION=global --set-secrets DATABASE_URL=database-url:latest --add-cloudsql-instances YOUR_PROJECT_ID:asia-northeast1:ai-closet-db
```

AI 解析・チャット・コーデ提案は `VERTEX_AI_MODEL` と `VERTEX_AI_LOCATION` のモデルを呼びます。バーチャル試着は画像生成向けの `VERTEX_AI_TRY_ON_MODEL` を呼びます。モデルを使わずに画面を確認するときは `AI_MOCK=true` を設定すると、固定の解析結果を返します。

`--allow-unauthenticated` はブラウザから API に到達させるためです。各 API は Firebase ID トークンを検証するので、データ操作は認証済みユーザーに限定されます。

Cloud Run の実行サービスアカウントに以下のロールを付与します。

- Storage Object User（署名 URL と画像読み取り）
- Vertex AI User（Gemini 呼び出し）
- Cloud SQL Client（DB 接続）
- Secret Manager Secret Accessor（DB 接続情報の読み取り）

## 4. Firebase App Hosting 接続

Firebase Console → App Hosting → **始める** → GitHub リポジトリとブランチを接続します。ルートディレクトリはリポジトリ直下にし、環境変数に `NEXT_PUBLIC_API_BASE_URL`（Cloud Run URL）と Firebase Web SDK の設定値を追加します。

デプロイ後、Cloud Run の `ALLOWED_ORIGINS` を App Hosting の公開 URL に更新してください。最後にブラウザで新規登録、服登録、着用記録の順に確認します。

## 5. GitHub Actions で Firebase Hosting にデプロイする場合

このリポジトリの `.github/workflows/deploy.yml` は Firebase Hosting へ静的エクスポートをデプロイします。Next.js は `NEXT_PUBLIC_*` の値を**ビルド時**に埋め込むため、GitHub リポジトリの Settings → Secrets and variables → Actions に、Firebase コンソールのウェブアプリ設定から次の 4 つの repository secrets を追加してください。

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

これらはブラウザに配布される Firebase Web SDK の設定値であり、認証情報の秘密鍵ではありません。それでも環境ごとの設定を誤ってコミットしないため、Actions secrets として管理します。追加後に `main` へ再実行またはワークフローを再実行してください。

## 6. 予算ガードレール

Billing → Budgets & alerts で `$10`、`$15`、`$20` の予算アラートを作成します。Cloud Run は最大 2 インスタンス、App Hosting は最小 0、Cloud SQL は利用しない期間に停止します。
