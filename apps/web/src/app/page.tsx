"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, CalendarDays, ChartNoAxesColumn, ChevronLeft, ChevronRight, CloudSun, MapPin, MessageCircle, Plus, Settings, Shirt, Sparkles, UserRound, X as XIcon } from "lucide-react";
import { categoryLabels, colorLabels, seasonLabels, prefectures, type ProfileInput } from "@ai-closet/shared";
import { createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { apiFetch } from "@/lib/api";
import { OutfitLogFlow } from "@/components/OutfitLogFlow";
import { ClothesForm } from "@/components/ClothesForm";
import { ChatView } from "@/components/ChatView";
import { VirtualTryOn } from "@/components/VirtualTryOn";

type Tab = "home" | "calendar" | "stats" | "settings";
const colorCss: Record<string, string> = {
  white: "#e8e6e1", black: "#222", gray: "#999", brown: "#8B4513", beige: "#D4B896",
  blue: "#4169E1", navy: "#1a1a6e", green: "#2E8B57", yellow: "#FFD700",
  orange: "#FF8C00", red: "#DC143C", pink: "#FF69B4", purple: "#8068B8",
  gold: "#DAA520", silver: "#C0C0C0", denim: "#4682B4", "multi-color": "linear-gradient(135deg,#f06,#4169E1,#2E8B57)"
};
const prefCoords: Record<string, [number, number]> = {
  "北海道":[43.06,141.35],"青森県":[40.82,140.74],"岩手県":[39.70,141.15],"宮城県":[38.27,140.87],"秋田県":[39.72,140.10],
  "山形県":[38.24,140.36],"福島県":[37.75,140.47],"茨城県":[36.34,140.45],"栃木県":[36.57,139.88],"群馬県":[36.39,139.06],
  "埼玉県":[35.86,139.65],"千葉県":[35.61,140.12],"東京都":[35.69,139.69],"神奈川県":[35.45,139.64],"新潟県":[37.90,139.02],
  "富山県":[36.70,137.21],"石川県":[36.59,136.63],"福井県":[36.07,136.22],"山梨県":[35.66,138.57],"長野県":[36.23,138.18],
  "岐阜県":[35.39,136.72],"静岡県":[34.98,138.38],"愛知県":[35.18,136.91],"三重県":[34.73,136.51],"滋賀県":[35.00,135.87],
  "京都府":[35.02,135.76],"大阪府":[34.69,135.52],"兵庫県":[34.69,135.18],"奈良県":[34.69,135.83],"和歌山県":[34.23,135.17],
  "鳥取県":[35.50,134.24],"島根県":[35.47,133.05],"岡山県":[34.66,133.93],"広島県":[34.40,132.46],"山口県":[34.19,131.47],
  "徳島県":[34.07,134.56],"香川県":[34.34,134.04],"愛媛県":[33.84,132.77],"高知県":[33.56,133.53],"福岡県":[33.61,130.42],
  "佐賀県":[33.25,130.30],"長崎県":[32.74,129.87],"熊本県":[32.79,130.74],"大分県":[33.24,131.61],"宮崎県":[31.91,131.42],
  "鹿児島県":[31.56,130.56],"沖縄県":[26.34,127.68],
};
const weatherEmoji: Record<number, string> = { 0:"☀️",1:"🌤",2:"⛅",3:"☁️",45:"🌫",48:"🌫",51:"🌦",53:"🌧",55:"🌧",61:"🌧",63:"🌧",65:"🌧",71:"🌨",73:"❄️",75:"❄️",80:"🌦",81:"🌧",85:"🌨",86:"❄️",95:"⛈",96:"⛈",99:"⛈" };
type ClothesItem = {
  clothesId: string; category: string; color: string;
  subCategory?: string | null; imageUrl?: string | null;
  name?: string | null; createdAt?: string;
};
type LogItem = {
  logId: string; date: string; selfieKey?: string | null;
  createdAt?: string; clothesIds: string[];
};

export default function Home() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => { if (auth) return onAuthStateChanged(auth, setUser); }, []);
  if (user === undefined) return <main className="auth-shell">読み込み中…</main>;
  if (!user) return <AuthScreen />;
  if (!user.emailVerified) return <VerifyEmail user={user} />;
  return <ClosetApp />;
}

