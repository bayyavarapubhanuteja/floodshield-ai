/* Profile: user details, edit, change password, sign out. */
import React, { useEffect, useState } from "react";
import { Clock, KeyRound, LogOut, Mail, Save, ShieldCheck, User as UserIcon } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { api } from "@/lib/api";
import { Badge, Card, ErrorBox, PageHeader, Section, Spinner, Stat } from "@/components/ui";
import { pretty } from "@/lib/format";

const ROLE_COLORS: Record<string, string> = { ADMIN: "#9f1239", MUNICIPAL_OFFICER: "#0ea5e9", EMERGENCY_RESPONDER: "#dc2626", ANALYST: "#6366f1", CITIZEN: "#16a34a" };

function pwProblem(p: string) {
  if (p.length < 8) return "At least 8 characters";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Must contain letters and digits";
  return null;
}

export default function Profile() {
  const { user, setUser, logout, toast, t } = useApp();
  const [name, setName] = useState(user?.full_name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [dept, setDept] = useState(user?.department || "");
  const [saving, setSaving] = useState(false);
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [conf, setConf] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);

  useEffect(() => { if (user) { setName(user.full_name || ""); setPhone(user.phone || ""); setDept(user.department || ""); } }, [user]);
  if (!user) return null;
  const u: any = user;
  const dirty = name !== user.full_name || phone !== (user.phone || "") || dept !== (user.department || "");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) { toast({ kind: "error", title: "Full name must be at least 2 characters" }); return; }
    setSaving(true);
    try {
      const nu = await api.put("/api/auth/me", { full_name: name.trim(), phone: phone.trim(), department: dept.trim() });
      setUser(nu);
      toast({ kind: "success", title: "Profile updated" });
    } catch (ex: any) { toast({ kind: "error", title: "Could not update profile", body: ex?.message }); }
    finally { setSaving(false); }
  };

  const newProblem = nw ? pwProblem(nw) : null;
  const mismatch = conf.length > 0 && conf !== nw;
  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = pwProblem(nw);
    if (!cur) { setPwErr("Enter your current password"); return; }
    if (p) { setPwErr(`New password: ${p}`); return; }
    if (nw !== conf) { setPwErr("New passwords do not match"); return; }
    if (nw === cur) { setPwErr("New password must differ from the current one"); return; }
    setPwErr(null); setPwBusy(true);
    try {
      await api.post("/api/auth/change-password", { current_password: cur, new_password: nw });
      setCur(""); setNw(""); setConf("");
      toast({ kind: "success", title: "Password changed" });
    } catch (ex: any) { setPwErr(ex?.message || "Password change failed"); }
    finally { setPwBusy(false); }
  };

  return (
    <Section>
      <PageHeader icon={UserIcon} title="Profile" subtitle="Your account details, contact information and security."
        actions={<button className="btn-danger" onClick={logout}><LogOut size={15} />{t("logout")}</button>} />

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Account" icon={ShieldCheck}>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-14 w-14 shrink-0 rounded-full bg-brand/15 text-brand flex items-center justify-center text-xl font-bold">
              {(user.full_name || user.email).split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="font-semibold truncate">{user.full_name}</div>
              <div className="text-xs text-muted flex items-center gap-1 truncate"><Mail size={11} />{user.email}</div>
              <div className="mt-1"><Badge color={ROLE_COLORS[user.role] || "#64748b"} solid>{pretty(user.role)}</Badge></div>
            </div>
          </div>
          {user.requested_role && user.requested_role !== user.role && (
            <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
              <Clock size={13} className="mt-0.5 shrink-0" />
              <span>Your request for the <b>{pretty(user.requested_role)}</b> role is pending administrator approval. You currently have {pretty(user.role)} access.</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Stat label="City" value={pretty(user.city)} />
            <Stat label="Language" value={user.language?.toUpperCase()} />
            <Stat label="Status" value={u.is_active === false ? "Disabled" : "Active"} />
            <Stat label="Member since" value={u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"} />
          </div>
        </Card>

        <Card title="Personal details" icon={UserIcon}>
          <form onSubmit={save} className="space-y-3">
            <label className="block"><span className="label">{t("full_name")}</span>
              <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} /></label>
            <label className="block"><span className="label">Phone</span>
              <input className="input" type="tel" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="+91 …" /></label>
            <label className="block"><span className="label">Department</span>
              <input className="input" value={dept} onChange={(e) => setDept(e.target.value)} placeholder="e.g. GHMC Storm Water Drains" /></label>
            <label className="block"><span className="label">{t("email")}</span>
              <input className="input opacity-70" value={user.email} disabled readOnly /></label>
            <button type="submit" className="btn-primary w-full sm:w-auto" disabled={saving || !dirty}>{saving ? <Spinner size={14} className="text-current" /> : <Save size={15} />}Save changes</button>
          </form>
        </Card>

        <Card title="Change password" icon={KeyRound}>
          <form onSubmit={changePw} className="space-y-3">
            <label className="block"><span className="label">Current password</span>
              <input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></label>
            <label className="block"><span className="label">New password</span>
              <input className="input" type="password" value={nw} onChange={(e) => setNw(e.target.value)} autoComplete="new-password" aria-invalid={!!newProblem} aria-describedby="pw-hint" />
              <span id="pw-hint" className={newProblem ? "text-[11px] text-red-500" : "text-[11px] text-muted"}>{newProblem || "At least 8 characters, with letters and digits."}</span></label>
            <label className="block"><span className="label">Confirm new password</span>
              <input className="input" type="password" value={conf} onChange={(e) => setConf(e.target.value)} autoComplete="new-password" aria-invalid={mismatch} />
              {mismatch && <span className="text-[11px] text-red-500">Passwords do not match</span>}</label>
            {pwErr && <ErrorBox error={pwErr} />}
            <button type="submit" className="btn-primary w-full sm:w-auto" disabled={pwBusy || !cur || !nw || !conf}>{pwBusy ? <Spinner size={14} className="text-current" /> : <KeyRound size={15} />}Update password</button>
          </form>
        </Card>
      </div>
    </Section>
  );
}
