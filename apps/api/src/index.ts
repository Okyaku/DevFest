import { serve } from "@hono/node-server";
import { Storage } from "@google-cloud/storage";
import admin from "firebase-admin";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { analyzeInputSchema, analyzeItemInputSchema, analyzeOutfitInputSchema, clothesInputSchema, logInputSchema, profileInputSchema, uploadRequestSchema, type AnalyzeOutfitResult } from "@ai-closet/shared";
import { analyzeItem, ANALYSIS_VERSION, buildOutfitSlots, detectOutfit, ImageNotUsableError } from "./ai/analyze.js";
import type { ClosetRow } from "./ai/matching.js";
import { AiError } from "./ai/model.js";

const app = new Hono<{ Variables: { uid: string } }>();
const bucketName = process.env.GCS_BUCKET;
const storage = new Storage();
const db = new Pool({ connectionString: process.env.DATABASE_URL });
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
app.use("/*", cors({ origin: (origin) => (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000").split(",").includes(origin) ? origin : "", allowHeaders:["Authorization","Content-Type"], allowMethods:["GET","POST","PUT","DELETE"] }));
app.use("/api/*", async (c,next)=>{ const token=c.req.header("Authorization")?.replace("Bearer ",""); if(!token) return c.json({ok:false,error:"Unauthorized"},401); try { const decoded=await admin.auth().verifyIdToken(token); c.set("uid",decoded.uid); await next(); } catch { return c.json({ok:false,error:"Invalid authentication token"},401); } });
app.get("/health", c=>c.json({ok:true}));
async function ensureUser(uid: string) { await db.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [uid]); }
// ---- 画像キーの所有者検証・読み込み・署名 URL ----
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
function ownsKey(uid: string, key: string, kinds: ("items"|"selfies"|"profile")[]) {
  const m = /^users\/([^/]+)\/(items|selfies|profile)\/[0-9a-f-]{36}\.(jpeg|png|webp)$/.exec(key);
  return !!m && m[1] === uid && (kinds as string[]).includes(m[2]);
}
async function loadUserImage(key: string) {
  if (!bucketName) throw new Error("GCS_BUCKET is not configured");
  const file = storage.bucket(bucketName).file(key);
  const [meta] = await file.getMetadata();
  if (Number(meta.size) > MAX_IMAGE_BYTES) throw new Error("image too large");
  const [data] = await file.download();
  return { data, mimeType: `image/${key.split(".").pop()}` };
}
async function signRead(key: string | null): Promise<string | null> {
  if (!key || !bucketName) return null;
  try { const [url] = await storage.bucket(bucketName).file(key).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + 15 * 60_000 }); return url; } catch { return null; }
}
const today = () => new Date().toISOString().slice(0, 10);

async function loadCloset(uid: string, categories: string[]): Promise<ClosetRow[]> {
  const { rows } = await db.query(`SELECT c.id AS "clothesId", c.category, c.sub_category AS "subCategory", c.color, c.sleeve_length AS "sleeveLength", c.hem_length AS "hemLength", c.name, c.image_key AS "imageKey", to_char(w.last_worn,'YYYY-MM-DD') AS "lastWorn", to_char(c.created_at,'YYYY-MM-DD') AS "createdOn"
    FROM clothes c LEFT JOIN (SELECT wli.clothes_id, MAX(wl.local_date) AS last_worn FROM wear_log_items wli JOIN wear_logs wl ON wl.id=wli.wear_log_id WHERE wl.user_id=$1 GROUP BY wli.clothes_id) w ON w.clothes_id=c.id
    WHERE c.user_id=$1 AND c.deleted_at IS NULL AND c.category = ANY($2)`, [uid, categories]);
  return rows;
}

type OutfitResponse = { status: 200; body: { ok: true } & AnalyzeOutfitResult } | { status: 403 | 422 | 502; body: { ok: false; error: string; analysisVersion?: string } };
async function runOutfitAnalysis(uid: string, selfieKey: string, topK: number, date?: string): Promise<OutfitResponse> {
  if (!ownsKey(uid, selfieKey, ["selfies"])) return { status: 403, body: { ok: false, error: "Forbidden" } };
  const started = Date.now();
  let detected;
  try { detected = await detectOutfit(await loadUserImage(selfieKey)); }
  catch (e) {
    const reason = e instanceof ImageNotUsableError ? "image_not_usable" : e instanceof AiError ? e.reason : "load_failed";
    console.log(JSON.stringify({ event: "analyze_outfit", analysisVersion: ANALYSIS_VERSION, ms: Date.now() - started, failed: reason }));
    return e instanceof ImageNotUsableError ? { status: 422, body: { ok: false, error: "image_not_usable", analysisVersion: ANALYSIS_VERSION } } : { status: 502, body: { ok: false, error: "analysis_failed", analysisVersion: ANALYSIS_VERSION } };
  }
  const closet = await loadCloset(uid, [...new Set(detected.map(d => d.category))]);
  const slots = await Promise.all(buildOutfitSlots(detected, closet, topK, date ?? today()).map(async ({ ranked, ...slot }) => ({
    ...slot,
    candidates: await Promise.all(ranked.map(async r => ({ clothesId: r.item.clothesId, score: r.score, reasons: r.reasons, name: r.item.name, category: r.item.category, color: r.item.color, subCategory: r.item.subCategory, imageKey: r.item.imageKey, imageUrl: await signRead(r.item.imageKey) }))),
  })));
  const warnings = slots.some(s => s.status === "low_confidence") ? ["low_confidence_slots"] : [];
  console.log(JSON.stringify({ event: "analyze_outfit", analysisVersion: ANALYSIS_VERSION, ms: Date.now() - started, slots: slots.length }));
  return { status: 200, body: { ok: true, analysisVersion: ANALYSIS_VERSION, slots, warnings } };
}
app.get("/api/profile", async c=>{ const uid=c.get("uid"); await ensureUser(uid); const {rows:[row]}=await db.query("SELECT display_name AS \"displayName\", avatar_key AS \"avatarKey\", age, prefecture, district FROM users WHERE id=$1",[uid]); return c.json({ok:true,profile:row??{}}); });
app.put("/api/profile", async c=>{ const uid=c.get("uid"), input=profileInputSchema.parse(await c.req.json()); await ensureUser(uid); const {rows:[row]}=await db.query("UPDATE users SET display_name=COALESCE($2,display_name), avatar_key=COALESCE($3,avatar_key), age=$4, prefecture=COALESCE($5,prefecture), district=$6, updated_at=NOW() WHERE id=$1 RETURNING display_name AS \"displayName\", avatar_key AS \"avatarKey\", age, prefecture, district",[uid,input.displayName??null,input.avatarKey??null,input.age??null,input.prefecture??null,input.district??null]); return c.json({ok:true,profile:row}); });
app.post("/api/uploads", async c=>{ const input=uploadRequestSchema.parse(await c.req.json()); if(!bucketName) return c.json({ok:false,error:"GCS_BUCKET is not configured"},500); const key=`users/${c.get("uid")}/${input.kind}/${randomUUID()}.${input.contentType.split("/")[1]}`; const [url]=await storage.bucket(bucketName).file(key).getSignedUrl({version:"v4",action:"write",expires:Date.now()+10*60_000,contentType:input.contentType}); return c.json({ok:true,key,uploadUrl:url,expiresIn:600}); });
app.get("/api/clothes", async c=>{ const uid=c.get("uid"); const { rows }=await db.query("SELECT id AS \"clothesId\", category, sub_category AS \"subCategory\", color, sleeve_length AS \"sleeveLength\", hem_length AS \"hemLength\", seasons AS season, scene, image_key AS \"imageKey\", name, notes, created_at AS \"createdAt\" FROM clothes WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC",[uid]); const items=await Promise.all(rows.map(async r=>({...r,imageUrl:await signRead(r.imageKey)}))); return c.json({ok:true,items}); });
app.post("/api/clothes", async c=>{ const uid=c.get("uid"), item=clothesInputSchema.parse(await c.req.json()); if(item.imageKey && !ownsKey(uid,item.imageKey,["items"])) return c.json({ok:false,error:"Forbidden"},403); await ensureUser(uid); const {rows:[created]}=await db.query("INSERT INTO clothes (user_id,category,sub_category,color,sleeve_length,hem_length,seasons,scene,image_key,name,notes,category_color,ai_tags,ai_confidence,analysis_version,analyzed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CASE WHEN $13::jsonb IS NULL THEN NULL ELSE NOW() END) RETURNING id AS \"clothesId\", category, color, image_key AS \"imageKey\", name",[uid,item.category,item.subCategory??null,item.color,item.sleeveLength??null,item.hemLength??null,item.season,item.scene??null,item.imageKey??null,item.name??null,item.notes??null,`${item.category}#${item.color}`,item.ai?JSON.stringify(item.ai.tags):null,item.ai?JSON.stringify(item.ai.confidence):null,item.ai?.analysisVersion??null]); return c.json({ok:true,item:created},201); });
app.get("/api/clothes/:id", async c=>{ const {rows}=await db.query("SELECT id AS \"clothesId\", category, sub_category AS \"subCategory\", color, sleeve_length AS \"sleeveLength\", hem_length AS \"hemLength\", seasons AS season, scene, image_key AS \"imageKey\", name, notes FROM clothes WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",[c.req.param("id"),c.get("uid")]); return rows[0]?c.json({ok:true,item:rows[0]}):c.json({ok:false,error:"Not found"},404); });
app.delete("/api/clothes/:id", async c=>{ const result=await db.query("UPDATE clothes SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",[c.req.param("id"),c.get("uid")]); return result.rowCount?c.json({ok:true}):c.json({ok:false,error:"Not found"},404); });
app.get("/api/logs", async c=>{ const uid=c.get("uid"), from=c.req.query("from"),to=c.req.query("to"); if(!from||!to) return c.json({ok:false,error:"from and to are required"},400); const {rows}=await db.query("SELECT id AS \"logId\", local_date AS date, selfie_key AS \"selfieKey\", selections, created_at AS \"createdAt\", COALESCE(array_agg(wli.clothes_id) FILTER (WHERE wli.clothes_id IS NOT NULL),'{}') AS \"clothesIds\" FROM wear_logs wl LEFT JOIN wear_log_items wli ON wli.wear_log_id=wl.id WHERE wl.user_id=$1 AND wl.local_date BETWEEN $2 AND $3 GROUP BY wl.id ORDER BY wl.local_date DESC",[uid,from,to]); return c.json({ok:true,items:rows}); });
app.post("/api/logs", async c=>{
  const uid=c.get("uid"), input=logInputSchema.parse(await c.req.json());
  if(input.selfieKey && !ownsKey(uid,input.selfieKey,["selfies"])) return c.json({ok:false,error:"Forbidden"},403);
  const details=new Map((input.items??[]).map(i=>[i.clothesId,i]));
  const clothesIds=[...new Set([...input.clothesIds,...details.keys()])];
  await ensureUser(uid);
  const client=await db.connect();
  try {
    await client.query("BEGIN");
    const {rows:[log]}=await client.query("INSERT INTO wear_logs (user_id,local_date,selfie_key,selections,analysis_version,timezone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id AS \"logId\"",[uid,input.date,input.selfieKey??null,input.selections??null,input.analysisVersion??null,input.timezone??null]);
    for(const clothesId of clothesIds){ const d=details.get(clothesId); await client.query("INSERT INTO wear_log_items (wear_log_id,clothes_id,detected_slot,candidate_score,candidate_rank,candidate_reasons) SELECT $1,id,$4,$5,$6,$7 FROM clothes WHERE id=$2 AND user_id=$3 AND deleted_at IS NULL",[log.logId,clothesId,uid,d?.slot??null,d?.score??null,d?.rank??null,d?.reasons?JSON.stringify(d.reasons):null]); }
    await client.query("COMMIT");
    return c.json({ok:true,item:{...input,clothesIds,logId:log.logId}},201);
  } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
});
app.post("/api/analyze-item", async c=>{
  const uid=c.get("uid"), {imageKey}=analyzeItemInputSchema.parse(await c.req.json());
  if(!ownsKey(uid,imageKey,["items"])) return c.json({ok:false,error:"Forbidden"},403);
  const started=Date.now();
  try { const analysis=await analyzeItem(await loadUserImage(imageKey)); console.log(JSON.stringify({event:"analyze_item",analysisVersion:ANALYSIS_VERSION,ms:Date.now()-started})); return c.json({ok:true,analysisVersion:ANALYSIS_VERSION,analysis}); }
  catch(e) { console.log(JSON.stringify({event:"analyze_item",analysisVersion:ANALYSIS_VERSION,ms:Date.now()-started,failed:e instanceof AiError?e.reason:"load_failed"})); return c.json({ok:false,error:"analysis_failed",analysisVersion:ANALYSIS_VERSION},502); }
});
app.post("/api/analyze-outfit", async c=>{ const {selfieKey,topK,date}=analyzeOutfitInputSchema.parse(await c.req.json()); const r=await runOutfitAnalysis(c.get("uid"),selfieKey,topK,date); return c.json(r.body,r.status); });
/** 互換用。内部で analyze-outfit を呼び、旧形式 { results: [{ detected, candidates, bestScore, needsRegister }] } に変換する */
app.post("/api/analyze", async c=>{ const {selfieKey,topK}=analyzeInputSchema.parse(await c.req.json()); const r=await runOutfitAnalysis(c.get("uid"),selfieKey,topK); if(!r.body.ok) return c.json(r.body,r.status); return c.json({ok:true,results:r.body.slots.map(s=>({detected:s.detected,candidates:s.candidates,bestScore:s.candidates[0]?.score??0,needsRegister:s.status!=="candidates_found"}))}); });
app.onError((err,c)=>{ console.error(err); return c.json({ok:false,error:"Request could not be completed"},400); });
serve({fetch:app.fetch,port:Number(process.env.PORT??8080)});
