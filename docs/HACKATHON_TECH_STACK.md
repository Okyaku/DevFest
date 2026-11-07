# AIクローゼット：DevFest GDG Japan Hackathon 2026 技術スタック

## 結論

本プロダクトは、**Next.js を Firebase App Hosting にデプロイし、Cloud Run の API から Cloud SQL（PostgreSQL）、Cloud Storage、Vertex AI Gemini を利用する**構成で実装する。

```text
利用者のブラウザ
  │
  ▼
Next.js（画面・SSR） ── Firebase App Hosting
  │  Firebase Authentication の ID トークンを付与して API を呼ぶ
  ▼
Cloud Run（アプリケーション API）
  ├─ Cloud SQL for PostgreSQL  … 服・着用ログ・候補選択結果
  ├─ Cloud Storage             … 服画像・自撮り画像
  ├─ Vertex AI Gemini          … 自撮りからの服属性抽出
  └─ Secret Manager            … 機密設定
```

## ハッカソン要件との対応

| 条件 | この構成での対応 |
| --- | --- |
| 指定実行基盤を1つ以上使う | Firebase App Hosting と Cloud Run を使用する |
| Google 技術を主技術にする | Firebase、Cloud Run、Cloud SQL、Cloud Storage、Vertex AI を中核にする |
| LLM利用はクレジットを考慮する | Gemini は Google AI Studio のキーではなく、Vertex AI 経由で呼ぶ |
| APIキー・個人情報を提出リポジトリに含めない | Cloud Run のサービスアカウント、Secret Manager、環境変数で管理する |
| 提出時にGoogle Cloudアーキテクチャを説明する | UI、API、DB、画像、AIの役割が明確に分離された構成図を提出する |

プロダクトのカテゴリーは **クリエイティブ** とする。AIによる服の属性化と、個人のクローゼット・着用履歴を使った振り返りを通じ、ファッションにおける表現・記録・発見を支援する。

## 採用技術

| 領域 | 採用技術 | 役割 |
| --- | --- | --- |
| フロントエンド | Next.js + TypeScript | モバイルファーストのWeb/PWA UI、認証済み画面、画像選択・カメラ操作 |
| UI | Tailwind CSS + shadcn/ui | 短期間で一貫した画面を作る |
| フロントのホスティング | Firebase App Hosting | Next.js のSSR/動的ルートを含めて公開する |
| 認証 | Firebase Authentication | メール認証とIDトークン発行 |
| バックエンド | Cloud Run + TypeScript + Hono | REST API、認可、画像処理の起点、AI呼び出し、候補検索 |
| DB | Cloud SQL for PostgreSQL | クローゼット、着用ログ、集計の永続化 |
| ORM / マイグレーション | Drizzle ORM | 型安全なクエリとSQLスキーマ管理 |
| オブジェクトストレージ | Cloud Storage | 服画像、自撮り、プロフィール画像の保管 |
| 画像AI | Vertex AI Gemini | 自撮りに写る服の属性を、定義済みのタグ語彙に沿って抽出 |
| バリデーション | Zod | API入力、AI構造化出力、タグ語彙をサーバー側で検証 |
| 機密情報 | Secret Manager | DB接続情報などの保管。LLM APIキーをクライアントやリポジトリに置かない |
| 監視 | Cloud Logging / Error Reporting | Cloud Runの例外とAI解析失敗を確認する |

### Next.js と Firebase App Hosting

Next.js は一般に Vercel にデプロイされることが多いが、**Firebase App Hosting も Next.js の正式対応ホスティング先**である。SSR、Server Components、Route Handlers、動的ルーティングを含むNext.jsアプリをデプロイできる。

App Hosting は裏側で Cloud Build、Cloud Run、Cloud CDN を利用する。フロントエンドの公開基盤として App Hosting を選ぶことで、Next.js の開発体験を保ちつつ、Google技術をプロダクトの中心に据えられる。

採用するNext.jsとNode.jsのバージョンは、実装開始時点で Firebase App Hosting が公式サポートする組み合わせを選ぶ。新しいメジャー版を無検証で採用しない。

参考:

