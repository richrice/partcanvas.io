"use client";

import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { authClient } from "@/lib/auth/client";

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
      </main>
    </div>
  );
}
