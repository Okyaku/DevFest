import { GoogleGenAI } from "@google/genai";
import type { z } from "zod";

/** モデル名は将来変わるため環境変数で差し替える */
export const MODEL = process.env.VERTEX_AI_MODEL ?? "gemini-2.5-flash";
export const AI_MOCK = process.env.AI_MOCK === "true";
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

export class AiError extends Error {
  constructor(public readonly reason: "timeout" | "invalid_output" | "model_error") { super(reason); }
}

export type ImageInput = { data: Buffer; mimeType: string };

/**
 * 画像 + 指示を渡し、JSON Schema による構造化出力を得て Zod で再検証する。
 * タイムアウト・不正出力のときは一回だけリトライする。生の画像やモデル応答はログに出さない。
 */
export async function generateStructured<T>(prompt: string, image: ImageInput, jsonSchema: object, validator: z.ZodType<T>): Promise<T> {
  let last: AiError = new AiError("model_error");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await getClient().models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.data.toString("base64") } }] }],
        config: { responseMimeType: "application/json", responseJsonSchema: jsonSchema, temperature: 0, abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
      });
      let json: unknown;
      try { json = JSON.parse(res.text ?? ""); } catch { last = new AiError("invalid_output"); continue; }
      const parsed = validator.safeParse(json);
      if (parsed.success) return parsed.data;
      last = new AiError("invalid_output");
    } catch (e) {
      last = new AiError(e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "model_error");
    }
  }
  throw last;
}
