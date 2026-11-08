import { colorLabels, colorNeighbors, subCategoryLabels, subCategoryNeighbors, type categories, type colors, type lengths, type subCategories } from "@ai-closet/shared";

type Category = (typeof categories)[number];
type Color = (typeof colors)[number];
type SubCategory = (typeof subCategories)[number];
type Length = (typeof lengths)[number];

export type ClosetRow = {
  clothesId: string; category: Category; subCategory: SubCategory | null; color: Color;
  sleeveLength: Length | null; hemLength: Length | null; name: string | null; imageKey: string | null;
  /** YYYY-MM-DD。一度も記録がなければ null */
  lastWorn: string | null;
  /** YYYY-MM-DD */
  createdOn: string;
};

export type DetectedSlot = {
  category: Category; subCategory: SubCategory | null; color: Color | null;
  sleeveLength: Length | null; hemLength: Length | null;
  /** 属性ごとの確からしさ。低いものは「不明」と同じ扱いにして減点しない */
  attributeConfidence: Partial<Record<"subCategory" | "color" | "sleeveLength" | "hemLength", number | null>>;
};

export type ScoredCandidate = { item: ClosetRow; score: number; reasons: string[]; sortKey: number };

/** docs/AI_logic.md 5.2 の重み。pattern / image similarity は導入後に追加する */
export const WEIGHTS = { color: 35, subCategory: 25, length: 12 } as const;
const NEAR = { color: 0.55, subCategory: 0.45, length: 0.5 } as const;
/** これ未満の属性確信度は「見えていない」とみなして採点から外す */
export const MIN_ATTRIBUTE_CONFIDENCE = 0.5;

const sleeveLabels: Record<Length, string> = { short: "半袖", half: "五分・七分袖", long: "長袖" };
const hemLabels: Record<Length, string> = { short: "短め丈", half: "ミディ丈", long: "ロング丈" };

function usable<T>(value: T | null | undefined, confidence: number | null | undefined): value is T {
  return value != null && (confidence == null || confidence >= MIN_ATTRIBUTE_CONFIDENCE);
}
function lengthMatch(a: Length, b: Length) {
  if (a === b) return 1;
  return a === "half" || b === "half" ? NEAR.length : 0;
}
function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * 1 着の属性スコア（0〜100）。写真で不明だった項目や、登録服側に値がない項目は
 * 0 点にも減点にもせず、利用可能な重みだけで正規化する。
 */
export function scoreAttributes(d: DetectedSlot, item: ClosetRow): { score: number; reasons: string[] } {
  let earned = 0, available = 0;
  const reasons: string[] = [];
  const c = d.attributeConfidence;

  if (usable(d.color, c.color)) {
    available += WEIGHTS.color;
    if (d.color === item.color) { earned += WEIGHTS.color; reasons.push(`${colorLabels[item.color]}が一致`); }
    else if (colorNeighbors[d.color]?.includes(item.color)) { earned += WEIGHTS.color * NEAR.color; reasons.push(`色が近い（${colorLabels[item.color]}）`); }
  }
  if (usable(d.subCategory, c.subCategory) && item.subCategory) {
    available += WEIGHTS.subCategory;
    if (d.subCategory === item.subCategory) { earned += WEIGHTS.subCategory; reasons.push(`${subCategoryLabels[item.subCategory]}が一致`); }
    else if (subCategoryNeighbors[d.subCategory]?.includes(item.subCategory)) { earned += WEIGHTS.subCategory * NEAR.subCategory; reasons.push(`種類が近い（${subCategoryLabels[item.subCategory]}）`); }
  }

  // 袖はトップス・アウター、丈はボトムスで比較。ワンピースは両方を半分ずつの重みで見る
  const lengthFeatures: { key: "sleeveLength" | "hemLength"; weight: number; labels: Record<Length, string> }[] =
    d.category === "tops" || d.category === "outer" ? [{ key: "sleeveLength", weight: WEIGHTS.length, labels: sleeveLabels }]
    : d.category === "bottoms" ? [{ key: "hemLength", weight: WEIGHTS.length, labels: hemLabels }]
    : d.category === "dress" ? [{ key: "sleeveLength", weight: WEIGHTS.length / 2, labels: sleeveLabels }, { key: "hemLength", weight: WEIGHTS.length / 2, labels: hemLabels }]
    : [];
  for (const f of lengthFeatures) {
    const detected = d[f.key], owned = item[f.key];
    if (!usable(detected, c[f.key]) || !owned) continue;
    available += f.weight;
    const m = lengthMatch(detected, owned);
    earned += f.weight * m;
    if (m === 1) reasons.push(`${f.labels[owned]}が一致`);
  }

  // 比較できる属性がない（カテゴリしか分からない）場合は中間点にして、手動選択に委ねる
  const score = available === 0 ? 50 : Math.round((earned / available) * 100);
  return { score, reasons };
}

/**
 * docs/AI_logic.md 5.3 の個人化補正。並び順にだけ使い、表示スコアには含めない。
 * 補正幅（-8〜+3）は属性差より小さく、明らかに別の服を上に出さない。
 */
export function personalization(item: ClosetRow, today: string): { delta: number; reason?: string } {
  if (item.lastWorn) {
    const days = daysBetween(item.lastWorn, today);
    if (days >= 0 && days <= 7) return { delta: -8, reason: "最近着用" };
    if (days >= 90) return { delta: 3, reason: "90日以上着ていません" };
    return { delta: 0 };
  }
  return daysBetween(item.createdOn, today) >= 90 ? { delta: 3, reason: "90日以上着ていません" } : { delta: 0 };
}

/**
 * 同一 category の服すべてを母集団とし（検索漏れ防止）、属性スコア + 個人化で並べて上位を返す。
 * 色や種類が一致しない服も母集団からは外さず、順位を下げるだけにする。
 */
export function rankCandidates(d: DetectedSlot, closet: ClosetRow[], topK: number, today: string): ScoredCandidate[] {
  return closet
    .filter(item => item.category === d.category)
    .map(item => {
      const { score, reasons } = scoreAttributes(d, item);
      const p = personalization(item, today);
      return { item, score, reasons: p.reason ? [...reasons, p.reason] : reasons, sortKey: score + p.delta };
    })
    .sort((a, b) => b.sortKey - a.sortKey || b.score - a.score)
    .slice(0, topK);
}
