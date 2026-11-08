import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

function waitForUser(): Promise<User> {
  if (!auth) return Promise.reject(new Error("Firebase auth is not configured"));
  const a = auth;
  if (a.currentUser) return Promise.resolve(a.currentUser);
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(a, u => { unsub(); u ? resolve(u) : reject(new Error("Not authenticated")); });
  });
}

export async function apiFetch(path: string, opts: RequestInit = {}) {
  if (DEMO_MODE || !auth) return { ok: false, error: "demo mode" };
  const user = await waitForUser();
  const token = await user.getIdToken();
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  return res.json();
}

/** 署名 URL を取得して画像を Cloud Storage に直接アップロードし、ストレージキーを返す */
export async function uploadImage(kind: "items" | "selfies" | "profile", blob: Blob): Promise<string> {
  const contentType = blob.type || "image/jpeg";
  const r = await apiFetch("/api/uploads", { method: "POST", body: JSON.stringify({ kind, contentType, size: blob.size }) });
  if (!r.ok) throw new Error(r.error ?? "upload url request failed");
  const put = await fetch(r.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
  if (!put.ok) throw new Error(`upload failed: ${put.status}`);
  return r.key as string;
}

/** 利用者のローカル日付を YYYY-MM-DD で返す */
export function localDate(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
