"use client";
import { useEffect, useMemo, useState } from "react";
import { Camera, CalendarDays, ChartNoAxesColumn, Plus, Settings, Shirt, Sparkles } from "lucide-react";
import { categoryLabels, colorLabels, type ClothesInput } from "@ai-closet/shared";
import { createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";

const demoItems = [
  { id: "1", name: "白いTシャツ", category: "tops", color: "white", image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=600&q=80" },
  { id: "2", name: "デニムパンツ", category: "bottoms", color: "denim", image: "https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=600&q=80" },
  { id: "3", name: "ネイビージャケット", category: "outer", color: "navy", image: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=600&q=80" }
] as const;
type Tab = "home" | "calendar" | "stats" | "settings";
export default function Home() {
 const [user,setUser]=useState<User|null|undefined>(undefined);
 useEffect(()=>onAuthStateChanged(auth,setUser),[]);
 if(user===undefined) return <main className="auth-shell">読み込み中…</main>;
 if(!user) return <AuthScreen/>;
 if(!user.emailVerified) return <VerifyEmail user={user}/>;
 return <ClosetApp/>;
}
function ClosetApp() {
 const [tab, setTab] = useState<Tab>("home"); const [menu, setMenu] = useState(false); const [form, setForm] = useState(false);
 const title = useMemo(() => ({ home:"クローゼット", calendar:"カレンダー", stats:"着用の傾向", settings:"設定" })[tab], [tab]);
 return <main className="shell"><header><div><p className="eyebrow">AI CLOSET</p><h1>{title}</h1></div><button className="avatar" aria-label="プロフィール">K</button></header>
 {tab === "home" && <><section className="intro"><Sparkles size={18}/><p>こんにちは、今日はどんな服を着ましたか？</p></section><div className="section-head"><h2>あなたの服 <span>{demoItems.length}</span></h2><button>すべて見る</button></div><section className="closet">{demoItems.map(item=><article key={item.id} className="garment"><img src={item.image} alt={item.name}/><div><p>{item.name}</p><small>{categoryLabels[item.category]} · {colorLabels[item.color]}</small></div></article>)}</section></>}
 {tab === "calendar" && <CalendarView />}{tab === "stats" && <StatsView />}{tab === "settings" && <SettingsView logout={()=>signOut(auth)}/>} 
 {tab === "home" && <><div className={menu?"scrim on":"scrim"} onClick={()=>setMenu(false)}/><div className={menu?"fab-menu open":"fab-menu"}><button onClick={()=>setForm(true)}><Plus/>新しい服を登録</button><button><Camera/>今日の服を記録</button></div><button className="fab" onClick={()=>setMenu(!menu)} aria-label="撮影メニュー"><Camera/></button></>}
 {form && <ClothesForm close={()=>setForm(false)}/>}<nav>{[["calendar",CalendarDays,"カレンダー"],["home",Shirt,"ホーム"],["stats",ChartNoAxesColumn,"統計"],["settings",Settings,"設定"]].map(([id,Icon,label])=><button key={String(id)} className={tab===id?"active":""} onClick={()=>setTab(id as Tab)}><Icon size={21}/><span>{label as string}</span></button>)}</nav></main>;
}
function CalendarView(){return <section className="calendar"><p className="month">2026年 11月</p><div className="week">{["日","月","火","水","木","金","土"].map(x=><span key={x}>{x}</span>)}</div><div className="days">{Array.from({length:30},(_,i)=><button className={[3,8,13,19,26].includes(i)?"logged":""} key={i}>{i+1}</button>)}</div><h2>11月の記録</h2><p className="muted">5日着用を記録しました。</p></section>}
function StatsView(){return <section className="stats"><p className="metric">5 <span>回</span></p><p className="muted">今月の着用記録</p><div className="bar"><i/><i/><i/></div><h2>よく着た服</h2><ol><li>白いTシャツ <b>3回</b></li><li>デニムパンツ <b>2回</b></li><li>ネイビージャケット <b>1回</b></li></ol></section>}
function SettingsView({logout}:{logout:()=>void}){return <section className="settings"><div className="profile"><div className="large-avatar">K</div><div><h2>Keigo</h2><p>プロフィールを編集</p></div></div><button className="line">通知</button><button className="line">プライバシーと画像の保持</button><button className="line danger" onClick={logout}>ログアウト</button></section>}
function AuthScreen(){const [mode,setMode]=useState<"login"|"signup">("login"),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false); const submit=async(e:React.FormEvent)=>{e.preventDefault();setError("");setBusy(true);try{if(mode==="login")await signInWithEmailAndPassword(auth,email,password);else {const credential=await createUserWithEmailAndPassword(auth,email,password);await sendEmailVerification(credential.user)}}catch{setError("メールアドレスまたはパスワードを確認してください。パスワードは6文字以上必要です。")}finally{setBusy(false)}};return <main className="auth-shell"><section className="auth"><p className="eyebrow">AI CLOSET</p><h1>今日の服を、<br/>未来の選択肢に。</h1><p className="auth-copy">あなたのクローゼットと着用記録をひとつに。</p><form onSubmit={submit}><label>メールアドレス<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>パスワード<input type="password" autoComplete={mode==="login"?"current-password":"new-password"} minLength={6} value={password} onChange={e=>setPassword(e.target.value)} required/></label>{error&&<p className="auth-error">{error}</p>}<button className="save" disabled={busy}>{busy?"処理中…":mode==="login"?"ログイン":"アカウントを作成"}</button></form><button className="switch" onClick={()=>setMode(mode==="login"?"signup":"login")}>{mode==="login"?"初めての方はこちら":"すでにアカウントをお持ちの方"}</button></section></main>}
function VerifyEmail({user}:{user:User}){const [message,setMessage]=useState("");return <main className="auth-shell"><section className="auth"><p className="eyebrow">AI CLOSET</p><h1>メールを<br/>確認してください。</h1><p className="auth-copy">{user.email} 宛に確認メールを送りました。メール内のリンクを開いた後、下のボタンを押してください。</p>{message&&<p className="auth-copy">{message}</p>}<button className="save" onClick={async()=>{await user.reload();setMessage(user.emailVerified?"確認できました。":"まだ確認されていません。リンクを開いてから再度お試しください。");}}>確認を完了した</button><button className="switch" onClick={async()=>{await sendEmailVerification(user);setMessage("確認メールを再送しました。")}}>確認メールを再送</button><button className="switch" onClick={()=>signOut(auth)}>別のアカウントでログイン</button></section></main>}
function ClothesForm({close}:{close:()=>void}){const [data,setData]=useState<Partial<ClothesInput>>({category:"tops",color:"white"}); return <div className="modal"><section><button className="close" onClick={close}>×</button><p className="eyebrow">NEW ITEM</p><h2>服を登録</h2><label className="upload">＋<span>写真を追加</span><input type="file" accept="image/*" capture="environment"/></label><label>カテゴリ<select value={data.category} onChange={e=>setData({...data,category:e.target.value as ClothesInput["category"]})}>{Object.entries(categoryLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>色<select value={data.color} onChange={e=>setData({...data,color:e.target.value as ClothesInput["color"]})}>{Object.entries(colorLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><button className="save" onClick={close}>クローゼットに追加</button></section></div>}
