"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, RefreshCw, SwitchCamera, X } from "lucide-react";
import { categoryLabels, colorLabels, subCategoryLabels, type OutfitSlot } from "@ai-closet/shared";
import { apiFetch, DEMO_MODE, localDate, uploadImage } from "@/lib/api";
import { demoItems } from "@/lib/demo";

type Step = "camera" | "preview" | "analyzing" | "select" | "saving" | "done";
type ClosetItem = { clothesId: string; name?: string | null; category: keyof typeof categoryLabels; color: keyof typeof colorLabels; imageUrl?: string | null };
type CameraError = "unsupported" | "insecure" | "denied" | "notfound" | "unknown";

const MAX_EDGE = 1280;
const cameraErrorMessages: Record<CameraError, string> = {
  unsupported: "このブラウザはカメラに対応していません。下のボタンから写真を選んでください。",
  insecure: "カメラは HTTPS（または localhost）でのみ利用できます。写真を選んで記録してください。",
  denied: "カメラへのアクセスが拒否されました。ブラウザの設定でカメラを許可するか、写真を選んでください。",
  notfound: "利用できるカメラが見つかりませんでした。写真を選んで記録してください。",
  unknown: "カメラを起動できませんでした。写真を選んで記録してください。",
};

/** 画像ソースを長辺 MAX_EDGE に縮小した JPEG に変換する */
function toJpeg(source: CanvasImageSource, w: number, h: number): Promise<Blob> {
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.85));
}

type Pick = { clothesId: string; score?: number; rank?: number; reasons?: string[] };
type Analysis = { analysisVersion?: string; slots: OutfitSlot[] };
type AnalysisError = "image_not_usable" | "analysis_failed" | null;
const MANUAL = "manual";
/** これ以上のスコアのトップ候補だけを初期選択にする。確定はユーザーが行う */
const PRESELECT_MIN_SCORE = 60;

const statusNotes: Partial<Record<OutfitSlot["status"], string>> = {
  low_confidence: "写りがはっきりしません。候補が違う場合は手動で選んでください。",
  no_candidates: "クローゼットに近い服が見つかりませんでした。",
};

function detectedSummary(d: OutfitSlot["detected"]) {
  return [d.color && colorLabels[d.color], d.subCategory && subCategoryLabels[d.subCategory]].filter(Boolean).join(" · ");
}

/** デモモード用の解析結果（デモの服 3 着から候補を作る） */
function demoAnalysis(items: ClosetItem[]): Analysis {
  const scores = [92, 85, 58];
  return {
    analysisVersion: "demo",
    slots: items.map((item, i) => ({
      slotId: `${item.category}:0`,
      detected: { category: item.category, subCategory: null, color: item.color, sleeveLength: null, hemLength: null, confidence: i === 2 ? 0.5 : 0.9 },
      candidates: [{ clothesId: item.clothesId, score: scores[i] ?? 50, reasons: [`${colorLabels[item.color]}が一致`], name: item.name ?? null, category: item.category, color: item.color, subCategory: null, imageKey: null, imageUrl: item.imageUrl ?? null }],
      status: i === 2 ? "low_confidence" : "candidates_found",
    })),
  };
}

