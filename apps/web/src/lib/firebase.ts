import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const hasFirebaseConfig = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);

if (!hasFirebaseConfig && !DEMO_MODE) {
  console.warn("Firebase config is incomplete. Set NEXT_PUBLIC_FIREBASE_* values.");
}

export const firebaseApp = hasFirebaseConfig
  ? (getApps().length ? getApp() : initializeApp(config))
  : null;
export const auth: Auth | null = firebaseApp ? getAuth(firebaseApp) : null;
