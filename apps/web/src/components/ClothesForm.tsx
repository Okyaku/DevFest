"use client";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { categories, categoryLabels, colorLabels, lengthLabels, sceneLabels, seasonLabels, subCategoryLabels, subCategoryParents, type AnalyzeItemResult, type ClothesInput } from "@ai-closet/shared";
import { apiFetch, DEMO_MODE, uploadImage } from "@/lib/api";

type Form = Partial<Omit<ClothesInput, "ai">>;
type Phase = "idle" | "uploading" | "analyzing" | "ready" | "saving";

const warningMessages: Record<AnalyzeItemResult["warnings"][number], string> = {
  multiple_garments: "写真に複数の服が写っています。登録したい服だけが写るように撮ると精度が上がります。",
  poor_image: "服全体が入る、背景が少ない写真を選ぶと精度が上がります。",
};
const demoAnalysis: AnalyzeItemResult = {
  category: "tops", subCategory: "t-shirt", color: "black", sleeveLength: "short", hemLength: null, season: ["spring", "summer"], scene: "casual",
  description: "黒の半袖Tシャツ", confidence: { category: 0.98, subCategory: 0.62, color: 0.97, sleeveLength: 0.92 }, needsReview: true, reviewFields: ["subCategory"], warnings: [],
};