export function OutfitLogFlow({ close, onRegister }: { close: () => void; onRegister: () => void }) {
  const [step, setStep] = useState<Step>("camera");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [selfieKey, setSelfieKey] = useState<string | undefined>();
  const [closet, setCloset] = useState<ClosetItem[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisError, setAnalysisError] = useState<AnalysisError>(null);
  const [picks, setPicks] = useState<Record<string, Pick | null>>({});
  const [manualPicks, setManualPicks] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!photo) { setPhotoUrl(""); return; }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const applyAnalysis = (a: Analysis) => {
    setAnalysis(a); setAnalysisError(null);
    const taken = new Set<string>(), initial: Record<string, Pick | null> = {};
    for (const s of a.slots) {
      const top = s.candidates[0];
      initial[s.slotId] = s.status === "candidates_found" && top && top.score >= PRESELECT_MIN_SCORE && !taken.has(top.clothesId)
        ? (taken.add(top.clothesId), { clothesId: top.clothesId, score: top.score, rank: 1, reasons: top.reasons }) : null;
    }
    setPicks(initial);
  };

  const analyze = async (key: string) => {
    try {
      const r = await apiFetch("/api/analyze-outfit", { method: "POST", body: JSON.stringify({ selfieKey: key, topK: 5, date: localDate() }) });
      if (r.ok) applyAnalysis(r);
      else { setAnalysis(null); setAnalysisError(r.error === "image_not_usable" ? "image_not_usable" : "analysis_failed"); }
    } catch { setAnalysis(null); setAnalysisError("analysis_failed"); }
  };

  const usePhoto = async () => {
    if (!photo) return;
    setError(""); setStep("analyzing");
    try {
      if (DEMO_MODE) {
        await new Promise(r => setTimeout(r, 800));
        const items = demoItems.map(i => ({ clothesId: i.id, name: i.name, category: i.category, color: i.color, imageUrl: i.image }));
        setCloset(items); setSelfieKey(undefined); applyAnalysis(demoAnalysis(items));
      } else {
        const key = await uploadImage("selfies", photo);
        setSelfieKey(key);
        const [clothes] = await Promise.all([apiFetch("/api/clothes"), analyze(key)]);
        if (!clothes.ok) throw new Error(clothes.error);
        setCloset(clothes.items);
      }
      setManualPicks([]);
      setStep("select");
    } catch {
      setError("写真のアップロードに失敗しました。通信状況を確認してもう一度お試しください。");
      setStep("preview");
    }
  };

  const reanalyze = async () => {
    if (!selfieKey) return;
    setStep("analyzing"); await analyze(selfieKey); setStep("select");
  };

  const chosenIds = [...Object.values(picks).flatMap(p => (p ? [p.clothesId] : [])), ...manualPicks];
  const takenBy = (clothesId: string, exceptSlot: string) =>
    Object.entries(picks).some(([slot, p]) => slot !== exceptSlot && p?.clothesId === clothesId) || (exceptSlot !== MANUAL && manualPicks.includes(clothesId));

  const save = async () => {
    setError(""); setStep("saving");
    try {
      if (DEMO_MODE) await new Promise(r => setTimeout(r, 600));
      else {
        const items = [
          ...Object.entries(picks).flatMap(([slot, p]) => (p ? [{ ...p, slot }] : [])),
          ...manualPicks.map(clothesId => ({ clothesId, slot: MANUAL })),
        ];
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const r = await apiFetch("/api/logs", { method: "POST", body: JSON.stringify({ date: localDate(), timezone, selfieKey, analysisVersion: analysis?.analysisVersion, clothesIds: items.map(i => i.clothesId), items }) });
        if (!r.ok) throw new Error(r.error);
      }
      setStep("done");
    } catch {
      setError("記録の保存に失敗しました。もう一度お試しください。");
      setStep("select");
    }
  };

  return <div className="outfit-flow">
    <button className="flow-close" onClick={close} aria-label="閉じる"><X size={20} /></button>
    {step === "camera" && <CameraView onCapture={b => { setPhoto(b); setStep("preview"); }} />}
    {step === "preview" && <section className="flow-preview">
      <img src={photoUrl} alt="撮影した写真" />
      {error && <p className="flow-error">{error}</p>}
      <div className="flow-actions">
        <button className="ghost" onClick={() => { setPhoto(null); setStep("camera"); }}><RefreshCw size={16} />撮り直す</button>
        <button className="save" onClick={usePhoto}>この写真を使う</button>
      </div>
    </section>}
    {step === "analyzing" && <section className="flow-center"><div className="spinner" /><p>写真から服を探しています…</p></section>}
    {(step === "select" || step === "saving") && <section className="flow-select">
      <div className="flow-select-head">
        {photoUrl && <img src={photoUrl} alt="今日の写真" />}
        <div><p className="eyebrow">TODAY · {localDate()}</p><h2>今日着ている服</h2><p className="muted">AI の候補は仮の選択です。違っていたら変更してください。</p></div>
      </div>
      {analysisError && <div className="flow-banner">
        <p>{analysisError === "image_not_usable" ? "写真から服を見つけられませんでした。服全体が明るく写るように撮り直すか、手動で選んでください。" : "解析に失敗しました。もう一度解析するか、手動で選んでください。"}</p>
        <div><button onClick={() => { setPhoto(null); setStep("camera"); }}>撮り直す</button>{analysisError === "analysis_failed" && <button onClick={reanalyze}>再解析</button>}</div>
      </div>}
      {closet.length === 0 && <div className="flow-banner"><p>クローゼットに服がまだありません。写真だけ保存するか、服を登録してください。</p><div><button onClick={onRegister}>服を登録する</button></div></div>}
      {analysis?.slots.map(slot => <SlotSection key={slot.slotId} slot={slot} closet={closet} pick={picks[slot.slotId] ?? null}
        isTaken={id => takenBy(id, slot.slotId)} onPick={p => setPicks(prev => ({ ...prev, [slot.slotId]: p }))} onRegister={onRegister} />)}
      {closet.length > 0 && <ManualSection closet={closet} picked={manualPicks} isTaken={id => takenBy(id, MANUAL)} open={!analysis}
        toggle={id => setManualPicks(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))} />}
      {error && <p className="flow-error">{error}</p>}
      <div className="flow-footer"><button className="save" disabled={step === "saving"} onClick={save}>{step === "saving" ? "保存中…" : chosenIds.length ? `${chosenIds.length}着を記録する` : "写真だけ保存する"}</button></div>
    </section>}
    {step === "done" && <section className="flow-center"><div className="done-mark"><Check size={30} /></div><h2>今日の服を記録しました</h2><button className="save" onClick={close}>ホームに戻る</button></section>}
  </div>;
}

