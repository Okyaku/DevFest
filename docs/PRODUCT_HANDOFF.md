# AIクローゼット 再実装用プロダクト仕様・技術引継ぎ

> この文書は、既存の「AIクローゼット」を別ハッカソンで再構築するための、AI開発エージェント／新しい開発メンバー向け仕様書である。実コードを調査して作成した。要件の意図、現在実装されている挙動、API・データ設計、未完了部分を分けて記載する。

## 0. まずAIに渡す依頼文

以下をそのまま再実装AIへの依頼の冒頭に利用できる。

```text
添付の「AIクローゼット 再実装用プロダクト仕様・技術引継ぎ」に従って、モバイルファーストの所持服・着用記録アプリを作ってください。

最優先の体験は「自撮りを1枚撮る → AIが服の属性を推定する → 登録済みのクローゼットから候補を提示する → ユーザーが確認して今日の着用を記録する」です。AIの判定をそのまま確定しない、人が最終確認する設計を守ってください。

MVP範囲は、認証、クローゼットCRUD、画像アップロード、自撮り解析・候補選択、日別カレンダー、実データを使う統計です。既存版にあるダミー統計・旧ローカルRepositoryは移植せず、データ取得経路を一本化してください。技術選定は自由ですが、文書内のデータ契約、タグ語彙、権限分離、受け入れ基準を満たしてください。
```

---

## 1. プロダクトの核

### 一言でいうと

**自撮りから今日着ている服を候補化し、確認操作だけで着用履歴を残せるスマートクローゼット。**

### 解決したい課題

- 服を多く持っていると、所持品や最近着た服を把握しにくい。
- コーディネートを日記のように残したくても、毎回服名を手で入力するのは面倒。
- 「似た服を買ってしまう」「着ていない服が埋もれる」を後から振り返れない。

### 提供価値

1. 所持服を写真付きで一覧・編集できる。
2. 自撮り画像をAIが `カテゴリ / 種類 / 色 / 袖・丈 / 季節 / シーン` に分解する。
3. その属性を使い、本人のクローゼットから似た服を上位候補として提示する。
4. ユーザーが候補を選択して、その日の着用ログとして保存する。
5. カレンダーと統計で着用傾向を振り返る。

### 想定ユーザー

- 所持服を把握できていない人
- 手入力なしでコーディネート履歴を残したい人
- 着ていない服・よく着る服を知りたいファッション好き

### MVPで守るプロダクト原則

- AIは「候補提示」まで。記録確定は必ずユーザーが行う。
- データはユーザー単位で完全に分離する。
- 画像はオブジェクトストレージ、DBには画像URLではなくオブジェクトキーを保存する。
- 画面に表示する値は日本語、保存・検索に使う値は後述の英語タグに統一する。
- ネットワーク失敗時は進行中状態を解除し、再試行できるエラーを出す。

---

## 2. 画面・ユーザーフロー

### 画面一覧

| 画面 | 目的 | 必要な操作・表示 |
| --- | --- | --- |
| ログイン / 新規登録 | 利用者を認証する | メールアドレス、パスワード、メール認証コード、ログアウト |
| ホーム（クローゼット） | 所持服を見る起点 | カテゴリ別一覧、画像、名称・属性、詳細への遷移、更新 |
| 撮影メニュー | 目的を選ぶ | `着用記録` と `新規服登録` |
| 新規服登録 | 服をクローゼットに追加 | カメラ/ギャラリー、画像プレビュー、属性入力、保存 |
| アイテム詳細 | 既存の服を管理 | 画像と属性を表示、編集、削除 |
| 自撮り解析・候補選択 | 今日の服を記録 | 自撮り、解析中表示、検出服ごとの候補、候補選択、記録確定 |
| カレンダー | 日別履歴を見る | 月表示、記録日の視覚化、日付タップで着用品と画像 |
| 統計 | 傾向を振り返る | 今月の着用回数、よく着る服/色、未着用候補など（実データ） |
| 設定 | プロフィール管理 | 表示名、アバター、ログアウト |

### 主要フロー A: 新規服登録

```text
ホーム → カメラFAB → 新規服登録
→ カメラまたはギャラリーで服の画像を取得
→ カテゴリ・色（必須）、任意属性を入力
→ 画像を `users/{userId}/items/{uuid}.{ext}` にアップロード
→ clothes を作成
→ ホームに戻り、一覧を再取得して反映
```

