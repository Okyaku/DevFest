import { z } from "zod";
import { categories, colors, isSubCategoryOf, lengths, scenes, seasons, subCategories, type AnalyzeItemResult, type OutfitSlot } from "@ai-closet/shared";
import { AI_MOCK, generateStructured, MODEL, type ImageInput } from "./model.js";
import { rankCandidates, type ClosetRow, type DetectedSlot } from "./matching.js";

export const ANALYSIS_VERSION = `2026-11-07:${AI_MOCK ? "mock" : MODEL}`.slice(0, 40);
/** これ未満の属性は利用者の確認を促す（docs/AI_logic.md 3.2） */
const REVIEW_THRESHOLD = 0.7;
/** これ未満の検出枠は low_confidence として再撮影を案内する */
const SLOT_LOW_CONFIDENCE = 0.6;
const MAX_SLOTS_PER_CATEGORY = 2;

// ---- モデル出力のスキーマ（JSON Schema でモデルを縛り、Zod でサーバー側でも再検証する） ----

const conf = z.number().min(0).max(1).nullable();
const rawItemSchema = z.object({
  category: z.enum(categories), subCategory: z.enum(subCategories).nullable(), color: z.enum(colors),
  sleeveLength: z.enum(lengths).nullable(), hemLength: z.enum(lengths).nullable(),
  season: z.array(z.enum(seasons)), scene: z.enum(scenes).nullable(),
  description: z.string().nullable(), garmentCount: z.number().int().min(0), imageQuality: z.enum(["good", "poor"]),
  confidence: z.object({ category: conf, subCategory: conf, color: conf, sleeveLength: conf, hemLength: conf }),
});
const rawSlotSchema = z.object({
  category: z.enum(categories), subCategory: z.enum(subCategories).nullable(), color: z.enum(colors).nullable(),
  sleeveLength: z.enum(lengths).nullable(), hemLength: z.enum(lengths).nullable(), confidence: z.number().min(0).max(1),
  attributeConfidence: z.object({ subCategory: conf, color: conf, sleeveLength: conf, hemLength: conf }),
});
const rawOutfitSchema = z.object({ usable: z.boolean(), slots: z.array(rawSlotSchema).max(10) });
type RawSlot = z.infer<typeof rawSlotSchema>;

