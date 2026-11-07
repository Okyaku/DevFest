import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");

function waitForUser(): Promise<User> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, u => { unsub(); u ? resolve(u) : reject(new Error("Not authenticated")); });
  });
}

export async function apiFetch(path: string, opts: RequestInit = {}) {
  const user = await waitForUser();
  const token = await user.getIdToken();
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  return res.json();
}