服画像は、背景が少なく服単体が分かる平置き・ハンガー写真を推奨する。現行版では服登録時の属性推定は自動化しておらず、フォーム入力である。再実装でAI補助入力を加えることは歓迎だが、編集可能にすること。

### 主要フロー B: 今日の着用記録（このプロダクトの見せ場）

```text
ホーム → カメラFAB → 着用記録
→ 前面カメラまたはギャラリーで自撮りを取得
→ `users/{userId}/selfies/{uuid}.{ext}` にアップロード
→ AI解析 API に selfieKey を送信
→ 検出された服（トップス等）ごとに、クローゼット候補を最大3件表示
→ ユーザーが各検出服に対応する候補を選ぶ
→ 今日の日付・自撮りキー・選択結果・服ID群を着用ログとして保存
→ ホーム（またはカレンダー）へ戻る
```

- 候補なし、または信頼度が低い場合は「候補なし / 新規登録へ」の導線を出す。現行版は候補がない場合、保存不可となるため改善対象。
- 同じ服を複数の検出枠で選ばせないなど、UI側で重複を抑止するとよい。
- 日付は利用者のローカル日付（`YYYY-MM-DD`）で保存する。タイムゾーンをまたぐ構成なら、タイムゾーンも保持する。

### 主要フロー C: 閲覧・編集

```text
ホーム → カテゴリ別アイテム一覧 → アイテム詳細 → 編集 or 削除
カレンダー → 日付 → その日に紐づく clothesId を取得 → 各アイテムを表示
統計 → logs と clothes を集計 → ランキング・未着用を表示
```

### 情報設計 / ナビゲーション

下部タブは `カレンダー / ホーム / 統計 / 設定` の4つ。初期タブはホーム。ホームのみ右下の丸いカメラFABを表示し、FAB押下で半透明オーバーレイ上に2アクションを出す。現行UIは Material 3・白背景・紫のアクセント色で、画像を主役にしている。

---

## 3. 属性語彙（保存値は必ずこれに正規化）

UIラベルは日本語に変換する。AI出力・DB・検索キーは以下の英語値を使う。

| 項目 | 値 |
| --- | --- |
| `category` | `tops`, `bottoms`, `outer`, `dress`, `shoes` |
| `subCategory` | `t-shirt`, `shirt/blouse`, `knit/sweater`, `sweatshirt/hoodie`, `denim/jeans`, `slacks/pants`, `skirt`, `shorts`, `jacket/coat`, `cardigan`, `one-piece`, `setup`, `sneakers`, `leather/pumps`, `boots`, `sandals` |
| `color` | `white`, `black`, `gray`, `brown`, `beige`, `blue`, `navy`, `green`, `yellow`, `orange`, `red`, `pink`, `purple`, `gold`, `silver`, `denim`, `multi-color` |
| `sleeveLength` | `short`, `half`, `long` |
| `hemLength` | `short`, `half`, `long` |
| `season` | `spring`, `summer`, `fall`, `winter`（複数可） |
| `scene` | `casual`, `business`, `feminine`, `other` |

必須項目は `category` と `color`。`shoes` と `bottoms` は袖丈を入力不能にし、`tops`、`outer`、`shoes` は丈を入力不能にする（現行実装のUIルール）。サブカテゴリと親カテゴリの整合性は、新版ではバリデーションする。

---

## 4. データモデル

### Clothes（クローゼットの服）

| 属性 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `userId` | string | yes | 認証プロバイダの不変ユーザーID（Cognitoなら `sub`） |
| `clothesId` | string | yes | UUID/ULID |
| `category` | enum | yes | 上記語彙 |
| `subCategory` | enum | no | 上記語彙 |
| `color` | enum | yes | 上記語彙 |
| `sleeveLength` / `hemLength` | enum | no | 上記語彙 |
| `season` | string[] | no | 0件以上、重複なし |
| `scene` | enum | no | 上記語彙 |
| `imageKey` | string | no | 服画像のストレージキー。旧実装のAPI名は `imageUrl` だが実体はキー |
| `name` | string | no | ユーザーが付けた名称 |
| `notes` | string | no | メモ |
| `categoryColor` | string | yes | 検索用の `${category}#${color}` |
| `createdAt` / `updatedAt` | timestamp | yes | UTC時刻 |

