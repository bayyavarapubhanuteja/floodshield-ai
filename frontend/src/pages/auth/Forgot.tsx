import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { ErrorBox, Spinner } from "@/components/ui";
import AuthLayout from "./AuthLayout";

export default function Forgot() {
  const { t } = useApp();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [pw, setPw] = useState("");
  const [stage, setStage] = useState<"request" | "reset" | "done">("request");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await api.post("/api/auth/forgot-password", { email });
      setMsg(r.message);
      if (r.dev_reset_token) { setToken(r.dev_reset_token); setMsg(r.message + " (Development mode: no mail server configured, token pre-filled below.)"); }
      setStage("reset");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const reset = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.post("/api/auth/reset-password", { token, new_password: pw }); setStage("done"); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <AuthLayout title="Reset password">
      {stage === "request" && (
        <form onSubmit={request} className="space-y-3">
          <label className="block"><span className="label">{t("email")}</span><input className="input" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          {err && <ErrorBox error={err} />}
          <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner size={16} />}Send reset link</button>
        </form>
      )}
      {stage === "reset" && (
        <form onSubmit={reset} className="space-y-3">
          {msg && <p className="text-sm text-muted">{msg}</p>}
          <label className="block"><span className="label">Reset token</span><input className="input font-mono text-xs" required value={token} onChange={(e) => setToken(e.target.value)} /></label>
          <label className="block"><span className="label">New password</span><input className="input" type="password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          {err && <ErrorBox error={err} />}
          <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner size={16} />}Set new password</button>
        </form>
      )}
      {stage === "done" && <p className="text-sm">Password updated. You can now sign in.</p>}
      <p className="mt-4 text-center text-sm"><Link to="/login" className="text-brand hover:underline">Back to sign in</Link></p>
    </AuthLayout>
  );
}
