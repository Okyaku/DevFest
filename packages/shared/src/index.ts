import { z } from "zod";

export const categories = ["tops", "bottoms", "outer", "dress", "shoes"] as const;
export const colors = ["white", "black", "gray", "brown", "beige", "blue", "navy", "green", "yellow", "orange", "red", "pink", "purple", "gold", "silver", "denim", "multi-color"] as const;
export const subCategories = ["t-shirt", "shirt/blouse", "knit/sweater", "sweatshirt/hoodie", "denim/jeans", "slacks/pants", "skirt", "shorts", "jacket/coat", "cardigan", "one-piece", "setup", "sneakers", "leather/pumps", "boots", "sandals"] as const;
export const seasons = ["spring", "summer", "fall", "winter"] as const;
export const scenes = ["casual", "business", "feminine", "other"] as const;

export const clothesInputSchema = z.object({
  category: z.enum(categories), color: z.enum(colors), subCategory: z.enum(subCategories).optional(),
  sleeveLength: z.enum(["short", "half", "long"]).optional(), hemLength: z.enum(["short", "half", "long"]).optional(),
  season: z.array(z.enum(seasons)).default([]), scene: z.enum(scenes).optional(), imageKey: z.string().min(1).optional(),
  name: z.string().max(80).optional(), notes: z.string().max(500).optional()
});
export type ClothesInput = z.infer<typeof clothesInputSchema>;

export const uploadRequestSchema = z.object({
  kind: z.enum(["items", "selfies", "profile"]), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), size: z.number().positive().max(10 * 1024 * 1024)
});
export const logInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), selfieKey: z.string().optional(),
  selections: z.record(z.string()).optional(), clothesIds: z.array(z.string().uuid()).min(1)
});
export const analyzeInputSchema = z.object({ selfieKey: z.string().min(1), topK: z.number().int().min(1).max(3).default(3) });

export const categoryLabels: Record<(typeof categories)[number], string> = { tops: "トップス", bottoms: "ボトムス", outer: "アウター", dress: "ワンピース", shoes: "シューズ" };
export const colorLabels: Record<(typeof colors)[number], string> = { white: "白", black: "黒", gray: "グレー", brown: "ブラウン", beige: "ベージュ", blue: "青", navy: "ネイビー", green: "緑", yellow: "黄", orange: "オレンジ", red: "赤", pink: "ピンク", purple: "紫", gold: "ゴールド", silver: "シルバー", denim: "デニム", "multi-color": "マルチカラー" };