function ItemCard({ item, on, disabled, badge, onClick }: { item: { name?: string | null; category: ClosetItem["category"]; color: ClosetItem["color"]; imageUrl?: string | null }; on: boolean; disabled?: boolean; badge?: string; onClick: () => void }) {
  return <button className={on ? "pick on" : "pick"} onClick={onClick} disabled={disabled} aria-pressed={on}>
    {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span className="pick-ph">{categoryLabels[item.category]}</span>}
    {badge && <em>{badge}</em>}
    {on && <i><Check size={14} /></i>}
    <p>{item.name || `${colorLabels[item.color]}の${categoryLabels[item.category]}`}</p>
    <small>{disabled ? "他の枠で選択中" : `${categoryLabels[item.category]} · ${colorLabels[item.color]}`}</small>
  </button>;
}

function SlotSection({ slot, closet, pick, isTaken, onPick, onRegister }: { slot: OutfitSlot; closet: ClosetItem[]; pick: Pick | null; isTaken: (id: string) => boolean; onPick: (p: Pick | null) => void; onRegister: () => void }) {
  const [browse, setBrowse] = useState(false);
  const shown = slot.candidates.slice(0, 3);
  const others = closet.filter(i => i.category === slot.detected.category && !shown.some(c => c.clothesId === i.clothesId)).slice(0, 20);
  const select = (p: Pick) => onPick(pick?.clothesId === p.clothesId ? null : p);
  const summary = detectedSummary(slot.detected);
  return <section className="slot">
    <div className="slot-head"><h3>{categoryLabels[slot.detected.category]}</h3>{summary && <span>{summary}</span>}</div>
    {statusNotes[slot.status] && <p className="slot-note">{statusNotes[slot.status]}</p>}
    {shown.length > 0 && <div className="slot-row">{shown.map((c, i) =>
      <div key={c.clothesId} className="slot-cand">
        <ItemCard item={c} on={pick?.clothesId === c.clothesId} disabled={isTaken(c.clothesId)} badge={`${c.score}%`} onClick={() => select({ clothesId: c.clothesId, score: c.score, rank: i + 1, reasons: c.reasons })} />
        {c.reasons.length > 0 && <p className="reasons">{c.reasons.slice(0, 2).join("・")}</p>}
      </div>)}</div>}
    {browse && <div className="slot-row wrap">{others.length ? others.map(i =>
      <ItemCard key={i.clothesId} item={i} on={pick?.clothesId === i.clothesId} disabled={isTaken(i.clothesId)} onClick={() => {
        const rank = slot.candidates.findIndex(c => c.clothesId === i.clothesId);
        const c = slot.candidates[rank];
        select(c ? { clothesId: i.clothesId, score: c.score, rank: rank + 1, reasons: c.reasons } : { clothesId: i.clothesId });
      }} />) : <p className="muted">同じカテゴリの服は他にありません。</p>}</div>}
    <div className="slot-actions">
      {others.length > 0 && <button onClick={() => setBrowse(!browse)}>{browse ? "閉じる" : "他の服を探す"}</button>}
      <button onClick={onRegister}>この服を新規登録</button>
      <button className={pick ? "" : "on"} onClick={() => onPick(null)}>{pick ? "今回は記録しない" : "記録しない"}</button>
    </div>
  </section>;
}