### WearLog（1日分の着用記録）

1日につき複数の記録を残せる設計（朝・夜など）とする。現行バックエンドも `logId = {date}#{uuid}` で複数ログを許容している。

| 属性 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `userId` | string | yes | 所有者 |
| `logId` | string | yes | `{YYYY-MM-DD}#{uuid}`。日付範囲検索可能にする |
| `date` | date string | yes | `YYYY-MM-DD`、利用者ローカル日付 |
| `clothesIds` | string[] | yes | 確定した服ID群 |
| `selections` | object | no | `検出枠キー: clothesId`。AI候補選択の監査用 |
| `selfieKey` | string | no | 自撮り画像のストレージキー |
| `createdAt` | timestamp | yes | UTC時刻 |

`selections` の例:

```json
{
  "tops|t-shirt|white#0": "01JABC...",
  "bottoms|denim/jeans|blue#1": "01JDEF..."
}
```

### 推奨ストレージキー

```text
users/{userId}/items/{uuid}.{extension}
users/{userId}/selfies/{uuid}.{extension}
users/{userId}/profile/{uuid}.{extension}
```

マルチテナントの読み書き権限をこのプレフィックスに縛る。署名URLを都度取得して表示し、公開URLをDBに恒久保存しない。

現行のAmplify Storage実装では、実際に保存している値は `public/users/{userId}/...` である。新版ではストレージSDKが予約するプレフィックスを除いた論理キーをDBに保存するか、API全体で物理キーを使うかを一方に統一する。

---

## 5. バックエンド仕様

### 推奨アーキテクチャ

```text
モバイル/Web クライアント
  ├─ 認証（Cognito等）
  ├─ 画像アップロード ─────→ オブジェクトストレージ
  └─ 認証付き API ───────→ アプリケーションAPI / Lambda
                                  ├─ Clothes DB
                                  ├─ WearLog DB
                                  ├─ オブジェクトストレージから画像読込
                                  └─ 画像対応LLM（Gemini等）
```

現行版は Flutter + AWS Amplify、Cognito、S3、API Gateway、Python Lambda、DynamoDBを使用する。画像認識は企画書の Rekognition ではなく、実装上は **Gemini Vision API** を呼び出している。この差異を再実装前に明確にすること。画像の服属性抽出に強いモデルを選び、JSON Schemaまたは構造化出力で語彙を強制する。

### API契約

すべて認証必須。レスポンスの共通形は成功時 `{ "ok": true, ... }`、失敗時 `{ "ok": false, "error": "..." }`。

| Method / Path | リクエスト | 成功レスポンス | 用途 |
| --- | --- | --- | --- |
| `GET /clothes` | `category`, `color`, または `categoryColor` | `{ok, items}` | 自分の服一覧。カテゴリ・色検索可 |
| `POST /clothes` | Clothes作成属性 | `{ok, item}` (201) | 服を作成 |
| `GET /clothes/{id}` | - | `{ok, item}` | 1着取得 |
| `PUT /clothes/{id}` | 更新可能な Clothes 属性 | `{ok, item}` | 編集。category/color変更時は検索キーも更新 |
| `DELETE /clothes/{id}` | - | `{ok}` | 服削除 |
| `POST /analyze` | `{selfieKey, topK?: 3}` | `{ok, results}` | 自撮り解析・候補検索 |
| `GET /logs` | `from`, `to`（`YYYY-MM-DD`） | `{ok, items}` | 日付範囲の着用ログ |
| `POST /logs` | `{date, selfieKey?, selections?, clothesIds?}` | `{ok, item}` (201) | 着用記録作成 |

`GET /logs` はデフォルト30日ではなく、カレンダーで表示している月の開始日・終了日を明示送信する設計が望ましい。現行版のデフォルト30日では、過去月を開いても印が欠ける。

### `POST /analyze` の契約

入力:

```json
{ "selfieKey": "users/u1/selfies/a.jpg", "topK": 3 }
```

出力:

```json
{
  "ok": true,
  "results": [
    {
      "detected": {
        "category": "tops",
        "subCategory": "t-shirt",
        "color": "white",
        "sleeveLength": "short",
        "season": ["spring", "summer"],
        "scene": "casual"
      },
      "candidates": [
        { "clothesId": "id1", "category": "tops", "color": "white", "imageKey": "...", "score": 80 }
      ],
      "bestScore": 80,
      "needsRegister": false
    }
  ]
}
```

