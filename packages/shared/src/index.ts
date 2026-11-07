import { z } from "zod";

export const categories = ["tops", "bottoms", "outer", "dress", "shoes"] as const;
export const colors = ["white", "black", "gray", "brown", "beige", "blue", "navy", "green", "yellow", "orange", "red", "pink", "purple", "gold", "silver", "denim", "multi-color"] as const;
export const subCategories = ["t-shirt", "shirt/blouse", "knit/sweater", "sweatshirt/hoodie", "denim/jeans", "slacks/pants", "skirt", "shorts", "jacket/coat", "cardigan", "one-piece", "setup", "sneakers", "leather/pumps", "boots", "sandals"] as const;
export const seasons = ["spring", "summer", "fall", "winter"] as const;
export const scenes = ["casual", "business", "feminine", "other"] as const;

export const lengths = ["short", "half", "long"] as const;

/** subCategory ごとに許される親 category。cardigan はトップスとしてもアウターとしても扱う */
export const subCategoryParents: Record<(typeof subCategories)[number], readonly (typeof categories)[number][]> = {
  "t-shirt": ["tops"], "shirt/blouse": ["tops"], "knit/sweater": ["tops"], "sweatshirt/hoodie": ["tops"],
  "denim/jeans": ["bottoms"], "slacks/pants": ["bottoms"], skirt: ["bottoms"], shorts: ["bottoms"],
  "jacket/coat": ["outer"], cardigan: ["outer", "tops"],
  "one-piece": ["dress"], setup: ["dress"],
  sneakers: ["shoes"], "leather/pumps": ["shoes"], boots: ["shoes"], sandals: ["shoes"]
};
export function isSubCategoryOf(sub: string | null | undefined, category: string): boolean {
  if (!sub) return true;
  return (subCategoryParents as Record<string, readonly string[]>)[sub]?.includes(category) ?? false;
}

/** 完全一致ではないが候補からは外さない近似関係（双方向） */
export const colorNeighbors: Partial<Record<(typeof colors)[number], readonly (typeof colors)[number][]>> = {
  blue: ["navy", "denim"], navy: ["blue", "denim", "black"], denim: ["blue", "navy"],
  white: ["beige", "silver"], beige: ["white", "brown"], brown: ["beige"],
  gray: ["black", "silver"], black: ["gray", "navy"], silver: ["gray", "white"], gold: ["yellow"], yellow: ["gold"]
};
export const subCategoryNeighbors: Partial<Record<(typeof subCategories)[number], readonly (typeof subCategories)[number][]>> = {
  "knit/sweater": ["sweatshirt/hoodie", "cardigan"], "sweatshirt/hoodie": ["knit/sweater"], cardigan: ["knit/sweater", "jacket/coat"],
  "jacket/coat": ["cardigan"], "t-shirt": ["shirt/blouse"], "shirt/blouse": ["t-shirt"],
  "denim/jeans": ["slacks/pants"], "slacks/pants": ["denim/jeans"], skirt: ["shorts"], shorts: ["skirt"],
  "one-piece": ["setup"], setup: ["one-piece"], sneakers: ["leather/pumps"], "leather/pumps": ["sneakers", "boots"], boots: ["leather/pumps"]
};

const aiTagsSchema = z.object({
  category: z.enum(categories), subCategory: z.enum(subCategories).nullable(), color: z.enum(colors),
  sleeveLength: z.enum(lengths).nullable(), hemLength: z.enum(lengths).nullable(),
  season: z.array(z.enum(seasons)), scene: z.enum(scenes).nullable()
});
const confidenceSchema = z.record(z.number().min(0).max(1).nullable());

export const clothesInputSchema = z.object({
  category: z.enum(categories), color: z.enum(colors), subCategory: z.enum(subCategories).optional(),
  sleeveLength: z.enum(lengths).optional(), hemLength: z.enum(lengths).optional(),
  season: z.array(z.enum(seasons)).default([]), scene: z.enum(scenes).optional(), imageKey: z.string().min(1).optional(),
  name: z.string().max(80).optional(), notes: z.string().max(500).optional(),
  /** AI の初期提案（評価用）。正規タグとは別に保存し、上書きに使わない */
  ai: z.object({ tags: aiTagsSchema, confidence: confidenceSchema, analysisVersion: z.string().max(40) }).optional()
}).refine(v => isSubCategoryOf(v.subCategory, v.category), { message: "subCategory does not belong to category", path: ["subCategory"] });
export type ClothesInput = z.infer<typeof clothesInputSchema>;