function ManualSection({ closet, picked, isTaken, toggle, open }: { closet: ClosetItem[]; picked: string[]; isTaken: (id: string) => boolean; toggle: (id: string) => void; open: boolean }) {
  const [expanded, setExpanded] = useState(open);
  const [category, setCategory] = useState<ClosetItem["category"] | "all">("all");
  const list = closet.filter(i => category === "all" || i.category === category);
  return <section className="slot">
    <div className="slot-head"><h3>{open ? "クローゼットから選ぶ" : "写っていない服を追加"}</h3>{picked.length > 0 && <span>{picked.length}着選択中</span>}</div>
    {!expanded ? <div className="slot-actions"><button onClick={() => setExpanded(true)}>クローゼットから手動で選ぶ</button></div> : <>
      <div className="chips">{(["all", ...Object.keys(categoryLabels)] as const).map(c =>
        <button key={c} className={category === c ? "on" : ""} onClick={() => setCategory(c as typeof category)}>{c === "all" ? "すべて" : categoryLabels[c as ClosetItem["category"]]}</button>)}</div>
      <div className="slot-row wrap">{list.map(i => <ItemCard key={i.clothesId} item={i} on={picked.includes(i.clothesId)} disabled={isTaken(i.clothesId)} onClick={() => toggle(i.clothesId)} />)}</div>
    </>}
  </section>;
}

function CameraView({ onCapture }: { onCapture: (b: Blob) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [error, setError] = useState<CameraError | null>(null);
  const [ready, setReady] = useState(false);
  const [fileError, setFileError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    setReady(false);
    if (!window.isSecureContext) { setError("insecure"); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setError("unsupported"); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false })
      .then(s => {
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
        stream = s;
        const v = videoRef.current;
        if (v) { v.srcObject = s; v.play().catch(() => {}); }
        setError(null);
      })
      .catch((e: DOMException) => {
        if (cancelled) return;
        setError(e.name === "NotAllowedError" || e.name === "SecurityError" ? "denied" : e.name === "NotFoundError" || e.name === "OverconstrainedError" ? "notfound" : "unknown");
      });
    return () => { cancelled = true; stream?.getTracks().forEach(t => t.stop()); };
  }, [facing]);

  const shoot = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    // プレビューは鏡像表示だが、保存画像は実際の向き（文字などが反転しない）にする
    onCapture(await toJpeg(v, v.videoWidth, v.videoHeight));
  };

  const pickFile = async (file?: File) => {
    setFileError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) { setFileError("画像ファイルを選んでください。"); return; }
    try {
      const bmp = await createImageBitmap(file);
      onCapture(await toJpeg(bmp, bmp.width, bmp.height));
      bmp.close();
    } catch { setFileError("この画像は読み込めませんでした。JPEG / PNG / WebP の画像を選んでください。"); }
  };

  return <section className="camera">
    <div className="camera-stage">
      {error
        ? <p className="camera-msg">{cameraErrorMessages[error]}</p>
        : <>
            <video ref={videoRef} playsInline muted onLoadedData={() => setReady(true)} className={facing === "user" ? "mirror" : ""} />
            {!ready && <p className="camera-msg">カメラを起動しています…</p>}
            <div className="camera-guide">全身が枠に入るように撮影してください</div>
          </>}
    </div>
    {fileError && <p className="flow-error">{fileError}</p>}
    <div className="camera-bar">
      <label className="cam-side" aria-label="写真を選ぶ"><ImagePlus size={22} /><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { pickFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
      <button className="shutter" onClick={shoot} disabled={!!error || !ready} aria-label="撮影" />
      <button className="cam-side" onClick={() => setFacing(f => (f === "user" ? "environment" : "user"))} disabled={!!error} aria-label="カメラを切り替え"><SwitchCamera size={22} /></button>
    </div>
  </section>;
}
