import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, tokens } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { ErrorBox, Spinner } from "@/components/ui";
import AuthLayout from "./AuthLayout";

export default function Register() {
  const { t, cities, setUser } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ full_name: "", email: "", password: "", confirm: "", role: "CITIZEN", department: "", phone: "", city: "hyderabad", language: "en" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setErr("Passwords do not match");
    setBusy(true); setErr(null);
    try {
      const { confirm, ...body } = f;
      const r = await api.post("/api/auth/register", body);
      tokens.set(r.access_token, r.refresh_token);
      setUser(r.user);
      nav("/", { replace: true });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <AuthLayout title={t("register")}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block"><span className="label">{t("full_name")}</span><input className="input" required minLength={2} value={f.full_name} onChange={set("full_name")} /></label>
        <label className="block"><span className="label">{t("email")}</span><input className="input" type="email" required value={f.email} onChange={set("email")} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="label">{t("password")}</span><input className="input" type="password" required minLength={8} value={f.password} onChange={set("password")} /></label>
          <label className="block"><span className="label">Confirm</span><input className="input" type="password" required value={f.confirm} onChange={set("confirm")} /></label>
        </div>
        <p className="text-[11px] text-muted">At least 8 characters with letters and digits.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="label">Account type</span>
            <select className="input" value={f.role} onChange={set("role")}>
              <option value="CITIZEN">Citizen</option><option value="MUNICIPAL_OFFICER">Municipal officer</option>
              <option value="EMERGENCY_RESPONDER">Emergency responder</option><option value="ANALYST">Analyst</option>
            </select></label>
          <label className="block"><span className="label">{t("city")}</span>
            <select className="input" value={f.city} onChange={set("city")}>{cities.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select></label>
        </div>
        {f.role !== "CITIZEN" && (
          <>
            <label className="block"><span className="label">Department</span><input className="input" value={f.department} onChange={set("department")} /></label>
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
              Official roles are not self-granted: your account starts with citizen access and the role request is sent to an administrator for approval.
            </p>
          </>
        )}
        <label className="block"><span className="label">Phone (optional, for SMS alerts)</span><input className="input" value={f.phone} maxLength={20} onChange={set("phone")} /></label>
        {err && <ErrorBox error={err} />}
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner size={16} className="text-white" />}{t("register")}</button>
        <p className="text-center text-sm">Already registered? <Link to="/login" className="text-brand hover:underline">{t("sign_in")}</Link></p>
      </form>
    </AuthLayout>
  );
}