function ClosetApp() {
  const [tab, setTab] = useState<Tab>("home");
  const [menu, setMenu] = useState(false);
  const [form, setForm] = useState(false);
  const [logFlow, setLogFlow] = useState(false);
  const [showMyPage, setShowMyPage] = useState(false);
  const [profile, setProfile] = useState<ProfileInput>({});
  const [clothes, setClothes] = useState<ClothesItem[]>([]);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [suggestion, setSuggestion] = useState<{ greeting: string; outfitIds: string[]; reason: string; tips: string; weather?: { temp: number; code: number } } | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [tryOnOpen, setTryOnOpen] = useState(false);
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });

  const fetchClothes = useCallback(async () => {
    try {
      const r = await apiFetch("/api/clothes");
      if (r.ok) setClothes(r.items);
    } catch {}
  }, []);

  const fetchLogs = useCallback(async (year: number, month: number) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const from = `${year}-${pad(month)}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to = `${year}-${pad(month)}-${pad(lastDay)}`;
    try {
      const r = await apiFetch(`/api/logs?from=${from}&to=${to}`);
      if (r.ok) setLogs(r.items);
    } catch {}
  }, []);

  useEffect(() => {
    apiFetch("/api/profile").then(r => { if (r.ok && r.profile) setProfile(r.profile); }).catch(() => {});
    fetchClothes();
  }, [fetchClothes]);

  useEffect(() => {
    fetchLogs(calMonth.year, calMonth.month);
  }, [calMonth, fetchLogs]);

  useEffect(() => {
    if (!profile.prefecture || clothes.length === 0 || suggestion) return;
    const coords = prefCoords[profile.prefecture];
    if (!coords) return;
    setSuggestionLoading(true);
    (async () => {
      try {
        const wr = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${coords[0]}&longitude=${coords[1]}&current=temperature_2m,apparent_temperature,weather_code,precipitation,wind_speed_10m&timezone=Asia/Tokyo`);
        const wd = await wr.json();
        const c = wd.current;
        const weather = { temperature: c.temperature_2m, apparentTemperature: c.apparent_temperature, weatherCode: c.weather_code, precipitation: c.precipitation, windSpeed: c.wind_speed_10m };
        const r = await apiFetch("/api/suggest-outfit", { method: "POST", body: JSON.stringify({ weather, prefecture: profile.prefecture }) });
        if (r.ok) setSuggestion({ greeting: r.greeting, outfitIds: r.outfitIds, reason: r.reason, tips: r.tips, weather: { temp: Math.round(weather.temperature), code: weather.weatherCode } });
      } catch {}
      setSuggestionLoading(false);
    })();
  }, [profile.prefecture, clothes.length, suggestion]);

  const saveProfile = useCallback(async (p: ProfileInput) => {
    setProfile(p); setShowMyPage(false);
    try { await apiFetch("/api/profile", { method: "PUT", body: JSON.stringify(p) }); } catch {}
  }, []);

  const title = useMemo(() => showMyPage ? "マイページ" : ({ home: "クローゼット", calendar: "カレンダー", stats: "着用の傾向", settings: "設定" })[tab], [tab, showMyPage]);
  const displayInitial = (profile.displayName ?? "")[0] ?? "?";

  return <main className="shell">
    <header>
      {showMyPage
        ? <button className="back-btn" onClick={() => setShowMyPage(false)}><ChevronLeft size={20} /><span>設定</span></button>
        : <div><p className="eyebrow">AI CLOSET</p><h1>{title}</h1></div>}
      {!showMyPage && <button className="avatar" aria-label="プロフィール">{displayInitial}</button>}
      {showMyPage && <h1>{title}</h1>}
    </header>

    {tab === "home" && !showMyPage && <>
      {suggestion ? <section className="weather-card">
        <div className="weather-head">
          <span className="weather-icon">{weatherEmoji[suggestion.weather?.code ?? 0] ?? "🌤"}</span>
          <div>
            <p className="weather-temp">{suggestion.weather?.temp}°C</p>
            <p className="weather-greeting">{suggestion.greeting}</p>
          </div>
        </div>
        <p className="weather-reason">{suggestion.reason}</p>
        {suggestion.outfitIds.length > 0 && <div className="weather-outfit">
          {suggestion.outfitIds.map(id => { const item = clothes.find(c => c.clothesId === id); return item ? (
            <div key={id} className="weather-item">
              {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <div className="garment-ph">{categoryLabels[item.category as keyof typeof categoryLabels]}</div>}
              <small>{item.name || `${colorLabels[item.color as keyof typeof colorLabels]}の${categoryLabels[item.category as keyof typeof categoryLabels]}`}</small>
            </div>
          ) : null; })}
        </div>}
        <p className="weather-tips"><Sparkles size={12} />{suggestion.tips}</p>
      </section> : suggestionLoading ? <section className="weather-card loading"><div className="spinner small" /><p>天気に合わせたコーデを考えています…</p></section>
      : <section className="intro"><Sparkles size={18} /><p>こんにちは、今日はどんな服を着ましたか？</p></section>}
      <div className="section-head"><h2>あなたの服 <span>{clothes.length}</span></h2></div>
      {clothes.length === 0
        ? <section className="closet-empty"><p className="muted">クローゼットに服がまだありません。<br />右下のボタンから登録してください。</p></section>
        : <section className="closet">{clothes.map(item =>
            <article key={item.clothesId} className="garment">
              {item.imageUrl
                ? <img src={item.imageUrl} alt={item.name ?? ""} />
                : <div className="garment-ph">{categoryLabels[item.category as keyof typeof categoryLabels] ?? item.category}</div>}
              <div>
                <p>{item.name || `${colorLabels[item.color as keyof typeof colorLabels] ?? item.color}の${categoryLabels[item.category as keyof typeof categoryLabels] ?? item.category}`}</p>
                <small>{categoryLabels[item.category as keyof typeof categoryLabels] ?? item.category} · {colorLabels[item.color as keyof typeof colorLabels] ?? item.color}</small>
              </div>
            </article>
          )}</section>}
    </>}

    {tab === "calendar" && !showMyPage && <CalendarView logs={logs} month={calMonth} onChangeMonth={setCalMonth} clothes={clothes} />}
    {tab === "stats" && !showMyPage && <StatsView logs={logs} clothes={clothes} month={calMonth} />}
    {tab === "settings" && !showMyPage && <SettingsView logout={() => { if (auth) signOut(auth); }} profile={profile} onEditProfile={() => setShowMyPage(true)} />}
    {showMyPage && <MyPageView profile={profile} onSave={saveProfile} />}

    {tab === "home" && !showMyPage && <>
      <div className={menu ? "scrim on" : "scrim"} onClick={() => setMenu(false)} />
      <div className={menu ? "fab-menu open" : "fab-menu"}>
        <button onClick={() => { setMenu(false); setForm(true); }}><Plus />新しい服を登録</button>
        <button onClick={() => { setMenu(false); setLogFlow(true); }}><Camera />今日の服を記録</button>
        {clothes.length > 0 && <button onClick={() => { setMenu(false); setTryOnOpen(true); }}><Sparkles />バーチャル試着</button>}
      </div>
      <button className="fab" onClick={() => setMenu(!menu)} aria-label="撮影メニュー"><Camera /></button>
    </>}

    {form && <ClothesForm close={() => setForm(false)} onSaved={fetchClothes} />}
    {logFlow && <OutfitLogFlow close={() => { setLogFlow(false); fetchLogs(calMonth.year, calMonth.month); setTab("calendar"); }} onRegister={() => { setLogFlow(false); setForm(true); }} />}

    {!form && !logFlow && !chatOpen && <button className="chat-fab" onClick={() => setChatOpen(true)} aria-label="AIに相談"><MessageCircle size={22} /></button>}
    {chatOpen && <ChatView onClose={() => setChatOpen(false)} />}
    {tryOnOpen && <VirtualTryOn clothes={clothes} onClose={() => setTryOnOpen(false)} />}

    <nav>{([["calendar", CalendarDays, "カレンダー"], ["home", Shirt, "ホーム"], ["stats", ChartNoAxesColumn, "統計"], ["settings", Settings, "設定"]] as const).map(([id, Icon, label]) =>
      <button key={id} className={tab === id ? "active" : ""} onClick={() => { setTab(id as Tab); setShowMyPage(false); }}>{<Icon size={21} />}<span>{label}</span></button>
    )}</nav>
  </main>;
}