AIプロンプトには「指定語彙以外を出力しない」「検出できない服を空オブジェクトで返さない」「JSON以外を返さない」を含める。サーバー側でも値を正規化・検証し、モデル出力を信用しない。

### 候補検索・ランキングロジック

1. LLMから各着用品のタグを取得する。
2. まず `userId + categoryColor` で候補を絞る。
3. 0件なら同義語を正規化して再検索する（例: `紺` → `navy`）。
4. それでも0件なら、そのユーザーの同一カテゴリで緩く検索する。
5. 候補を加点して降順にし、上位 `topK` を返す。

現行の加点は以下。`bestScore <= 20` を「新規登録を促す」目安としている。

| 条件 | 加点 |
| --- | ---: |
| `subCategory` 完全一致 | +50 |
| `sleeveLength` 完全一致 | +20 |
| `hemLength` 完全一致 | +20 |
| `scene` 完全一致 | +10 |
| 現在の日本の季節が服の `season` に含まれる | +10 |

改善案: 色・カテゴリは候補抽出の条件なので、最終スコアに一致理由を含める。画像埋め込み類似度を追加する場合も、タグスコアとの重みと説明を残す。

### DynamoDBを使う場合のキー設計

- `Clothes`: PK=`userId`, SK=`clothesId`。GSI `byCategoryAndColor`: PK=`userId`, SK=`categoryColor`。
- `WearLog`: PK=`userId`, SK=`logId`（`YYYY-MM-DD#{uuid}`）。これで日付範囲 Query が可能。
- DBアクセスの全クエリに、JWTから得る `userId` を条件として含める。クライアントから `userId` を渡させない。

---

## 6. 実装上の品質・安全要件

- 認証済みユーザーのIDはサーバー側でトークンから取得する。別ユーザーのIDをパスやbodyに指定しても読めないこと。
- LLM APIキーはクライアント・リポジトリに置かない。Secret Manager / SSM Parameter Store等で保管し、サーバー実行環境だけが読む。
- アップロード可能な画像のMIMEタイプ・サイズを検証する。自撮りはセンシティブな個人画像なので、保存期間・削除導線を明示する。
- アイテム削除時の画像・ログ参照の扱いを決める。推奨は「服を削除しても着用ログは残し、表示は削除済み扱い」。画像の物理削除は非同期に行う。
- APIのページネーション、DynamoDB Queryの `LastEvaluatedKey`、S3署名URLの期限切れを実装する。
- 失敗した画像アップロードで孤立したオブジェクトを定期削除するか、DB作成完了前のプレフィックスを分ける。
- LLM出力のJSONパース失敗、タイムアウト、候補0件を通常系として扱う。

---

## 7. 現行リポジトリとの対応と、移植しないもの

| 領域 | 現行ソース | 状態 | 新版での扱い |
| --- | --- | --- | --- |
| アプリ起動・Amplify初期化 | `flutter_app/coordinate/lib/main.dart` | 実装済み | 技術選定に応じ置換 |
| 認証 | `services/auth_service.dart`、login/signup | Cognito実装済み | 継承可能 |
| 服API | `services/clothes_api_service.dart` | 実API接続済み | 契約を保ち、`imageUrl` は `imageKey` へ改名推奨 |
| 自撮りAPI | `services/selfie_api_service.dart` | 実API接続済み | 継承可能 |
| 新規服・自撮りフロー | `screens/camera_page.dart` | 実装済み | 1画面に責務が集中。分割推奨 |
| クローゼット | `screens/home_page.dart` | 実装済み | グリッド要件に対し現行はカテゴリ別リスト |
| カレンダー | `screens/calendar_page.dart` | 実装済み | 月範囲でログを取り直すよう改善 |
| 統計 | `screens/statistics_page.dart` | ダミーデータ | 必ず実ログ集計へ作り直す |
| `WearRepository` / `ApiClient` / `LocalStorage` | `repositories/`, `services/api_client.dart` | 旧フェーズのダミー実装 | 実API経路と二重管理のため移植しない |
| `review_page.dart` | - | ダミー候補画面 | 実解析画面に統合済みのため移植しない |

重要な不整合:

