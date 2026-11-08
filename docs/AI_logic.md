# AI Closet AI 判定・照合ロジック設計

## 1. 結論

AI の役割を **属性の推定・候補の絞り込み・候補の並び替え** に限定し、着用記録の確定は必ずユーザーが行う。

服の一致判定を `category + color` だけで行うのは採用しない。同じ「黒い T シャツ」を複数持つ利用者では区別できないため、次の三段階で照合する。

1. 写真から、服ごとの正規化された属性と検出の確からしさを得る。
2. 属性で本人のクローゼットを広めに候補化する（検索漏れを防ぐ）。
3. 画像特徴量・属性一致・過去のユーザー選択で候補を順位付けする（同系統の服を区別する）。

この方式なら、AI の誤判定に強く、登録服が増えても検索を速く保てる。MVP では 1 と属性スコアまでを必須とし、画像特徴量は DB カラムを先に用意して段階導入する。

---

## 2. 用語と前提

| 用語 | 意味 |
| --- | --- |
| アイテム写真 | 新しくクローゼットへ登録する服単体の写真 |
| 着用写真 | 今日のコーディネートを記録するための全身または上半身写真 |
| slot | 着用写真内の検出枠。`tops`、`bottoms`、`outer`、`dress`、`shoes` のいずれか |
| 属性 | 共有パッケージで定義済みの `category`、`subCategory`、`color`、`sleeveLength`、`hemLength`、`season`、`scene` |
| 候補 | ある slot に対応すると考えられる、利用者自身の登録済みアイテム |

保存値は既存の英小文字タグ、画面表示は日本語ラベルに統一する。`subCategory` は親 `category` と整合するものだけを保存する。

### 属性の扱い

- `category` は必須かつ最重要。`dress` が検出された場合、原則 `tops` と `bottoms` を同時に候補化しない。
- `color` は主色を 1 つ保存する。柄物は `multi-color` とし、黒地の柄物を単純に `black` へ落とさない。
- AI が見えない属性は、推測して埋めず `null` と `confidence` を返す。未確定属性は照合時に減点しない。
- 色の近似（例: `navy` と `blue`）とカテゴリの近似（例: `sweatshirt/hoodie` と `knit/sweater`）は「完全一致ではないが候補からは外さない」関係にする。

---

## 3. 新規服登録フロー

```text
アイテム写真をアップロード
  → /api/analyze-item
  → AI が属性・説明・信頼度を返す
  → フォームに仮入力して利用者が確認・修正
  → 確定タグで Clothes を保存
  → （非同期）画像特徴量を生成し保存
```

### 3.1 `POST /api/analyze-item`

入力:

```json
{ "imageKey": "users/{uid}/items/{uuid}.jpg" }
```

成功時の例:

```json
{
  "ok": true,
  "analysis": {
    "category": "tops",
    "subCategory": "t-shirt",
    "color": "black",
    "sleeveLength": "short",
    "hemLength": null,
    "season": ["spring", "summer"],
    "scene": "casual",
    "description": "黒の半袖クルーネックTシャツ",
    "confidence": {
      "category": 0.98,
      "subCategory": 0.86,
      "color": 0.97,
      "sleeveLength": 0.92
    },
    "needsReview": false
  }
}
```

### 3.2 UI の原則

- 解析中はスケルトンを表示し、結果が来たらフォームへ自動反映する。
- 値を AI 確定表示にせず、すべて編集可能なチップ／選択肢で見せる。
- `confidence < 0.70`、親子カテゴリ不整合、または画像内に服が複数ある場合は `needsReview: true` とし、その項目を強調する。
- 写真品質が低い場合は「服全体が入る、背景が少ない写真を選んでください」と再撮影を案内する。登録を禁止しない。
- 保存された最終タグを正解データとして扱う。AI の初期推定だけを後の学習・評価の正解にしない。

### 3.3 重複登録の予防（改善案）

保存前に、同一 `category` の既存服との画像類似度を確認する。高類似（例: 0.92 以上）の服があれば「すでに登録済みかもしれません」と最大 3 件だけ表示する。ユーザーは「別の服として登録」を選べるため、色違い・同型複数枚を妨げない。

---

## 4. 今日の服を記録するフロー

```text
着用写真をアップロード
  → /api/analyze-outfit
  → 写真内の slot ごとに属性と候補を返す
  → slot ごとに利用者が候補を選ぶ／スキップ／新規登録
  → /api/logs に確定内容を送る
  → WearLog と「選択時の候補情報」を保存
```

### 4.1 `POST /api/analyze-outfit`

入力:

```json
{ "selfieKey": "users/{uid}/selfies/{uuid}.jpg", "topK": 5 }
```

出力例:

```json
{
  "ok": true,
  "analysisVersion": "2026-11-01",
  "slots": [
    {
      "slotId": "tops:0",
      "detected": {
        "category": "tops",
        "subCategory": "t-shirt",
        "color": "black",
        "sleeveLength": "short",
        "confidence": 0.89
      },
      "candidates": [
        {
          "clothesId": "uuid",
          "score": 87,
          "reasons": ["黒が一致", "Tシャツが一致", "半袖が一致"],
          "imageKey": "users/{uid}/items/{uuid}.jpg"
        }
      ],
      "status": "candidates_found"
    }
  ],
  "warnings": []
}
```

