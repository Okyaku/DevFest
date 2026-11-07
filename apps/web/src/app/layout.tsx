import type { Metadata } from "next";
import "./styles.css";
export const metadata: Metadata = { title: "AI Closet", description: "今日の服を、未来の選択肢に。" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ja"><body>{children}</body></html>; }
