"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, RefreshCw, SwitchCamera, X } from "lucide-react";
import { categoryLabels, colorLabels } from "@ai-closet/shared";
import { apiFetch, DEMO_MODE, localDate, uploadImage } from "@/lib/api";
import { demoItems } from "@/lib/demo";

type Step = "camera" | "preview" | "analyzing" | "select" | "saving" | "done";
type ClosetItem = { clothesId: string; name?: string | null; category: keyof typeof categoryLabels; color: keyof typeof colorLabels; image?: string };
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

export function OutfitLogFlow({ close, onRegister }: { close: () => void; onRegister: () => void }) {
  const [step, setStep] = useState<Step>("camera");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [selfieKey, setSelfieKey] = useState<string | undefined>();
  const [closet, setCloset] = useState<ClosetItem[]>([]);
  const [suggested, setSuggested] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    if (!photo) { setPhotoUrl(""); return; }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const usePhoto = async () => {
    if (!photo) return;
    setError(""); setStep("analyzing");
    try {
      let key: string | undefined;
      let items: ClosetItem[];
      let candidateIds: string[] = [];
      if (DEMO_MODE) {
        await new Promise(r => setTimeout(r, 800));
        items = demoItems.map(i => ({ clothesId: i.id, name: i.name, category: i.category, color: i.color, image: i.image }));
      } else {
        key = await uploadImage("selfies", photo);
        const [clothes, analysis] = await Promise.all([
          apiFetch("/api/clothes"),
          apiFetch("/api/analyze", { method: "POST", body: JSON.stringify({ selfieKey: key, topK: 3 }) }).catch(() => null),
        ]);
        if (!clothes.ok) throw new Error(clothes.error);
        items = clothes.items;
        // AI 候補は「各検出服のトップ候補」を初期選択にする。確定はユーザーが行う。
        for (const r of analysis?.ok ? analysis.results ?? [] : []) {
          if (!r.needsRegister && r.candidates?.[0]) candidateIds.push(r.candidates[0].clothesId);
        }
        candidateIds = candidateIds.filter(id => items.some(i => i.clothesId === id));
      }
      setSelfieKey(key);
      setCloset(items);
      setSuggested(new Set(candidateIds));
      setSelected(new Set(candidateIds));
      setStep("select");
    } catch {
      setError("写真のアップロードに失敗しました。通信状況を確認してもう一度お試しください。");
      setStep("preview");
    }
  };

  const save = async () => {
    setError(""); setStep("saving");
    try {
      if (DEMO_MODE) await new Promise(r => setTimeout(r, 600));
      else {
        const r = await apiFetch("/api/logs", { method: "POST", body: JSON.stringify({ date: localDate(), selfieKey, clothesIds: [...selected] }) });
        if (!r.ok) throw new Error(r.error);
      }
      setStep("done");
    } catch {
      setError("記録の保存に失敗しました。もう一度お試しください。");
      setStep("select");
    }
  };

  const toggle = (id: string) => setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

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
    {step === "analyzing" && <section className="flow-center"><div className="spinner" /><p>写真を解析しています…</p></section>}
    {(step === "select" || step === "saving") && <section className="flow-select">
      <div className="flow-select-head">
        {photoUrl && <img src={photoUrl} alt="今日の写真" />}
        <div><p className="eyebrow">TODAY · {localDate()}</p><h2>今日着ている服を選ぶ</h2><p className="muted">{suggested.size ? "AI の候補を選択済みです。違っていたら変更してください。" : "クローゼットから今日着ている服を選んでください。"}</p></div>
      </div>
      {closet.length === 0
        ? <div className="flow-empty"><p>クローゼットに服がまだありません。</p><button className="save" onClick={onRegister}>服を登録する</button></div>
        : <div className="flow-grid">{closet.map(item => {
            const on = selected.has(item.clothesId);
            return <button key={item.clothesId} className={on ? "pick on" : "pick"} onClick={() => toggle(item.clothesId)} aria-pressed={on}>
              {item.image ? <img src={item.image} alt="" /> : <span className="pick-ph">{categoryLabels[item.category]}</span>}
              {suggested.has(item.clothesId) && <em>AI候補</em>}
              {on && <i><Check size={14} /></i>}
              <p>{item.name || `${colorLabels[item.color]}の${categoryLabels[item.category]}`}</p>
              <small>{categoryLabels[item.category]} · {colorLabels[item.color]}</small>
            </button>;
          })}</div>}
      {error && <p className="flow-error">{error}</p>}
      <div className="flow-footer"><button className="save" disabled={selected.size === 0 || step === "saving"} onClick={save}>{step === "saving" ? "保存中…" : `${selected.size}着を記録する`}</button></div>
    </section>}
    {step === "done" && <section className="flow-center"><div className="done-mark"><Check size={30} /></div><h2>今日の服を記録しました</h2><button className="save" onClick={close}>ホームに戻る</button></section>}
  </div>;
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