- 企画書・READMEは「AWS Rekognition」と書くが、Lambda実装はGemini Vision APIを利用する。
- READMEに `react-native-calendars` とあるが、Flutter実装は `table_calendar`。
- `imageUrl` というフィールドにS3のキーを保存している。新実装では `imageKey` に統一する。
- 統計画面はDBを読まず、ハードコードしたダミーログを表示している。
- 旧データモデル（`WearItem`, `WearLog`）と実APIモデルの形が異なる。新実装は実APIモデルを正とする。

---

## 8. 受け入れ基準（デモで確認すること）

1. 新規ユーザーがメール認証を完了し、ログインできる。
2. 服画像と必須のカテゴリ・色を入力して登録すると、本人のホームにだけ表示される。
3. 登録済みの服を編集すると、カテゴリ・色検索の結果にも更新が反映される。
4. 自撮り後、解析中UIを表示し、トップス・ボトムス等の検出ごとに候補が最大3件出る。
5. 候補を選んで記録すると、当日カレンダーに記録印が付き、日付詳細で画像・服を確認できる。
6. 別ユーザーでは、服一覧・検索候補・ログが一切混ざらない。
7. AIが候補を返せない場合でも、画面がクラッシュせず、新規服登録または再撮影に進める。
8. 統計はダミー値ではなく、保存済みWearLogとClothesから算出される。
9. アイテムを削除した後も、過去ログ画面は「削除済みアイテム」として壊れずに表示される。

---

## 9. ハッカソン向け実装優先度

### Must（最初に完成させる）

- 認証、ユーザー分離
- 服の画像付きCRUD
- 自撮りアップロード → AI解析 → 候補選択 → 着用ログ作成
- 月別カレンダーと日別詳細
- デモ用シードデータ・エラー時の代替表示

### Should（時間があれば）

- 実データの「今月よく着た服 / 色」ランキング
- 未着用期間が長い服の提案
- 服登録時のAIタグ初期提案
- フィルタ・検索、プロフィール編集

### Could（今回のMVP外）

- 天気・予定に応じたコーデ提案
- クローゼット共有
- 購買連携
- 厳密な画像類似検索・ベクトルDB

---

## 10. 新版の推奨ディレクトリ構成（技術非依存）

```text
app/
  features/
    auth/
    closet/          # item list, detail, create/edit
    outfit-log/      # selfie capture, analysis, selection, logs
    calendar/
    analytics/
    profile/
  domain/
    clothes.ts
    wear-log.ts
    taxonomy.ts
  api/
    clothes-client.ts
    logs-client.ts
    analysis-client.ts
backend/
  routes/
  services/
    image-analysis.ts
    candidate-matcher.ts
  repositories/
  schemas/
infra/
  database/
  storage/
  auth/
```

画面が直接SDKを呼ばないように、`API client → use case/service → UI` の依存方向にする。タグ定義はフロント・バックで重複させず、共有スキーマから生成または同じ定義を参照する。

---

## 11. 開発・デモ時の注意

- 実在人物の自撮りを外部画像AIに渡すことを、デモ参加者に明示し同意を得る。
- テスト環境ではLLM呼び出しをモック可能にし、固定JSONで候補選択画面を確実にデモできるようにする。
- モバイルのカメラ権限拒否、Webでのカメラ非対応、画像URL取得失敗を個別に案内する。
- 本番用のAIモデル名は将来変わるため、環境変数で差し替える。現行の `gemini-1.5-flash-latest` は固定しない。
- 服の識別は完全一致問題ではない。AIの誤認識を前提に、候補画像・属性・選択解除・手動検索をUIに設けることがプロダクト品質に直結する。

---

## 12. 参照した現行資料

- `README.md` — 初期の企画・技術スタック
- `Docx/ハッカソン企画書：所持服管理アプリ「AIクローゼット（仮）」.md` — 課題と画面構想
- `Docx/アイテムカテゴリ.md` と `lib/constants/clothes_options.dart` — タグ語彙
- `flutter_app/coordinate/docs/dynamodb_design.md` — DynamoDBキー案
- `flutter_app/coordinate/amplify/backend/function/coordinatece970dec/src/index.py` — 実際のAPI、Gemini解析、候補スコアリング
- `flutter_app/coordinate/lib/screens/` と `lib/services/` — 現行画面・クライアント通信
