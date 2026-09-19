import React, { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { LogIn } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { ErrorBox, Spinner } from "@/components/ui";
import AuthLayout from "./AuthLayout";

const DEMO = [
  ["ADMIN", "admin@floodshield.local", "Admin@123"],
  ["MUNICIPAL OFFICER", "officer@floodshield.local", "Demo@123"],
  ["EMERGENCY RESPONDER", "responder@floodshield.local", "Demo@123"],
  ["ANALYST", "analyst@floodshield.local", "Demo@123"],
  ["CITIZEN", "citizen@floodshield.local", "Demo@123"],
];

export default function Login() {
  const { login, user, t } = useApp();
  const nav = useNavigate();
  const loc = useLocation() as any;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={loc.state?.from || "/"} replace />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await login(email, password); nav(loc.state?.from || "/", { replace: true }); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <AuthLayout title={t("sign_in")}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block"><span className="label">{t("email")}</span>
          <input className="input" type="text" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="block"><span className="label">{t("password")}</span>
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err && <ErrorBox error={err} />}
        <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner size={16} className="text-white" /> : <LogIn size={16} />}{t("sign_in")}</button>
        <div className="flex justify-between text-sm">
          <Link to="/forgot-password" className="text-brand hover:underline">{t("forgot")}</Link>
          <Link to="/register" className="text-brand hover:underline">{t("register")}</Link>
        </div>
      </form>
      <div className="mt-5 border-t border-line pt-4">
        <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Demo accounts (click to fill)</div>
        <div className="grid gap-1.5">
          {DEMO.map(([r, e, p]) => (
            <button key={e} type="button" onClick={() => { setEmail(e); setPassword(p); }} className="flex items-center justify-between rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-panel2">
              <span className="font-semibold">{r}</span><span className="text-muted font-mono">{e}</span>
            </button>
          ))}
        </div>
      </div>
    </AuthLayout>
  );
}