function CalendarView({ logs, month, onChangeMonth, clothes }: {
  logs: LogItem[]; month: { year: number; month: number };
  onChangeMonth: (m: { year: number; month: number }) => void; clothes: ClothesItem[];
}) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayStr = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }, []);
  const defaultDate = useMemo(() => {
    if (logs.find(l => l.date === todayStr)) return todayStr;
    const sorted = [...logs].sort((a, b) => b.date.localeCompare(a.date));
    return sorted[0]?.date ?? null;
  }, [logs, todayStr]);
  const [selectedDate, setSelectedDate] = useState<string | null>(defaultDate);
  useEffect(() => { setSelectedDate(prev => prev ?? defaultDate); }, [defaultDate]);

  const daysInMonth = new Date(month.year, month.month, 0).getDate();
  const firstDayOfWeek = new Date(month.year, month.month - 1, 1).getDay();

  const prevMonth = () => { setSelectedDate(null); onChangeMonth(month.month === 1 ? { year: month.year - 1, month: 12 } : { year: month.year, month: month.month - 1 }); };
  const nextMonth = () => { setSelectedDate(null); onChangeMonth(month.month === 12 ? { year: month.year + 1, month: 1 } : { year: month.year, month: month.month + 1 }); };

  const selectedLog = selectedDate ? logs.find(l => l.date === selectedDate) : null;
  const selectedClothes = selectedLog ? clothes.filter(c => selectedLog.clothesIds.includes(c.clothesId)) : [];

  return <section className="calendar">
    <div className="month-nav">
      <button onClick={prevMonth} aria-label="前の月"><ChevronLeft size={18} /></button>
      <p className="month">{month.year}年 {month.month}月</p>
      <button onClick={nextMonth} aria-label="次の月"><ChevronRight size={18} /></button>
    </div>
    <div className="week">{["日", "月", "火", "水", "木", "金", "土"].map(x => <span key={x}>{x}</span>)}</div>
    <div className="days">
      {Array.from({ length: firstDayOfWeek }, (_, i) => <span key={`e${i}`} />)}
      {Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const dateStr = `${month.year}-${pad(month.month)}-${pad(day)}`;
        const dayLog = logs.find(l => l.date === dateStr);
        const logged = !!dayLog;
        const selected = selectedDate === dateStr;
        const dayClothes = dayLog ? dayLog.clothesIds.map(cid => clothes.find(c => c.clothesId === cid)).filter(Boolean).slice(0, 3) : [];
        return <button key={day}
          className={[logged && "logged", selected && "selected"].filter(Boolean).join(" ")}
          onClick={() => setSelectedDate(selected ? null : dateStr)}>
          {day}
          {dayClothes.length > 0 && <span className="cal-thumbs">{dayClothes.map((item, ci) =>
            item?.imageUrl
              ? <img key={ci} src={item.imageUrl} alt="" />
              : <i key={ci} style={{ background: colorCss[item?.color as string] ?? "#8068b8" }} />
          )}</span>}
        </button>;
      })}
    </div>
    {selectedLog ? <div className="log-detail">
      <h2>{selectedDate} のコーデ</h2>
      {selectedClothes.length > 0
        ? <div className="log-clothes">{selectedClothes.map(c =>
            <article key={c.clothesId} className="garment">
              {c.imageUrl
                ? <img src={c.imageUrl} alt={c.name ?? ""} />
                : <div className="garment-ph">{categoryLabels[c.category as keyof typeof categoryLabels] ?? c.category}</div>}
              <div>
                <p>{c.name || `${colorLabels[c.color as keyof typeof colorLabels]}の${categoryLabels[c.category as keyof typeof categoryLabels]}`}</p>
                <small>{categoryLabels[c.category as keyof typeof categoryLabels]} · {colorLabels[c.color as keyof typeof colorLabels]}</small>
              </div>
            </article>
          )}</div>
        : <p className="muted">この日は写真だけの記録です。</p>}
    </div> : <div className="log-detail">
      <h2>{month.month}月の記録</h2>
      {logs.length > 0
        ? <>
          <p className="muted">{logs.length}日着用を記録しました。日付をタップすると詳細を見れます。</p>
          <div className="log-list">{[...logs].sort((a, b) => a.date.localeCompare(b.date)).map(log => {
            const logClothes = log.clothesIds.map(cid => clothes.find(c => c.clothesId === cid)).filter(Boolean);
            return <button key={log.logId} className="log-list-item" onClick={() => setSelectedDate(log.date)}>
              <span className="log-list-date">{log.date.slice(5)}</span>
              <span className="log-list-clothes">{logClothes.map((c, i) =>
                c?.imageUrl ? <img key={i} src={c.imageUrl} alt="" /> : <i key={i} className="log-list-ph">{categoryLabels[c?.category as keyof typeof categoryLabels]?.[0]}</i>
              )}</span>
              <span className="log-list-names">{logClothes.map(c => c?.name || colorLabels[c?.color as keyof typeof colorLabels]).join("、")}</span>
            </button>;
          })}</div>
        </>
        : <p className="muted">まだ記録がありません。</p>}
    </div>}
  </section>;
}