const enumOf = (values: readonly string[]) => ({ type: "string", enum: [...values] });
const nullableEnum = (values: readonly string[]) => ({ type: ["string", "null"], enum: [...values, null] });
const num01 = { type: "number", minimum: 0, maximum: 1 };
const nullableNum01 = { type: ["number", "null"], minimum: 0, maximum: 1 };
const obj = (properties: Record<string, object>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

const itemJsonSchema = obj({
  category: enumOf(categories), subCategory: nullableEnum(subCategories), color: enumOf(colors),
  sleeveLength: nullableEnum(lengths), hemLength: nullableEnum(lengths),
  season: { type: "array", items: enumOf(seasons) }, scene: nullableEnum(scenes),
  description: { type: ["string", "null"] }, garmentCount: { type: "integer", minimum: 0 }, imageQuality: enumOf(["good", "poor"]),
  confidence: obj({ category: nullableNum01, subCategory: nullableNum01, color: nullableNum01, sleeveLength: nullableNum01, hemLength: nullableNum01 }),
});
const outfitJsonSchema = obj({
  usable: { type: "boolean" },
  slots: { type: "array", maxItems: 10, items: obj({
    category: enumOf(categories), subCategory: nullableEnum(subCategories), color: nullableEnum(colors),
    sleeveLength: nullableEnum(lengths), hemLength: nullableEnum(lengths), confidence: num01,
    attributeConfidence: obj({ subCategory: nullableNum01, color: nullableNum01, sleeveLength: nullableNum01, hemLength: nullableNum01 }),
  }) },
});

// ---- 指示 ----

const COMMON_RULES = `
- Only use the enum values allowed by the response schema. Never invent other tags.
- If an attribute is not visible or cannot be determined, return null for it. Do NOT guess plausible values.
- "color" is the single dominant color. Patterned garments (stripes, checks, florals, prints) must be "multi-color", even on a black or white base.
- "denim" is a color for denim fabric. Shoes have no sleeveLength/hemLength (null). Bottoms have no sleeveLength (null). Tops and outer have no hemLength (null).
- sleeveLength: short = short sleeves or sleeveless, half = elbow / three-quarter, long = wrist length.
- hemLength (bottoms and dresses): short = above the knee, half = knee to mid-calf, long = ankle length.
- subCategory must belong to the category: tops = t-shirt, shirt/blouse, knit/sweater, sweatshirt/hoodie, cardigan; bottoms = denim/jeans, slacks/pants, skirt, shorts; outer = jacket/coat, cardigan; dress = one-piece, setup; shoes = sneakers, leather/pumps, boots, sandals.
- Confidence values are 0 to 1 and must reflect how clearly the attribute is visible.
- Output JSON only.`;

const ITEM_PROMPT = `You extract attributes of a single garment so the owner can register it in their digital closet.
Describe only the main garment in the photo.
- garmentCount: number of distinct garments clearly visible.
- imageQuality: "poor" if the garment is cut off, too dark, blurred or mostly hidden by the background.
- description: a short Japanese description of the garment (max 30 characters), e.g. "黒の半袖クルーネックTシャツ". Null if unclear.
- season: seasons the garment is suitable for (may be empty).
${COMMON_RULES}`;

const OUTFIT_PROMPT = `You look at a photo of a person's outfit of the day so the app can find the same garments in the owner's own closet.
Return one slot per visible worn garment: tops, bottoms, outer, dress, shoes.
- Only report garments that are actually visible and being worn. Do not report a slot for a garment you cannot see; do not return empty objects.
- If a one-piece dress is worn, report it as "dress" and do not also report it as tops and bottoms.
- A layered inner shirt and outer knit may be two tops slots. Report at most two slots per category.
- Accessories, bags and hats are not slots.
- confidence: how sure you are that this garment exists and the category is correct.
- usable: false only when the photo contains no recognizable worn clothing at all (e.g. too dark, no person, extreme blur).
- Never output anything about the person's face, body shape, age or gender.
${COMMON_RULES}`;

// ---- モック（AI_MOCK=true。LLM を呼ばずに固定 JSON で画面を確認する） ----

const mockItem: z.infer<typeof rawItemSchema> = {
  category: "tops", subCategory: "t-shirt", color: "black", sleeveLength: "short", hemLength: null, season: ["spring", "summer"], scene: "casual",
  description: "黒の半袖Tシャツ", garmentCount: 1, imageQuality: "good",
  confidence: { category: 0.98, subCategory: 0.86, color: 0.97, sleeveLength: 0.92, hemLength: null },
};
const mockOutfit: z.infer<typeof rawOutfitSchema> = {
  usable: true,
  slots: [
    { category: "tops", subCategory: "t-shirt", color: "black", sleeveLength: "short", hemLength: null, confidence: 0.89, attributeConfidence: { subCategory: 0.8, color: 0.95, sleeveLength: 0.9, hemLength: null } },
    { category: "bottoms", subCategory: "denim/jeans", color: "denim", sleeveLength: null, hemLength: "long", confidence: 0.84, attributeConfidence: { subCategory: 0.85, color: 0.9, sleeveLength: null, hemLength: 0.7 } },
    { category: "shoes", subCategory: "sneakers", color: "white", sleeveLength: null, hemLength: null, confidence: 0.55, attributeConfidence: { subCategory: 0.6, color: 0.7, sleeveLength: null, hemLength: null } },
  ],
};

// ---- 服単品の解析 ----

export async function analyzeItem(image: ImageInput): Promise<AnalyzeItemResult> {
  const raw = AI_MOCK ? mockItem : await generateStructured(ITEM_PROMPT, image, itemJsonSchema, rawItemSchema);
  const reviewFields = new Set<string>();
  const confidence: Record<string, number | null> = { ...raw.confidence };

  let subCategory = raw.subCategory;
  if (!isSubCategoryOf(subCategory, raw.category)) { subCategory = null; confidence.subCategory = null; reviewFields.add("subCategory"); }
  // カテゴリと無関係な長さ属性は捨てる
  const sleeveLength = raw.category === "tops" || raw.category === "outer" || raw.category === "dress" ? raw.sleeveLength : null;
  const hemLength = raw.category === "bottoms" || raw.category === "dress" ? raw.hemLength : null;
  if (sleeveLength === null) confidence.sleeveLength = null;
  if (hemLength === null) confidence.hemLength = null;

  for (const [field, value] of Object.entries(confidence)) if (value != null && value < REVIEW_THRESHOLD) reviewFields.add(field);
  const warnings: AnalyzeItemResult["warnings"] = [];
  if (raw.garmentCount > 1) warnings.push("multiple_garments");
  if (raw.imageQuality === "poor") warnings.push("poor_image");

  return {
    category: raw.category, subCategory, color: raw.color, sleeveLength, hemLength,
    season: [...new Set(raw.season)], scene: raw.scene,
    description: raw.description?.trim().slice(0, 80) || null,
    confidence, reviewFields: [...reviewFields],
    needsReview: reviewFields.size > 0 || warnings.length > 0, warnings,
  };
}

// ---- 着用写真の解析 ----

export class ImageNotUsableError extends Error { constructor() { super("image_not_usable"); } }

/** モデル出力の検出枠を正規化する（親子不整合の除去、dress と上下の重複除去、カテゴリごとの上限） */
export type NormalizedSlot = DetectedSlot & { slotConfidence: number };
export function normalizeSlots(slots: RawSlot[]): NormalizedSlot[] {
  const dressConfident = slots.some(s => s.category === "dress" && s.confidence >= SLOT_LOW_CONFIDENCE);
  const counts: Partial<Record<string, number>> = {};
  return slots
    .filter(s => !(dressConfident && (s.category === "tops" || s.category === "bottoms")))
    .sort((a, b) => b.confidence - a.confidence)
    .filter(s => (counts[s.category] = (counts[s.category] ?? 0) + 1) <= MAX_SLOTS_PER_CATEGORY)
    .map(s => {
      const subOk = isSubCategoryOf(s.subCategory, s.category);
      return {
        category: s.category, subCategory: subOk ? s.subCategory : null, color: s.color,
        sleeveLength: s.category === "bottoms" || s.category === "shoes" ? null : s.sleeveLength,
        hemLength: s.category === "bottoms" || s.category === "dress" ? s.hemLength : null,
        attributeConfidence: { ...s.attributeConfidence, subCategory: subOk ? s.attributeConfidence.subCategory : null },
        slotConfidence: s.confidence,
      };
    });
}

export async function detectOutfit(image: ImageInput) {
  const raw = AI_MOCK ? mockOutfit : await generateStructured(OUTFIT_PROMPT, image, outfitJsonSchema, rawOutfitSchema);
  if (!raw.usable || raw.slots.length === 0) throw new ImageNotUsableError();
  return normalizeSlots(raw.slots);
}

const slotOrder = ["outer", "tops", "dress", "bottoms", "shoes"] as const;

/** 検出枠ごとに本人のクローゼットから候補を採点して、API の応答形にまとめる */
export function buildOutfitSlots(detected: NormalizedSlot[], closet: ClosetRow[], topK: number, today: string): (Omit<OutfitSlot, "candidates"> & { ranked: ReturnType<typeof rankCandidates> })[] {
  const index: Partial<Record<string, number>> = {};
  return [...detected]
    .sort((a, b) => slotOrder.indexOf(a.category) - slotOrder.indexOf(b.category))
    .map(d => {
      const n = index[d.category] = (index[d.category] ?? -1) + 1;
      const ranked = rankCandidates(d, closet, topK, today);
      const status: OutfitSlot["status"] = d.slotConfidence < SLOT_LOW_CONFIDENCE ? "low_confidence" : ranked.length ? "candidates_found" : "no_candidates";
      return {
        slotId: `${d.category}:${n}`,
        detected: { category: d.category, subCategory: d.subCategory, color: d.color, sleeveLength: d.sleeveLength, hemLength: d.hemLength, confidence: d.slotConfidence },
        status, ranked,
      };
    });
}
