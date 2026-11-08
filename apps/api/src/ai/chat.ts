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

export type ChatMessage = { role: "user" | "model"; text: string };

export type ClosetContext = {
  clothes: { category: string; subCategory: string | null; color: string; season: string[]; name: string | null }[];
  recentOutfits: { date: string; items: string[] }[];
  profile: { age?: number | null; prefecture?: string | null };
};

function buildSystemPrompt(ctx: ClosetContext): string {
  const clothesList = ctx.clothes.map(c =>
    `${c.name ?? "名前なし"} (${c.category}/${c.subCategory ?? "?"}, ${c.color}, 季節:${c.season.join(",")})`
  ).join("\n- ");

  const outfitList = ctx.recentOutfits.slice(0, 5).map(o =>
    `${o.date}: ${o.items.join(", ")}`
  ).join("\n- ");

  return `あなたは「AI Closet」アプリのファッションアドバイザーです。
ユーザーのクローゼットの中身と着用履歴を知っています。フレンドリーかつ的確にファッションの相談に乗ってください。

## ユーザー情報
${ctx.profile.age ? `年齢: ${ctx.profile.age}歳` : ""}
${ctx.profile.prefecture ? `地域: ${ctx.profile.prefecture}` : ""}

## クローゼットの中身 (${ctx.clothes.length}着)
- ${clothesList || "まだ登録がありません"}

## 最近の着用履歴
- ${outfitList || "まだ記録がありません"}

## ルール
- ユーザーのクローゼットにある服を使ってアドバイスしてください
- クローゼットにない服を勧める場合は「購入を検討」と明記してください
- 返答は簡潔に（200文字以内を目安）
- ファッション以外の話題は丁寧に断ってください`;
}

export async function chat(
  messages: ChatMessage[],
  ctx: ClosetContext,
): Promise<string> {
  if (AI_MOCK) return "こんにちは！今日はどんなコーデにしましょうか？クローゼットの中から提案しますよ。";

  const systemPrompt = buildSystemPrompt(ctx);

  const rawContents = [
    { role: "user" as const, parts: [{ text: systemPrompt }] },
    { role: "model" as const, parts: [{ text: "はい、承知しました。ファッションアドバイザーとしてお手伝いします。" }] },
    ...messages.map(m => ({ role: m.role as "user" | "model", parts: [{ text: m.text }] })),
  ];

  const allContents: typeof rawContents = [];
  for (const c of rawContents) {
    const last = allContents[allContents.length - 1];
    if (last && last.role === c.role) {
      last.parts.push(...c.parts);
    } else {
      allContents.push({ ...c, parts: [...c.parts] });
    }
  }

  const res = await getClient().models.generateContent({
    model: MODEL,
    contents: allContents,
    config: {
      temperature: 0.8,
      maxOutputTokens: 500,
      abortSignal: AbortSignal.timeout(30_000),
    },
  });

  return res.text ?? "すみません、うまく回答できませんでした。もう一度お試しください。";
}
