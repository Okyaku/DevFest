"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, Check, ImagePlus, SwitchCamera, X } from "lucide-react";
import { categoryLabels, colorLabels } from "@ai-closet/shared";
import { apiFetch, uploadImage } from "@/lib/api";

type ClothesItem = {
  clothesId: string; category: string; color: string;
  subCategory?: string | null; imageUrl?: string | null;
  name?: string | null;
};

type Step = "select-clothes" | "camera" | "generating" | "result";

const MAX_EDGE = 1280;
function toJpeg(source: CanvasImageSource, w: number, h: number): Promise<Blob> {
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.85));
}

export function VirtualTryOn({ clothes, onClose }: { clothes: ClothesItem[]; onClose: () => void }) {
  const [step, setStep] = useState<Step>("select-clothes");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [resultImage, setResultImage] = useState<string>("");
  const [error, setError] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [camReady, setCamReady] = useState(false);
  const [camError, setCamError] = useState(false);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else if (next.size < 5) next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (step !== "camera") return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    setCamReady(false);
    setCamError(false);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setCamError(true); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false })
      .then(s => {
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
        stream = s;
        const v = videoRef.current;
        if (v) { v.srcObject = s; v.play().catch(() => {}); }
      })
      .catch(() => { if (!cancelled) setCamError(true); });
    return () => { cancelled = true; stream?.getTracks().forEach(t => t.stop()); };
  }, [step, facing]);

  const shoot = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const blob = await toJpeg(v, v.videoWidth, v.videoHeight);
    setPhoto(blob);
    generate(blob);
  };

  const pickFile = async (file?: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const bmp = await createImageBitmap(file);
      const blob = await toJpeg(bmp, bmp.width, bmp.height);
      bmp.close();
      setPhoto(blob);
      generate(blob);
    } catch { setError("この画像は読み込めませんでした。"); }
  };

  const generate = async (blob: Blob) => {
    setStep("generating");
    setError("");
    try {
      const bodyKey = await uploadImage("selfies", blob);
      const r = await apiFetch("/api/try-on", {
        method: "POST",
        body: JSON.stringify({ bodyKey, clothesIds: [...selected] }),
      });
      if (r.ok) {
        setResultImage(r.image);
        setStep("result");
      } else {
        setError(r.message ?? "画像生成に失敗しました。別の写真で試してみてください。");
        setStep("camera");
      }
    } catch {
      setError("通信エラーが発生しました。");
      setStep("camera");
    }
  };

  return (
    <div className="tryon-overlay">
      <button className="flow-close" onClick={onClose} aria-label="閉じる"><X size={20} /></button>

      {step === "select-clothes" && (
        <section className="tryon-select">
          <h2>着てみたい服を選んでください</h2>
          <p className="muted">最大5着まで選べます（{selected.size}/5）</p>
          <div className="tryon-grid">
            {clothes.map(item => (
              <button key={item.clothesId} className={`pick ${selected.has(item.clothesId) ? "on" : ""}`} onClick={() => toggle(item.clothesId)}>
                {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span className="pick-ph">{categoryLabels[item.category as keyof typeof categoryLabels]}</span>}
                {selected.has(item.clothesId) && <i><Check size={14} /></i>}
                <p>{item.name || `${colorLabels[item.color as keyof typeof colorLabels]}の${categoryLabels[item.category as keyof typeof categoryLabels]}`}</p>
              </button>
            ))}
          </div>
          <div className="tryon-footer">
            <button className="save" disabled={selected.size === 0} onClick={() => setStep("camera")}>
              {selected.size > 0 ? `${selected.size}着で試着する` : "服を選んでください"}
            </button>
          </div>
        </section>
      )}

      {step === "camera" && (
        <section className="camera">
          <div className="camera-stage">
            {camError
              ? <p className="camera-msg">カメラを使用できません。写真を選んでください。</p>
              : <>
                  <video ref={videoRef} playsInline muted onLoadedData={() => setCamReady(true)} className={facing === "user" ? "mirror" : ""} />
                  {!camReady && <p className="camera-msg">カメラを起動しています…</p>}
                  <div className="camera-guide">全身が写るように撮影してください</div>
                </>}
          </div>
          {error && <p className="flow-error">{error}</p>}
          <div className="camera-bar">
            <label className="cam-side" aria-label="写真を選ぶ"><ImagePlus size={22} /><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { pickFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
            <button className="shutter" onClick={shoot} disabled={camError || !camReady} aria-label="撮影" />
            <button className="cam-side" onClick={() => setFacing(f => f === "user" ? "environment" : "user")} disabled={camError} aria-label="カメラを切替"><SwitchCamera size={22} /></button>
          </div>
        </section>
      )}

      {step === "generating" && (
        <section className="flow-center">
          <div className="spinner" />
          <p>AIが着用イメージを生成しています…</p>
          <p className="muted">少し時間がかかることがあります</p>
        </section>
      )}

      {step === "result" && (
        <section className="tryon-result">
          {resultImage && <img src={resultImage} alt="バーチャル試着結果" className="tryon-image" />}
          <div className="tryon-result-actions">
            <button className="ghost" onClick={() => { setResultImage(""); setStep("select-clothes"); }}>別の服で試す</button>
            <button className="save" onClick={onClose}>閉じる</button>
          </div>
        </section>
      )}
    </div>
  );
}
