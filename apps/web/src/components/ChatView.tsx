"use client";
import { useCallback, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { apiFetch } from "@/lib/api";

type Message = { role: "user" | "model"; text: string };

const GREETING: Message = { role: "model", text: "こんにちは！ファッションについて何でも相談してください。クローゼットの中身を見ながらアドバイスしますよ。" };

export function ChatView({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 50);
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const userMsg: Message = { role: "user", text };
    const next = [...messages, userMsg];
    setMessages(next);
    setLoading(true);
    scrollToBottom();

    try {
      const apiMessages = next.filter(m => m !== GREETING);
      const r = await apiFetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages: apiMessages.map(m => ({ role: m.role, text: m.text })) }),
      });
      if (r.ok) {
        setMessages(prev => [...prev, { role: "model", text: r.reply }]);
      } else {
        setMessages(prev => [...prev, { role: "model", text: `すみません、エラーが発生しました。(${r.error ?? "unknown"})` }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: "model", text: `通信エラーが発生しました。${e instanceof Error ? e.message : ""}` }]);
    }
    setLoading(false);
    scrollToBottom();
    inputRef.current?.focus();
  };

  return (
    <div className="chat-overlay">
      <div className="chat-container">
        <div className="chat-header">
          <h2>AIスタイリスト</h2>
          <button className="chat-close" onClick={onClose} aria-label="閉じる"><X size={18} /></button>
        </div>
        <div className="chat-messages" ref={scrollRef}>
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              {m.role === "model" && <div className="chat-avatar">AI</div>}
              <div className="chat-bubble">{m.text}</div>
            </div>
          ))}
          {loading && (
            <div className="chat-msg model">
              <div className="chat-avatar">AI</div>
              <div className="chat-bubble"><span className="chat-typing">考え中…</span></div>
            </div>
          )}
        </div>
        <div className="chat-input">
          <input
            ref={inputRef}
            type="text"
            placeholder="コーデの相談をしてみよう…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) send(); }}
            disabled={loading}
          />
          <button onClick={send} disabled={!input.trim() || loading} aria-label="送信"><Send size={18} /></button>
        </div>
      </div>
    </div>
  );
}
