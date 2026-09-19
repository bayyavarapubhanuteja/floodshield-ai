/* FloodShield AI Copilot — grounded Q&A over the live platform snapshot. */
import React, { useEffect, useRef, useState } from "react";
import { Bot, Check, Clock, Copy, Database, Send, ShieldCheck, Sparkles, Trash2, User as UserIcon } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { api } from "@/lib/api";
import { Badge, Card, DataLabel, ErrorBox, Markdown, PageHeader, Section, Spinner, cx } from "@/components/ui";
import { pct, pretty } from "@/lib/format";

const SUGGESTIONS = [
  "Which areas will flood in the next hour?", "Why is this junction high risk?", "Which roads will become unsafe?",
  "Which hospitals are affected?", "Which drains are overloaded?", "What happens at 120 mm/hr?",
  "What happens with 30% drainage blockage?", "Generate a response summary", "What is the rainfall forecast?", "Show active alerts",
];
const STORE = "fs_copilot_history";

interface Msg { id: string; role: "user" | "assistant"; text: string; res?: any; error?: string; city?: string }

function loadHistory(): Msg[] {
  try { return JSON.parse(sessionStorage.getItem(STORE) || "[]"); } catch { return []; }
}

export default function Copilot() {
  const { city } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>(loadHistory);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify(msgs.slice(-60))); } catch { /* quota */ } }, [msgs]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (question.length < 2 || busy) return;
    setInput("");
    const uid = `${Date.now()}u`;
    setMsgs((m) => [...m, { id: uid, role: "user", text: question, city }]);
    setBusy(true);
    try {
      const res = await api.post("/api/copilot", { question, city });
      setMsgs((m) => [...m, { id: `${Date.now()}a`, role: "assistant", text: res.answer || "_No answer returned._", res, city }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { id: `${Date.now()}e`, role: "assistant", text: "", error: e?.message || "Copilot request failed", city }]);
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(input); }
  };
  const lastQuestion = [...msgs].reverse().find((m) => m.role === "user")?.text;

  return (
    <Section>
      <PageHeader icon={Bot} title="FloodShield AI Copilot"
        subtitle="Ask about flood risk, roads, drains, hospitals and scenarios. Answers are generated only from the platform's current simulation and model outputs."
        labels={["MODEL_PREDICTION", "SIMULATED_DATA", "DEMO_DATA"]}
        actions={msgs.length > 0 && <button className="btn-ghost btn-sm" onClick={() => setMsgs([])}><Trash2 size={13} />Clear chat</button>} />

      <div className="grid lg:grid-cols-4 gap-4">
        <Card className="lg:col-span-3 order-1" bodyClass="p-0 flex flex-col">
          <div className="flex-1 overflow-auto scroll-thin p-3 sm:p-4 space-y-4 h-[calc(100vh-330px)] min-h-[360px]" aria-live="polite">
            {msgs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-8">
                <span className="rounded-full bg-brand/10 p-3 text-brand"><Sparkles size={26} /></span>
                <div>
                  <div className="font-semibold">Ask the Copilot about the current flood situation</div>
                  <p className="text-sm text-muted mt-1 max-w-md">Grounded — answers only from live platform data (rainfall nowcast, coupled flood engine, drainage twin, risk and alerts).</p>
                </div>
                <div className="flex flex-wrap justify-center gap-1.5 max-w-2xl">
                  {SUGGESTIONS.slice(0, 6).map((s) => <button key={s} className="chip border border-line hover:border-brand hover:text-brand py-1" onClick={() => ask(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {msgs.map((m) => m.role === "user" ? <UserBubble key={m.id} m={m} /> : <AnswerBubble key={m.id} m={m} onRetry={lastQuestion ? () => ask(lastQuestion) : undefined} />)}
            {busy && (
              <div className="flex items-center gap-2 text-sm text-muted"><span className="rounded-full bg-brand/10 p-1.5 text-brand"><Bot size={16} /></span><Spinner size={14} />Analysing live platform data…</div>
            )}
            <div ref={endRef} />
          </div>
          <form className="border-t border-line p-2 sm:p-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <label htmlFor="copilot-input" className="sr-only">Ask a question</label>
            <textarea id="copilot-input" ref={taRef} rows={1} value={input} maxLength={500} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey}
              className="input resize-none min-h-[42px] max-h-40" placeholder="Ask about flooding, roads, drains, hospitals… (Enter to send, Shift+Enter for new line)" />
            <button type="submit" className="btn-primary h-[42px]" disabled={busy || input.trim().length < 2} aria-label="Send question">
              {busy ? <Spinner size={15} className="text-current" /> : <Send size={15} />}<span className="hidden sm:inline">Send</span>
            </button>
          </form>
        </Card>

        <div className="order-2 space-y-4 min-w-0">
          <Card title="Suggested questions" icon={Sparkles}>
            <div className="flex flex-wrap lg:flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} disabled={busy} onClick={() => ask(s)}
                  className="text-left text-xs rounded-lg border border-line px-2.5 py-1.5 hover:border-brand hover:text-brand disabled:opacity-50 transition-colors">{s}</button>
              ))}
            </div>
          </Card>
          <Card title="Grounding" icon={ShieldCheck}>
            <p className="text-xs text-muted">The Copilot does not invent facts. It classifies your question, reads the current platform snapshot for <b className="text-ink">{pretty(city)}</b> and reports values with their provenance labels:</p>
            <div className="flex flex-wrap gap-1 mt-2"><DataLabel label="SIMULATED_DATA" /><DataLabel label="MODEL_PREDICTION" /><DataLabel label="DEMO_DATA" /></div>
          </Card>
        </div>
      </div>
    </Section>
  );
}