function StatsView({ logs, clothes, month }: { logs: LogItem[]; clothes: ClothesItem[]; month: { year: number; month: number } }) {
  const wearCount: Record<string, number> = {};
  for (const log of logs) for (const cid of log.clothesIds) wearCount[cid] = (wearCount[cid] ?? 0) + 1;

  const wornIds = new Set(Object.keys(wearCount));
  const utilization = clothes.length > 0 ? Math.round((wornIds.size / clothes.length) * 100) : 0;

  const ranked = Object.entries(wearCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([cid, count]) => ({ item: clothes.find(c => c.clothesId === cid), count }));
  const maxCount = ranked[0]?.count ?? 1;

  const catCount: Record<string, number> = {};
  const colorCount: Record<string, number> = {};
  const seasonCount: Record<string, number> = {};
  for (const [cid, count] of Object.entries(wearCount)) {
    const item = clothes.find(c => c.clothesId === cid);
    if (!item) continue;
    catCount[item.category] = (catCount[item.category] ?? 0) + count;
    colorCount[item.color] = (colorCount[item.color] ?? 0) + count;
  }
  for (const cid of wornIds) {
    const item = clothes.find(c => c.clothesId === cid) as (ClothesItem & { season?: string[] }) | undefined;
    if (item && Array.isArray(item.season)) for (const s of item.season) seasonCount[s] = (seasonCount[s] ?? 0) + 1;
  }
  const catRanked = Object.entries(catCount).sort(([, a], [, b]) => b - a);
  const maxCatCount = catRanked[0]?.[1] ?? 1;
  const colorRanked = Object.entries(colorCount).sort(([, a], [, b]) => b - a).slice(0, 8);
  const maxColorCount = colorRanked[0]?.[1] ?? 1;
  const unworn = clothes.filter(c => !wornIds.has(c.clothesId));

  if (logs.length === 0) return <section className="stats">
    <p className="eyebrow">{month.year}年 {month.month}月</p>
    <p className="muted" style={{ textAlign: "center", padding: "60px 0" }}>まだ着用記録がありません。<br />ホームから今日の服を記録してみましょう。</p>
  </section>;

  return <section className="stats">
    <p className="eyebrow">{month.year}年 {month.month}月</p>
    <div className="stats-cards">
      <div className="stat-card"><p className="stat-value">{logs.length}</p><p className="stat-label">記録日数</p></div>
      <div className="stat-card"><p className="stat-value">{utilization}<small>%</small></p><p className="stat-label">着用率</p></div>
      <div className="stat-card"><p className="stat-value">{wornIds.size}<small>/{clothes.length}</small></p><p className="stat-label">着用数</p></div>
    </div>

    <h2>よく着た服</h2>
    <div className="bar">{ranked.map(({ count }, i) =>
      <i key={i} style={{ height: `${Math.max(14, (count / maxCount) * 80)}px`, opacity: 1 - i * 0.15 }} />
    )}</div>
    <ol>{ranked.map(({ item, count }, i) =>
      <li key={item?.clothesId ?? i}>
        {item?.imageUrl && <img src={item.imageUrl} alt="" className="rank-thumb" />}
        {item?.name || (item ? `${colorLabels[item.color as keyof typeof colorLabels]}の${categoryLabels[item.category as keyof typeof categoryLabels]}` : "削除された服")}
        <b>{count}回</b>
      </li>
    )}</ol>

    {catRanked.length > 0 && <>
      <h2>カテゴリ別</h2>
      <div className="dist-bars">{catRanked.map(([cat, count]) =>
        <div key={cat} className="dist-row">
          <span className="dist-label">{categoryLabels[cat as keyof typeof categoryLabels] ?? cat}</span>
          <div className="dist-track"><div className="dist-fill" style={{ width: `${(count / maxCatCount) * 100}%` }} /></div>
          <span className="dist-count">{count}回</span>
        </div>
      )}</div>
    </>}

    {colorRanked.length > 0 && <>
      <h2>カラー分布</h2>
      <div className="dist-bars">{colorRanked.map(([color, count]) =>
        <div key={color} className="dist-row">
          <span className="dist-label"><i className="color-dot" style={{ background: colorCss[color] ?? "#ccc" }} />{colorLabels[color as keyof typeof colorLabels] ?? color}</span>
          <div className="dist-track"><div className="dist-fill" style={{ width: `${(count / maxColorCount) * 100}%`, background: colorCss[color]?.startsWith("linear") ? colorCss[color] : (colorCss[color] ?? "#8068b8") }} /></div>
          <span className="dist-count">{count}回</span>
        </div>
      )}</div>
    </>}

    {unworn.length > 0 && <>
      <h2>今月着てない服 <span className="muted">({unworn.length}着)</span></h2>
      <div className="unworn-grid">{unworn.slice(0, 12).map(item =>
        <div key={item.clothesId} className="unworn-item">
          {item.imageUrl
            ? <img src={item.imageUrl} alt={item.name ?? ""} />
            : <div className="garment-ph">{categoryLabels[item.category as keyof typeof categoryLabels]}</div>}
          <p>{item.name || `${colorLabels[item.color as keyof typeof colorLabels]}の${categoryLabels[item.category as keyof typeof categoryLabels]}`}</p>
        </div>
      )}</div>
    </>}
  </section>;
}

