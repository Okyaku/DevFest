PROJECT_ID ?= devfest-513813
REGION ?= asia-northeast1
API_SERVICE ?= ai-closet-api
API_IMAGE := $(REGION)-docker.pkg.dev/$(PROJECT_ID)/ai-closet/api:latest
API_URL := https://ai-closet-api-198951283585.asia-northeast1.run.app

.DEFAULT_GOAL := help
.PHONY: help install dev dev-web dev-api build build-web build-api check deploy-web deploy-api api-health api-logs cloud-status clean

help: ## 利用可能なコマンドを表示
	@awk 'BEGIN {FS = ":.*##"}; /^[a-zA-Z0-9_-]+:.*##/ {printf "\033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Node.js 依存関係をインストール
	npm install

dev: ## Web と API をまとめて開発起動（Ctrl+C で両方停止）
	npx concurrently --kill-others-on-fail --names web,api --prefix-colors cyan,magenta "npm run dev:web" "npm run dev:api"

dev-web: ## Web を http://localhost:3000 で起動（別ターミナルで実行）
	npm run dev:web

dev-api: ## API を http://localhost:8080 で起動（別ターミナルで実行）
	npm run dev:api

build: check build-web build-api ## 型検査と全ビルドを実行

check: ## Web と API の型検査を実行
	npm --workspace=@ai-closet/api run typecheck
	npm --workspace=@ai-closet/web run typecheck

build-web: ## Firebase Hosting 用の静的 Web を apps/web/out に生成
	npm --workspace=@ai-closet/web run build

build-api: ## Cloud Run 用 API をローカルで型検査・ビルド
	npm --workspace=@ai-closet/api run build

deploy-web: build-web ## Firebase Hosting へ Web を直接デプロイ
	npx firebase deploy --only hosting --project $(PROJECT_ID)

deploy-api: ## API イメージを Cloud Build で作成し Cloud Run へデプロイ
	gcloud builds submit --project=$(PROJECT_ID) --config=infra/cloudbuild.api.yaml .
	gcloud run deploy $(API_SERVICE) --project=$(PROJECT_ID) --image=$(API_IMAGE) --region=$(REGION) --service-account=ai-closet-api@$(PROJECT_ID).iam.gserviceaccount.com --allow-unauthenticated --max-instances=2 --min-instances=0 --add-cloudsql-instances=$(PROJECT_ID):$(REGION):ai-closet-db --update-env-vars '^@^FIREBASE_PROJECT_ID=$(PROJECT_ID)@GCS_BUCKET=$(PROJECT_ID)-ai-closet@ALLOWED_ORIGINS=http://localhost:3000,https://$(PROJECT_ID).web.app,https://$(PROJECT_ID).firebaseapp.com@VERTEX_AI_MODEL=gemini-2.0-flash'

api-health: ## デプロイ済み API のヘルスチェック
	curl --fail --silent --show-error $(API_URL)/health

api-logs: ## Cloud Run API の直近ログを表示
	gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="$(API_SERVICE)"' --project=$(PROJECT_ID) --limit=30 --format='value(textPayload)'

cloud-status: ## Cloud Run と Cloud SQL の現在の状態を表示
	gcloud run services describe $(API_SERVICE) --project=$(PROJECT_ID) --region=$(REGION) --format='value(status.url,status.latestReadyRevisionName)'
	gcloud sql instances describe ai-closet-db --project=$(PROJECT_ID) --format='value(state,settings.tier)'

clean: ## ローカルのビルド生成物を削除
	rm -rf apps/web/.next apps/web/out apps/api/dist
