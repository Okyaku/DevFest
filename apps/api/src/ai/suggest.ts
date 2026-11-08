import { GoogleGenAI } from "@google/genai";
import { MODEL, AI_MOCK } from "./model.js";

const TIMEOUT_MS = Number(process.env.VERTEX_AI_TIMEOUT_MS ?? 25_000);

let client: GoogleGenAI | null = null;
function getClient() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      client = new GoogleGenAI({ apiKey });
    } else {
      client = new GoogleGenAI({
        vertexai: true,
        project: process.env.GOOGLE_CLOUD_PROJECT ?? process.env.FIREBASE_PROJECT_ID,
        location: process.env.VERTEX_AI_LOCATION ?? "us-central1",
      });
    }
  }
  return client;
}

export type WeatherInfo = {
  temperature: number;
  apparentTemperature: number;
  weatherCode: number;
  precipitation: number;
  windSpeed: number;
};

export type ClothesForSuggestion = {
  clothesId: string;
  category: string;
  subCategory: string | null;
  color: string;
  season: string[];
  name: string | null;
};

export type SuggestionResult = {
  greeting: string;
  outfitIds: string[];
  reason: string;
  tips: string;
};

const weatherDescriptions: Record<number, string> = {
  0: "快晴", 1: "おおむね晴れ", 2: "一部曇り", 3: "曇り",
  45: "霧", 48: "霧氷", 51: "軽い霧雨", 53: "霧雨", 55: "強い霧雨",
  61: "小雨", 63: "雨", 65: "大雨", 71: "小雪", 73: "雪", 75: "大雪",
  80: "にわか雨", 81: "強いにわか雨", 85: "小雪", 86: "大雪",
  95: "雷雨", 96: "雹を伴う雷雨", 99: "雹を伴う強い雷雨",
};

function buildPrompt(weather: WeatherInfo, clothes: ClothesForSuggestion[], prefecture: string): string {
  const weatherDesc = weatherDescriptions[weather.weatherCode] ?? "不明";
  const clothesList = clothes.map(c =>
    `- ID:${c.clothesId} ${c.name ?? ""} (${c.category}/${c.subCategory ?? "?"}, ${c.color}, 季節:${c.season.join(",")})`
  ).join("\n");

  return `あなたはファッションアドバイザーです。ユーザーの今日の服装を提案してください。

## 今日の天気 (${prefecture})
- 天気: ${weatherDesc}
- 気温: ${weather.temperature}°C (体感: ${weather.apparentTemperature}°C)
- 降水量: ${weather.precipitation}mm
- 風速: ${weather.windSpeed}km/h

## ユーザーのクローゼット
${clothesList}

## ルール
- クローゼットの中にある服のIDだけを使ってコーディネートを提案してください
- 天気と気温に合った服を選んでください
- トップス、ボトムス、アウター（必要な場合）、シューズをバランスよく選んでください
- 雨の場合は防水性を考慮してください

## 出力形式（JSON）
{
  "greeting": "天気に関する一言挨拶（30文字以内）",
  "outfitIds": ["選んだ服のclothesIdの配列"],
  "reason": "この組み合わせを選んだ理由（80文字以内）",
  "tips": "今日のファッションティップス（50文字以内）"
}

JSON のみ出力してください。`;
}

const mockResult: SuggestionResult = {
  greeting: "今日は過ごしやすい気温です！",
  outfitIds: [],
  reason: "気温に合わせたカジュアルコーデです。",
  tips: "薄手の羽織を持っておくと安心です。",
};

export async function suggestOutfit(
  weather: WeatherInfo,
  clothes: ClothesForSuggestion[],
  prefecture: string,
): Promise<SuggestionResult> {
  if (AI_MOCK || clothes.length === 0) {
    return { ...mockResult, outfitIds: clothes.slice(0, 3).map(c => c.clothesId) };
  }

  const prompt = buildPrompt(weather, clothes, prefecture);
  const res = await getClient().models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      temperature: 0.7,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    },
  });

  try {
    const parsed = JSON.parse(res.text ?? "{}") as SuggestionResult;
    const validIds = new Set(clothes.map(c => c.clothesId));
    parsed.outfitIds = (parsed.outfitIds ?? []).filter(id => validIds.has(id));
    return parsed;
  } catch {
    return { ...mockResult, outfitIds: clothes.slice(0, 3).map(c => c.clothesId) };
  }
}
