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
  const [loadFailed, setLoadFailed] = useState(false);
  // The plaintext is shown once; remembering which row it belongs to keeps it
  // on screen while *other* tokens are revoked.
  const [freshToken, setFreshToken] = useState<{ id: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/app/tokens");
      if (!response.ok) throw new Error();
      setTokens(((await response.json()) as { tokens: TokenSummary[] }).tokens);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/app/tokens")
      .then(async (response) => (response.ok ? ((await response.json()) as { tokens: TokenSummary[] }).tokens : null))
      .then((loaded) => {
        if (cancelled) return;
        if (loaded) setTokens(loaded);
        else setLoadFailed(true);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setTokenError(null);
    try {
      const response = await fetch("/api/app/tokens", { method: "POST" });
      const payload = await response.json().catch(() => ({})) as { token?: string; summary?: { id: string }; error?: string };
      if (!response.ok || !payload.token) throw new Error(payload.error || "Could not create the token");
      setFreshToken({ id: payload.summary?.id ?? "", token: payload.token });
      setCopied(false);
      await refresh();
    } catch (error) {
      setTokenError(error instanceof Error ? error.message : "Could not create the token");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (confirmingRevoke !== id) {
      setConfirmingRevoke(id);
      return;
    }
    setConfirmingRevoke(null);
    setTokenError(null);
    try {
      const response = await fetch(`/api/app/tokens/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not revoke the token");
      if (freshToken?.id === id) setFreshToken(null);
      await refresh();
    } catch (error) {
      setTokenError(error instanceof Error ? error.message : "Could not revoke the token");
    }
  };

  return (
    <section className="welcome-card settings-card">
      <h1><KeyRound size={17} /> API tokens</h1>
      <p>Bearer tokens authenticate programmatic publishing via <code>POST /api/models</code>. A token is shown once at creation — store it safely and revoke any you no longer use.</p>
      {freshToken && (
        <div className="token-fresh">
          <code>{freshToken.token}</code>
          <button className="ghost-button" type="button" onClick={() => { void navigator.clipboard.writeText(freshToken.token).then(() => setCopied(true)); }}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {tokenError && <span className="welcome-problem"><TriangleAlert size={13} /> {tokenError}</span>}
      {tokens === null
        ? <p className="page-empty">{loadFailed ? "Could not load tokens — reload the page to retry." : "Loading…"}</p>
        : tokens.length === 0 ? <p className="page-empty">No tokens yet.</p> : (
        <ul className="token-list">
          {tokens.map((token) => (
            <li key={token.id}>
              <code>{token.prefix}…</code>
              <span>created {new Date(token.createdAt).toLocaleDateString()}{token.lastUsedAt ? ` · last used ${new Date(token.lastUsedAt).toLocaleDateString()}` : " · never used"}</span>
              <button className="ghost-button" type="button" onClick={() => void revoke(token.id)} onBlur={() => setConfirmingRevoke(null)} title="Revoke token">
                <Trash2 size={14} />{confirmingRevoke === token.id ? " Revoke?" : null}
              </button>
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