function SettingsView({ logout, profile, onEditProfile }: { logout: () => void; profile: ProfileInput; onEditProfile: () => void }) {
  const displayName = profile.displayName || "未設定";
  const initial = (profile.displayName ?? "")[0] ?? "?";
  const location = [profile.prefecture, profile.district].filter(Boolean).join(" ");
  return <section className="settings">
    <div className="profile" onClick={onEditProfile} role="button" tabIndex={0}>
      <div className="large-avatar">{initial}</div>
      <div><h2>{displayName}</h2><p>プロフィールを編集 →</p></div>
    </div>
    {(profile.age || location) && <div className="profile-summary">
      {profile.age && <span className="profile-tag"><UserRound size={13} />{profile.age}歳</span>}
      {location && <span className="profile-tag"><MapPin size={13} />{location}</span>}
    </div>}
    <button className="line">通知</button>
    <button className="line">プライバシーと画像の保持</button>
    <button className="line danger" onClick={logout}>ログアウト</button>
  </section>;
}

function MyPageView({ profile, onSave }: { profile: ProfileInput; onSave: (p: ProfileInput) => void }) {
  const [data, setData] = useState<ProfileInput>({ ...profile });
  const initial = (data.displayName ?? "")[0] ?? "?";
  return <section className="mypage">
    <div className="mypage-avatar-section"><div className="mypage-avatar">{initial}</div><button className="avatar-change">写真を変更</button></div>
    <div className="mypage-form">
      <label>名前<input type="text" value={data.displayName ?? ""} onChange={e => setData({ ...data, displayName: e.target.value })} placeholder="表示名を入力" maxLength={50} /></label>
      <label>年齢<input type="number" value={data.age ?? ""} onChange={e => setData({ ...data, age: e.target.value ? Number(e.target.value) : undefined })} placeholder="年齢を入力" min={1} max={150} /></label>
      <label>都道府県 <span className="required">必須</span><select value={data.prefecture ?? ""} onChange={e => setData({ ...data, prefecture: e.target.value })}><option value="">選択してください</option>{prefectures.map(p => <option key={p} value={p}>{p}</option>)}</select></label>
      <label>区市町村<input type="text" value={data.district ?? ""} onChange={e => setData({ ...data, district: e.target.value })} placeholder="例: 品川区" maxLength={30} /></label>
    </div>
    <button className="save" onClick={() => onSave(data)} disabled={!data.prefecture}>保存する</button>
  </section>;
}