`status` は `candidates_found`、`no_candidates`、`low_confidence`、`image_not_usable` のいずれかとする。画像全体を判定不能なら HTTP 422 を返すが、slot 単位の判定不能は 200 で返し、他の slot は選べるようにする。

### 4.2 画面の選択体験

- `tops`、`bottoms`、`outer`、`shoes` を別々のセクションとして表示する。`dress` は一つのセクションで表示する。
- 各セクションでは候補の写真を 3 件程度先に見せ、「他の服を探す」で最大 20 件のフィルタ済み一覧を開く。
- 候補がない時は「クローゼットから手動で選ぶ」「この服を新規登録」「今回は記録しない」を必ず提示する。候補ゼロでフローを停止させない。
- 同じ `clothesId` を異なる slot で同時に選べないようにする。ただし `setup` の扱いは将来仕様として、上下を一つの服として登録した場合だけ重複を許容する。
- 一件も選ばなくても、写真だけの日記を保存できるよう `clothesIds` は空配列を許容する。着用統計には含めない。
- 「これを着た」を選んだ事実を、AI 評価の正解として保存する。AI スコア自体を正解とみなさない。

---

## 5. 候補検索と順位付け

### 5.1 第 1 段階: 候補母集団を作る

PostgreSQL ではまず、対象ユーザーかつ未削除の服だけに限定する。以下の順で広げる。

1. 同一 `category`。
2. 同一 `color`、または色近似グループ（`blue` ↔ `navy`、`white` ↔ `beige`、`gray` ↔ `black`）。
3. 同一 `subCategory` または近似カテゴリ。
4. それでも 5 件未満なら、同一 `category` の全アイテムまで広げる。

既存の `(user_id, category_color)` インデックスは第 2 段階の完全一致に使う。ただし近似色とカテゴリ全件へのフォールバックが必要なため、次の部分インデックスも追加する。

```sql
CREATE INDEX clothes_active_owner_category
  ON clothes (user_id, category)
  WHERE deleted_at IS NULL;
```

### 5.2 第 2 段階: 属性スコア

各候補を 0〜100 点で評価する。写真で不明だった項目は 0 点にも減点にもせず、利用可能な重みで正規化する。

| 特徴 | 一致 | 近似 | 不一致 | 重み |
| --- | ---: | ---: | ---: | ---: |
| category | 1.0 | なし | 0.0 | 必須フィルタ |
| color | 1.0 | 0.55 | 0.0 | 35 |
| subCategory | 1.0 | 0.45 | 0.0 | 25 |
| sleeveLength / hemLength | 1.0 | 0.5 | 0.0 | 12 |
| pattern / material（導入後） | 1.0 | 0.4 | 0.0 | 10 |
| image similarity（導入後） | 類似度 | - | - | 18 |

`color` と `subCategory` は黒いトップスを識別するための核だが、片方を AI が誤ることもある。そのため完全一致で検索から落とさず、順位を下げるだけにする。

### 5.3 第 3 段階: 個人化（候補の差が小さい時だけ）

属性・画像スコアが近い候補の順序を、次の補正で決める。

- 過去にそのアイテムが同じ属性の着用写真から選ばれた: `+5`
- 選ばれてから 7 日以内: `-8`（毎日同じ服の偏りを抑える。ユーザーが望めば無効化可能）
- 90 日以上未着用: `+3`（死蔵品を穏やかに発見させる）
- ユーザーが「候補ではない」と明示した組み合わせ: `-15`

この補正は属性・画像による本人性より強くしない。最近着た黒Tシャツを、画像上は明らかに別の黒Tシャツである写真より上に出すのは誤りである。

### 5.4 画像特徴量（MVP 後の精度向上）

アイテム写真と着用写真から、服領域を切り出して同じ埋め込みモデルで特徴量を生成する。cosine similarity を順位付けに使う。

- アイテム登録後: 背景を除いた服の特徴量を `clothes.image_embedding` に保存する。
- 着用記録時: slot ごとの切り抜き特徴量を一時生成する。
- DB は `pgvector` の `vector` 型を使い、まずは第 1 段階で絞った 20 件とのみ比較する。全服へのベクトル検索は登録数が増えてから導入する。
- 帽子、バッグ、肌、背景の特徴が一致に混ざらないよう、全身写真そのもの同士を単純比較しない。

画像特徴量を導入できない MVP でも、属性スコアと候補確認 UI で実用になる。精度を誇張して自動確定するより、候補写真を並べるほうが体験の失敗を防げる。

---

## 6. AI への指示と出力検証

画像モデルには自由文 JSON を頼るのではなく、JSON Schema / structured output を使用する。サーバー側でも Zod で再検証し、未知タグ・親子不整合・JSON 不正を拒否または再試行する。

### 指示の要点