function UserBubble({ m }: { m: Msg }) {
  return (
    <div className="flex justify-end gap-2">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-brand text-white dark:text-slate-900 px-3.5 py-2 text-sm whitespace-pre-wrap break-words">{m.text}</div>
      <span className="rounded-full bg-panel2 border border-line p-1.5 h-fit"><UserIcon size={14} /></span>
    </div>
  );
}

function AnswerBubble({ m, onRetry }: { m: Msg; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);
  const r = m.res;
  const copy = async () => {
    try { await navigator.clipboard.writeText(m.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };
  return (
    <div className="flex gap-2">
      <span className="rounded-full bg-brand/10 text-brand p-1.5 h-fit"><Bot size={16} /></span>
      <div className="min-w-0 flex-1 max-w-[95%]">
        {m.error ? <ErrorBox error={m.error} onRetry={onRetry} /> : (
          <div className="rounded-2xl rounded-tl-sm border border-line bg-panel2 px-3.5 py-2.5">
            <div className="overflow-x-auto scroll-thin"><Markdown>{m.text}</Markdown></div>
            {r && (
              <div className="mt-2 pt-2 border-t border-line space-y-1.5 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  {r.intent && <Badge color="#6366f1">Intent: {pretty(r.intent)}</Badge>}
                  {r.confidence != null && <Badge color={r.confidence >= 0.7 ? "#16a34a" : r.confidence >= 0.5 ? "#eab308" : "#f97316"}>Confidence {pct(r.confidence)}</Badge>}
                  <span className="text-muted flex items-center gap-1"><Clock size={11} />
                    {r.event_minute != null && <>Event minute T+{Math.round(r.event_minute)}</>}
                    {r.issued_at && <> · issued {new Date(r.issued_at).toLocaleString()}</>}
                  </span>
                  {m.city && <span className="text-muted">· {pretty(m.city)}</span>}
                </div>
                {Array.isArray(r.data_labels) && r.data_labels.length > 0 && (
                  <div className="flex flex-wrap gap-1">{r.data_labels.map((l: string) => <DataLabel key={l} label={l} />)}</div>
                )}
                {Array.isArray(r.sources) && r.sources.length > 0 && (
                  <div className="text-muted flex items-start gap-1"><Database size={11} className="mt-0.5 shrink-0" /><span>Sources: {r.sources.join(" · ")}</span></div>
                )}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className={cx("flex items-center gap-1", r.grounded === false ? "text-amber-500" : "text-emerald-600 dark:text-emerald-400")}>
                    <ShieldCheck size={12} />{r.grounded === false ? "Not fully grounded — verify with the dashboards" : "Grounded — answers only from live platform data"}
                  </span>
                  <button className="btn-ghost btn-sm" onClick={copy} aria-label="Copy answer">{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "Copied" : "Copy"}</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