function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(""); setBusy(true);
    if (!auth) { setError("Firebase が設定されていません。"); setBusy(false); return; }
    try {
      if (mode === "login") await signInWithEmailAndPassword(auth, email, password);
      else { const credential = await createUserWithEmailAndPassword(auth, email, password); await sendEmailVerification(credential.user); }
    } catch { setError("メールアドレスまたはパスワードを確認してください。パスワードは6文字以上必要です。"); }
    finally { setBusy(false); }
  };
  return <main className="auth-shell"><section className="auth">
    <p className="eyebrow">AI CLOSET</p><h1>今日の服を、<br />未来の選択肢に。</h1>
    <p className="auth-copy">あなたのクローゼットと着用記録をひとつに。</p>
    <form onSubmit={submit}>
      <label>メールアドレス<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
      <label>パスワード<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={6} value={password} onChange={e => setPassword(e.target.value)} required /></label>
      {error && <p className="auth-error">{error}</p>}
      <button className="save" disabled={busy}>{busy ? "処理中…" : mode === "login" ? "ログイン" : "アカウントを作成"}</button>
    </form>
    <button className="switch" onClick={() => setMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "初めての方はこちら" : "すでにアカウントをお持ちの方"}</button>
  </section></main>;
}

function VerifyEmail({ user }: { user: User }) {
  const [message, setMessage] = useState("");
  return <main className="auth-shell"><section className="auth">
    <p className="eyebrow">AI CLOSET</p><h1>メールを<br />確認してください。</h1>
    <p className="auth-copy">{user.email} 宛に確認メールを送りました。メール内のリンクを開いた後、下のボタンを押してください。</p>
    {message && <p className="auth-copy">{message}</p>}
    <button className="save" onClick={async () => { await user.reload(); setMessage(user.emailVerified ? "確認できました。" : "まだ確認されていません。リンクを開いてから再度お試しください。"); }}>確認を完了した</button>
    <button className="switch" onClick={async () => { await sendEmailVerification(user); setMessage("確認メールを再送しました。"); }}>確認メールを再送</button>
    <button className="switch" onClick={() => { if (auth) signOut(auth); }}>別のアカウントでログイン</button>
  </section></main>;
}