- 目的を「利用者のクローゼットから探すための、見えている服の属性抽出」と明示する。
- 使用可能なタグを列挙し、値は必ず列挙値に制限する。
- 見えない・判別不能な属性は `null` とし、もっともらしい推測を禁止する。
- 着用写真では slot ごとに出力し、顔・体型・年齢・性別など服と無関係な属性を出力しない。
- 各 slot と各属性に 0〜1 の confidence を含める。

### サーバー処理

1. 署名付き URL ではなく、認証済みユーザーの `imageKey` が `users/{uid}/` 配下にあることを検証して画像を読む。
2. モデルをタイムアウト・一回だけのリトライ付きで呼ぶ。
3. 構造化出力を `analyzeItemResultSchema` / `analyzeOutfitResultSchema` で検証する。
4. タグを正規化し、検出 slot ごとに候補検索・採点する。
5. `analysisVersion`、処理時間、失敗理由だけを監査ログに残す。生の着用写真やモデル応答をログ出力しない。

---

## 7. データ・API の変更案

### Clothes に追加する項目

```sql
ALTER TABLE clothes
  ADD COLUMN ai_tags JSONB,
  ADD COLUMN ai_confidence JSONB,
  ADD COLUMN image_embedding vector(768),
  ADD COLUMN analyzed_at TIMESTAMPTZ,
  ADD COLUMN analysis_version TEXT;
```

`vector` を使う場合は先に `CREATE EXTENSION IF NOT EXISTS vector;` が必要。画像特徴量を後回しにする場合は `image_embedding` を除いた migration にする。

`ai_tags` は AI の初期提案、既存の列はユーザーが最終確定した正規データとして分離する。後者を上書きしてはならない。

### WearLog と関連テーブルに追加する項目

```sql
ALTER TABLE wear_logs
  ADD COLUMN analysis_version TEXT,
  ADD COLUMN timezone TEXT;

ALTER TABLE wear_log_items
  ADD COLUMN candidate_rank SMALLINT,
  ADD COLUMN candidate_reasons JSONB;
```

`detected_slot` と `candidate_score` は既に存在するため、`POST /api/logs` で選択結果と一緒に保存する。これにより「AI が何位に出し、利用者が何を選んだか」を後から精度評価できる。

### API の責務

| API | 責務 |
| --- | --- |
| `POST /api/analyze-item` | 服単品の仮タグ作成。DB は変更しない。 |
| `POST /api/clothes` | ユーザーが確認・修正したタグを正規データとして保存する。 |
| `POST /api/analyze-outfit` | 着用写真を slot に分け、候補と根拠を返す。DB の着用履歴は作らない。 |
| `POST /api/logs` | ユーザーが確定した選択だけを記録する。AI の候補順位も任意で残す。 |

`/api/analyze` は互換期間だけ残し、内部で `analyze-outfit` を呼ぶ。新規登録用と着用記録用を同じ API に混在させない。

---

## 8. 例外・品質・プライバシー

| 状況 | 挙動 |
| --- | --- |
| トップスだけ写っている | tops だけを返し、bottoms を「未検出」として必須選択にしない。 |
| 服が隠れている / 暗い | `low_confidence` と再撮影案内。手動選択は常に可能。 |
| クローゼットが空 | 属性を見せ、「この服を登録」へ写真・タグを引き継ぐ。 |
| 同じ服を複数回登録 | 類似服を通知するが、ユーザーの確定を優先する。 |
| API / モデル失敗 | 着用写真を保持し、「手動で選ぶ」または「再解析」を表示する。 |
| 服を削除済み | 過去ログの item は削除時点のスナップショット（名称・画像キー・タグ）を表示できるようにする。 |

着用写真はセンシティブな個人画像である。非公開バケット、短命な署名 URL、ユーザー単位のキー検証を必須とし、モデル提供者のデータ保持設定も確認する。ユーザーが写真を削除した時は、オブジェクト本体・生成済み特徴量・関連する解析キャッシュも削除対象にする。

---

## 9. 実装順序と受け入れ基準

### Phase 1: MVP

1. `subCategory` と `category` の整合性を shared schema で検証する。
2. `analyze-item` を実装し、登録フォームの初期値へつなぐ。
3. `analyze-outfit` を実装し、属性一致スコアで slot ごとの最大 5 候補を返す。
4. 選択・スキップ・手動検索・新規登録の UI を実装する。
5. `POST /api/logs` で `detected_slot`、スコア、順位、根拠をトランザクション保存する。

### Phase 2: 精度向上

1. 画像切り抜きと埋め込み特徴量を追加する。
2. 類似服通知と重複登録の確認を追加する。
3. 「選択された正解」を用いた offline 評価と重み調整を追加する。

### 受け入れ基準

- 黒い T シャツを複数登録した状態で、着用写真から同一タグの候補が複数表示され、ユーザーが正しい一着を選べる。
- AI がカテゴリや色を誤っても、同一カテゴリの手動検索で正しい一着を記録できる。
- 候補ゼロ、部分的な写り、解析失敗でも、着用記録フローが行き止まりにならない。
- AI が検出した値だけでは WearLog が作成されず、明示的なユーザー操作でのみ確定する。
- 他ユーザーの `imageKey`・服・候補は、いかなる API 経路でも参照できない。
