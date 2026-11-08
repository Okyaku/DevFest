import { GoogleGenAI } from "@google/genai";
import { MODEL, AI_MOCK } from "./model.js";

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

export type TryOnInput = {
  bodyImage: { data: Buffer; mimeType: string };
  clothesImages: { data: Buffer; mimeType: string; description: string }[];
};

export type TryOnResult = {
  imageBase64: string;
  mimeType: string;
};

function buildPrompt(descriptions: string[]): string {
  const items = descriptions.join("、");
  return `この人物の写真に、以下の服を着せたコーディネートイメージを生成してください。

着せる服: ${items}

ルール:
- 人物のポーズと体型はそのまま維持してください
- 服のスタイル、色、デザインを忠実に再現してください
- 自然で現実的なファッション写真のように仕上げてください
- 背景はシンプルに保ってください`;
}

export async function tryOn(input: TryOnInput): Promise<TryOnResult> {
  if (AI_MOCK) {
    return { imageBase64: "", mimeType: "image/png" };
  }

  const reqParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  reqParts.push({ text: buildPrompt(input.clothesImages.map(c => c.description)) });
  reqParts.push({
    inlineData: {
      mimeType: input.bodyImage.mimeType,
      data: input.bodyImage.data.toString("base64"),
    },
  });
  for (const ci of input.clothesImages) {
    reqParts.push({
      inlineData: {
        mimeType: ci.mimeType,
        data: ci.data.toString("base64"),
      },
    });
  }

  const res = await getClient().models.generateContent({
    model: "gemini-2.0-flash-exp",
    contents: [{ role: "user", parts: reqParts }],
    config: {
      responseModalities: ["IMAGE", "TEXT"],
      abortSignal: AbortSignal.timeout(60_000),
    },
  });

  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find(p => "inlineData" in p && p.inlineData) as { inlineData?: { mimeType: string; data: string } } | undefined;

  if (!imagePart?.inlineData) {
    const textPart = parts.find(p => "text" in p && p.text) as { text?: string } | undefined;
    throw new Error(textPart?.text ?? "Image generation failed - no image in response");
  }

  return {
    imageBase64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || "image/png",
  };
}