- [Firebase App Hosting](https://firebase.google.com/docs/app-hosting)
- [Firebase App Hosting のフレームワーク対応](https://firebase.google.com/docs/app-hosting/frameworks-tooling)

## 各コンポーネントの責務

### Next.js / Firebase App Hosting

- ログイン・新規登録、クローゼット一覧、服の登録・編集、カレンダー、統計を表示する。
- ブラウザのカメラまたは画像選択で画像を取得する。
- Firebase Authenticationでログインし、IDトークンをCloud Run APIへ渡す。
- 表示と操作に専念し、DB接続情報、Vertex AIの認証情報、他ユーザーを扱う権限は持たない。

### Cloud Run API

- Firebase IDトークンを検証し、トークンの `uid` を唯一の所有者IDとして扱う。
- クライアントが送った `userId` は信用しない。
- Cloud Storageへ直接アップロードさせるための短命な署名URLを発行する。
- 自撮りをCloud Storageから取得して Vertex AI Gemini に渡す。
- AI出力をタグ語彙に正規化・検証し、PostgreSQLで候補の服を検索・順位付けする。
- 服、着用ログ、統計のAPIを提供する。

### Cloud SQL for PostgreSQL

このプロダクトにはSQLを採用する。服・着用ログ・ログ内アイテムは関係データであり、候補検索と統計に集計クエリを多く使うためである。

```text
users
clothes
wear_logs
wear_log_items
```

`wear_log_items` を独立させることで、1回の着用記録にトップス・ボトムスなど複数の服を紐付けられる。さらに、AIが検出した枠、最終的に人が選んだ服、候補スコアを保存できる。

代表的なSQL集計:

- 指定月に着用した服・色のランキング
- 最終着用日が古い服（未着用候補）
- カレンダー表示用の日別着用件数
- AI検出結果とユーザーの最終選択の差分

### Cloud Storage

保存パスはユーザー単位で分ける。

```text
users/{uid}/items/{uuid}.{extension}
users/{uid}/selfies/{uuid}.{extension}
users/{uid}/profile/{uuid}.{extension}
```

DBには公開URLではなくオブジェクトキーを保存する。表示・アップロードには、Cloud Runが発行する期限付きURLを用いる。

### Vertex AI Gemini

Geminiには自撮りから `category`、`subCategory`、`color`、袖丈、丈、季節、シーンを構造化JSONで返させる。モデル出力は不正確・不完全であり得るため、Cloud RunでZodによる検証と正規化を必ず行う。

AIは候補提示までを担当し、着用記録の確定はユーザーが行う。これは誤認識への耐性と、プロダクト体験の両方に必要な原則である。

## APIの呼び出し方と認可

Next.jsからCloud Run APIをHTTPSで呼ぶ。APIのURLは公開環境変数 `NEXT_PUBLIC_API_BASE_URL` に設定する。

```text
Browser
  → Firebase AuthenticationからIDトークンを取得
  → Authorization: Bearer <Firebase ID Token> を付けてCloud Run APIを呼ぶ
  → Cloud Runがトークン検証後、uidに限定してSQL・Storageを操作する
```

Cloud Runをブラウザから到達可能にする場合も、アプリケーション上の認証を省略しない。Cloud Runの到達制御とFirebase IDトークンの検証は別の責務である。

Cloud RunにはApp Hostingの本番ドメインとローカル開発URLのみを許可するCORS設定を置く。

## 主要フロー

### 服の新規登録

```text
Next.js → Cloud Run: アップロードURLを要求
Next.js → Cloud Storage: 服画像をアップロード
Next.js → Cloud Run: 属性とimageKeyを送信
Cloud Run → PostgreSQL: clothesを作成
```

### 今日の着用記録

```text
Next.js → Cloud Run: 自撮り用アップロードURLを要求
Next.js → Cloud Storage: 自撮りをアップロード
Next.js → Cloud Run: selfieKeyを渡して解析を要求
Cloud Run → Cloud Storage: 自撮りを読む
Cloud Run → Vertex AI Gemini: 属性を構造化出力で抽出
Cloud Run → PostgreSQL: 本人の服を検索・採点
Cloud Run → Next.js: 検出枠ごとの候補（最大3件）を返す
Next.js → Cloud Run: ユーザー選択を送信
Cloud Run → PostgreSQL: wear_logs / wear_log_itemsを保存
```

## 採用理由とトレードオフ

| 選択 | 採用理由 | トレードオフと対策 |
| --- | --- | --- |
| App Hosting + Next.js | React/Next.jsで迅速にUIを作れ、Google技術の利用も明確 | Vercel固有機能には依存しない。App Hostingの対応済みNext.js版を採用する |
| Cloud Run APIを分離 | AI、DB、認可をブラウザから隔離できる。後から処理を増やしてもUIに影響しにくい | デプロイ先が2つになる。API契約をZodの共有スキーマで固定する |
| PostgreSQL | 関係データ、候補検索、月次統計を素直に扱える | Cloud SQLは常時コストが発生し得る。小さい構成、予算アラート、不要時の停止で管理する |
| Vertex AI Gemini | Google技術の活用を示せ、GCPの権限・監査に統合できる | モデル出力は不安定。構造化出力、Zod検証、候補なし・再撮影のUIを実装する |
| Cloud Storageへの署名URLアップロード | 大きな画像をAPI経由で中継せず、Cloud Runの負荷を抑える | 署名URLの対象パス・MIMEタイプ・有効期限をサーバー側で厳しく制限する |

## コストと運用のガードレール

- 予算アラートを `$10`、`$15`、`$20` に設定する。
- Cloud Runの最大インスタンス数を低く設定し、PostgreSQLの接続プールを小さく保つ。
- Cloud SQLは小さな開発・デモ用構成を選び、不要な期間は停止する。
- Vertex AIの呼び出し回数と入力画像サイズを制限する。画像はアップロード時にMIMEタイプとサイズを検証する。
- 開発・デモ用にはGemini呼び出しを固定レスポンスへ差し替えられるようにし、AI障害時も候補選択画面を確認可能にする。
- 自撮りは個人画像であるため、保存目的・削除導線・保持期間をUIに明示する。

## 実装開始前の注意

ハッカソンの開発開始アナウンス前は、プロダクトのソースコードやCI/CDを作成しない。環境整備、技術検証のPOC、UIデザイン、設計文書は可能だが、POCのコードを本番リポジトリへコピー・流用しない。

提出用リポジトリへ、APIキー、サービスアカウント鍵、個人情報、`.env` をコミットしない。GitHub Actionsが利用できない可能性もあるため、デプロイ方法は開発期間中に手動 `gcloud` 実行または開発用リポジトリでの連携を検討する。

## 今回は採用しないもの

| 技術 | 理由 |
| --- | --- |
| Vercel | Next.jsとの相性は良いが、今回の「Google技術を主技術にする」審査条件に対する訴求が弱くなる |
| Firestoreを主DBにする | MVPのCRUDは速いが、SQLで行いたい候補検索・統計・関係データの扱いに不利 |
| GKE / Compute Engine / App Engine | ハッカソンMVPには設定・運用負荷が大きく、Cloud Runで十分 |
| クライアントからのVertex AI直接呼び出し | 認証情報を安全に扱えず、画像・プロンプト・出力検証を制御できない |