export function ClothesForm({ close, onSaved }: { close: () => void; onSaved?: () => void }) {
  const [data, setData] = useState<Form>({ category: "tops", color: "white", season: [] });
  const [phase, setPhase] = useState<Phase>("idle");
  const [photoUrl, setPhotoUrl] = useState("");
  const [imageKey, setImageKey] = useState<string>();
  const [ai, setAi] = useState<{ result: AnalyzeItemResult; version: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  const applyAnalysis = (r: AnalyzeItemResult) => setData(prev => ({
    ...prev, category: r.category, color: r.color, subCategory: r.subCategory ?? undefined,
    sleeveLength: r.sleeveLength ?? undefined, hemLength: r.hemLength ?? undefined, season: r.season, scene: r.scene ?? undefined,
    name: prev.name || (r.description ?? undefined),
  }));

  const pickPhoto = async (file?: File) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("JPEG / PNG / WebP の画像を選んでください。"); return; }
    setError(""); setAi(null); setPhotoUrl(URL.createObjectURL(file));
    try {
      if (DEMO_MODE) { setPhase("analyzing"); await new Promise(r => setTimeout(r, 800)); setAi({ result: demoAnalysis, version: "demo" }); applyAnalysis(demoAnalysis); }
      else {
        setPhase("uploading");
        const key = await uploadImage("items", file);
        setImageKey(key); setPhase("analyzing");
        const r = await apiFetch("/api/analyze-item", { method: "POST", body: JSON.stringify({ imageKey: key }) });
        if (r.ok) { setAi({ result: r.analysis, version: r.analysisVersion }); applyAnalysis(r.analysis); }
        else setError("AI で属性を推定できませんでした。手動で入力してください。");
      }
    } catch { setError("写真のアップロードに失敗しました。もう一度お試しください。"); }
    setPhase("ready");
  };

  const save = async () => {
    if (!data.category || !data.color) return;
    setError(""); setPhase("saving");
    try {
      if (!DEMO_MODE) {
        const body: ClothesInput = { ...data, category: data.category, color: data.color, season: data.season ?? [], imageKey,
          ai: ai ? { tags: { category: ai.result.category, subCategory: ai.result.subCategory, color: ai.result.color, sleeveLength: ai.result.sleeveLength, hemLength: ai.result.hemLength, season: ai.result.season, scene: ai.result.scene }, confidence: ai.result.confidence, analysisVersion: ai.version } : undefined };
        const r = await apiFetch("/api/clothes", { method: "POST", body: JSON.stringify(body) });
        if (!r.ok) throw new Error(r.error);
      }
      onSaved?.(); close();
    } catch { setError("保存に失敗しました。入力内容を確認してもう一度お試しください。"); setPhase("ready"); }
  };

  const review = new Set(ai?.result.reviewFields ?? []);
  const cls = (field: string) => (review.has(field) ? "needs-review" : undefined);
  const cat = data.category ?? "tops";
  const subs = Object.entries(subCategoryParents).filter(([, parents]) => parents.includes(cat)).map(([k]) => k as keyof typeof subCategoryLabels);
  const busy = phase === "uploading" || phase === "analyzing" || phase === "saving";
  const showSleeve = cat === "tops" || cat === "outer" || cat === "dress", showHem = cat === "bottoms" || cat === "dress";

  return <div className="modal"><section className="clothes-form">
    <button className="close" onClick={close}>×</button>
    <p className="eyebrow">NEW ITEM</p><h2>服を登録</h2>
    <label className="upload">{photoUrl ? <img src={photoUrl} alt="服の写真" /> : <>＋<span>写真を追加</span></>}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = ""; }} /></label>
    {(phase === "uploading" || phase === "analyzing") && <div className="ai-note"><div className="spinner small" />{phase === "uploading" ? "写真をアップロードしています…" : "AI が服の特徴を推定しています…"}</div>}
    {ai && phase !== "analyzing" && <div className="ai-note"><Sparkles size={15} /><span>AI が推定しました。{review.size ? "色付きの項目は特に確認してください。" : "内容を確認して保存してください。"}</span></div>}
    {ai?.result.warnings.map(w => <p key={w} className="ai-warning">{warningMessages[w]}</p>)}
    <div className={phase === "analyzing" ? "form-fields skeleton" : "form-fields"}>
      <label>名前<input value={data.name ?? ""} maxLength={80} onChange={e => setData({ ...data, name: e.target.value || undefined })} placeholder="例: 黒の半袖Tシャツ" /></label>
      <label className={cls("category")}>カテゴリ<select value={cat} onChange={e => { const c = e.target.value as Form["category"] & string; setData({ ...data, category: c, subCategory: data.subCategory && (subCategoryParents[data.subCategory] as readonly string[]).includes(c) ? data.subCategory : undefined }); }}>{categories.map(k => <option key={k} value={k}>{categoryLabels[k]}</option>)}</select></label>
      <label className={cls("subCategory")}>種類<select value={data.subCategory ?? ""} onChange={e => setData({ ...data, subCategory: (e.target.value || undefined) as Form["subCategory"] })}><option value="">未選択</option>{subs.map(k => <option key={k} value={k}>{subCategoryLabels[k]}</option>)}</select></label>
      <label className={cls("color")}>色<select value={data.color} onChange={e => setData({ ...data, color: e.target.value as Form["color"] })}>{Object.entries(colorLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {showSleeve && <label className={cls("sleeveLength")}>袖丈<select value={data.sleeveLength ?? ""} onChange={e => setData({ ...data, sleeveLength: (e.target.value || undefined) as Form["sleeveLength"] })}><option value="">未選択</option>{Object.entries(lengthLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
      {showHem && <label className={cls("hemLength")}>着丈<select value={data.hemLength ?? ""} onChange={e => setData({ ...data, hemLength: (e.target.value || undefined) as Form["hemLength"] })}><option value="">未選択</option>{Object.entries(lengthLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
      <div className="field">季節<div className="chips">{Object.entries(seasonLabels).map(([k, v]) => { const on = data.season?.includes(k as never); return <button type="button" key={k} className={on ? "on" : ""} onClick={() => setData({ ...data, season: on ? data.season!.filter(s => s !== k) : [...(data.season ?? []), k as never] })}>{v}</button>; })}</div></div>
      <label>シーン<select value={data.scene ?? ""} onChange={e => setData({ ...data, scene: (e.target.value || undefined) as Form["scene"] })}><option value="">未選択</option>{Object.entries(sceneLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    </div>
    {error && <p className="auth-error">{error}</p>}
    <button className="save" onClick={save} disabled={busy}>{phase === "saving" ? "保存中…" : "クローゼットに追加"}</button>
  </section></div>;
}
