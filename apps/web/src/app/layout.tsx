import type { Metadata } from "next";
import "./styles.css";
export const metadata: Metadata = {
  title: "AI Closet",
  description: "今日の服を、未来の選択肢に。",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "AI Closet", statusBarStyle: "default" },
};

export const viewport = { themeColor: "#8068B8" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ja"><body>{children}</body></html>; }