export const uploadRequestSchema = z.object({
  kind: z.enum(["items", "selfies", "profile"]), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), size: z.number().positive().max(10 * 1024 * 1024)
});
export const logItemSchema = z.object({
  clothesId: z.string().uuid(),
  slot: z.string().max(20).optional(),
  score: z.number().int().min(0).max(100).optional(),
  rank: z.number().int().min(1).max(50).optional(),
  reasons: z.array(z.string().max(40)).max(10).optional()
});
export const logInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), timezone: z.string().max(64).optional(),
  selfieKey: z.string().optional(), analysisVersion: z.string().max(40).optional(),
  selections: z.record(z.string()).optional(),
  /** 空配列は「写真だけの日記」。着用統計には含めない */
  clothesIds: z.array(z.string().uuid()).default([]),
  /** 選択時の候補情報（AI が何位に出し、何を選んだかの評価用） */
  items: z.array(logItemSchema).max(20).optional()
});
export type LogInput = z.infer<typeof logInputSchema>;

export const analyzeInputSchema = z.object({ selfieKey: z.string().min(1), topK: z.number().int().min(1).max(5).default(3) });
export const analyzeOutfitInputSchema = z.object({ selfieKey: z.string().min(1), topK: z.number().int().min(1).max(5).default(5), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
export const analyzeItemInputSchema = z.object({ imageKey: z.string().min(1) });

/** 服単品の解析結果（モデル出力をサーバーで正規化した後の形） */
export const analyzeItemResultSchema = aiTagsSchema.extend({
  description: z.string().max(80).nullable(),
  confidence: confidenceSchema,
  needsReview: z.boolean(),
  reviewFields: z.array(z.string()),
  warnings: z.array(z.enum(["multiple_garments", "poor_image"]))
});
export type AnalyzeItemResult = z.infer<typeof analyzeItemResultSchema>;

export const outfitSlotStatuses = ["candidates_found", "no_candidates", "low_confidence", "image_not_usable"] as const;
export const outfitCandidateSchema = z.object({
  clothesId: z.string(), score: z.number().int().min(0).max(100), reasons: z.array(z.string()),
  name: z.string().nullable(), category: z.enum(categories), color: z.enum(colors),
  subCategory: z.enum(subCategories).nullable(), imageKey: z.string().nullable(), imageUrl: z.string().nullable()
});
export const outfitSlotSchema = z.object({
  slotId: z.string(),
  detected: z.object({
    category: z.enum(categories), subCategory: z.enum(subCategories).nullable(), color: z.enum(colors).nullable(),
    sleeveLength: z.enum(lengths).nullable(), hemLength: z.enum(lengths).nullable(), confidence: z.number().min(0).max(1)
  }),
  candidates: z.array(outfitCandidateSchema),
  status: z.enum(outfitSlotStatuses)
});
export const analyzeOutfitResultSchema = z.object({ analysisVersion: z.string(), slots: z.array(outfitSlotSchema), warnings: z.array(z.string()) });
export type OutfitSlot = z.infer<typeof outfitSlotSchema>;
export type OutfitCandidate = z.infer<typeof outfitCandidateSchema>;
export type AnalyzeOutfitResult = z.infer<typeof analyzeOutfitResultSchema>;

export const profileInputSchema = z.object({
  displayName: z.string().max(50).nullable().optional(),
  avatarKey: z.string().nullable().optional(),
  age: z.number().int().min(1).max(150).nullable().optional(),
  prefecture: z.string().max(10).nullable().optional(),
  district: z.string().max(30).nullable().optional(),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export const prefectures = [
  "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県",
  "茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県",
  "新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県",
  "三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県",
  "鳥取県","島根県","岡山県","広島県","山口県",
  "徳島県","香川県","愛媛県","高知県",
  "福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"
] as const;

export const categoryLabels: Record<(typeof categories)[number], string> = { tops: "トップス", bottoms: "ボトムス", outer: "アウター", dress: "ワンピース", shoes: "シューズ" };
export const colorLabels: Record<(typeof colors)[number], string> = { white: "白", black: "黒", gray: "グレー", brown: "ブラウン", beige: "ベージュ", blue: "青", navy: "ネイビー", green: "緑", yellow: "黄", orange: "オレンジ", red: "赤", pink: "ピンク", purple: "紫", gold: "ゴールド", silver: "シルバー", denim: "デニム", "multi-color": "マルチカラー" };
export const subCategoryLabels: Record<(typeof subCategories)[number], string> = { "t-shirt": "Tシャツ", "shirt/blouse": "シャツ・ブラウス", "knit/sweater": "ニット・セーター", "sweatshirt/hoodie": "スウェット・パーカー", "denim/jeans": "デニム", "slacks/pants": "スラックス・パンツ", skirt: "スカート", shorts: "ショートパンツ", "jacket/coat": "ジャケット・コート", cardigan: "カーディガン", "one-piece": "ワンピース", setup: "セットアップ", sneakers: "スニーカー", "leather/pumps": "革靴・パンプス", boots: "ブーツ", sandals: "サンダル" };
export const lengthLabels: Record<(typeof lengths)[number], string> = { short: "短め", half: "中間", long: "長め" };
export const seasonLabels: Record<(typeof seasons)[number], string> = { spring: "春", summer: "夏", fall: "秋", winter: "冬" };
export const sceneLabels: Record<(typeof scenes)[number], string> = { casual: "カジュアル", business: "ビジネス", feminine: "フェミニン", other: "その他" };
