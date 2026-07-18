"use client";

import { Check, Copy, KeyRound, LoaderCircle, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { authClient } from "@/lib/auth/client";

interface TokenSummary {
  id: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function ApiTokensSection() {
  const [tokens, setTokens] = useState<TokenSummary[] | null>(null);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/app/tokens");
    if (response.ok) setTokens(((await response.json()) as { tokens: TokenSummary[] }).tokens);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/app/tokens")
      .then(async (response) => (response.ok ? ((await response.json()) as { tokens: TokenSummary[] }).tokens : null))
      .then((loaded) => {
        if (!cancelled && loaded) setTokens(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/app/tokens", { method: "POST" });
      const payload = await response.json() as { token?: string };
      if (response.ok && payload.token) {
        setFreshToken(payload.token);
        setCopied(false);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    await fetch(`/api/app/tokens/${id}`, { method: "DELETE" });
    if (freshToken && tokens?.some((token) => token.id === id)) setFreshToken(null);
    await refresh();
  };

  return (
    <section className="welcome-card settings-card">
      <h1><KeyRound size={17} /> API tokens</h1>
      <p>Bearer tokens authenticate programmatic publishing via <code>POST /api/models</code>. A token is shown once at creation — store it safely and revoke any you no longer use.</p>
      {freshToken && (
        <div className="token-fresh">
          <code>{freshToken}</code>
          <button className="ghost-button" type="button" onClick={() => { void navigator.clipboard.writeText(freshToken).then(() => setCopied(true)); }}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {tokens === null ? <p className="page-empty">Loading…</p> : tokens.length === 0 ? <p className="page-empty">No tokens yet.</p> : (
        <ul className="token-list">
          {tokens.map((token) => (
            <li key={token.id}>
              <code>{token.prefix}…</code>
              <span>created {new Date(token.createdAt).toLocaleDateString()}{token.lastUsedAt ? ` · last used ${new Date(token.lastUsedAt).toLocaleDateString()}` : " · never used"}</span>
              <button className="ghost-button" type="button" onClick={() => void revoke(token.id)} title="Revoke token"><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <button className="primary-button" type="button" onClick={() => void create()} disabled={busy}>
        {busy ? <LoaderCircle className="spinner" size={15} /> : <Plus size={15} />} Create token
      </button>
    </section>
  );
}

export default function SettingsPage() {
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [bio, setBio] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "saved" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (!isPending && !session?.user) router.replace("/");
  }, [isPending, session, router]);

  const currentUser = session?.user;
  const nameValue = displayName ?? currentUser?.name ?? "";
  const bioValue = bio ?? currentUser?.bio ?? "";

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !nameValue.trim()) return;
    setSaving(true);
    setStatus(null);
    const { error } = await authClient.updateUser({ name: nameValue.trim().slice(0, 80), bio: bioValue.trim().slice(0, 500) });
    setSaving(false);
    if (error) setStatus({ kind: "error", message: error.message || "Could not save profile" });
    else {
      setStatus({ kind: "saved", message: "Profile saved" });
      router.refresh();
    }
  };

  return (
    <div className="page-shell">
      <SiteHeader />
      <main className="page-main">
        <form className="welcome-card settings-card" onSubmit={save}>
          <h1>Profile settings</h1>
          <p>
            Signed in as <strong>{currentUser?.username ?? currentUser?.email ?? "…"}</strong>.
            {currentUser?.username ? <> Public profile: <a href={`/u/${currentUser.username}`}>/u/{currentUser.username}</a></> : null}
          </p>
          <label className="publish-field">
            <span>Display name</span>
            <input aria-label="Display name" maxLength={80} value={nameValue} onChange={(event) => setDisplayName(event.target.value)} disabled={isPending || saving} required />
          </label>
          <label className="publish-field">
            <span>Bio</span>
            <textarea aria-label="Bio" maxLength={500} rows={4} value={bioValue} onChange={(event) => setBio(event.target.value)} disabled={isPending || saving} placeholder="What do you design?" />
          </label>
          {status && (
            <span className={status.kind === "error" ? "welcome-problem" : "settings-saved"}>
              {status.kind === "error" ? <TriangleAlert size={13} /> : <Check size={13} />} {status.message}
            </span>
          )}
          <button className="primary-button" type="submit" disabled={isPending || saving || !nameValue.trim()}>
            {saving ? <><LoaderCircle className="spinner" size={15} /> Saving…</> : <><Check size={15} /> Save profile</>}
          </button>
        </form>
        {currentUser ? <ApiTokensSection /> : null}
      </main>
    </div>
  );
}
