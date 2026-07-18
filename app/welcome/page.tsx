"use client";

import { Box, Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { validateUsername } from "@/lib/auth/username";

export default function WelcomePage() {
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Signed out or already onboarded → nothing to do here.
  useEffect(() => {
    if (isPending) return;
    if (!session?.user || session.user.username) router.replace("/");
  }, [isPending, session, router]);

  const normalized = username.trim().toLowerCase();
  const problem = normalized ? validateUsername(normalized) : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!normalized || problem || submitting) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const response = await fetch("/api/app/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: normalized }),
      });
      const payload = await response.json() as { username?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save the username");
      router.replace("/");
      router.refresh();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Could not save the username");
      setSubmitting(false);
    }
  };

  return (
    <main className="welcome-shell">
      <form className="welcome-card" onSubmit={submit}>
        <span className="brand-mark"><Box size={18} strokeWidth={2.2} /></span>
        <h1>Choose your username</h1>
        <p>
          Your models will live at partcanvas.io/u/<strong>{normalized || "username"}</strong>.
          Usernames are permanent for now — pick one you like.
        </p>
        <input
          autoFocus
          aria-label="Username"
          placeholder="e.g. gear-smith"
          maxLength={30}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={isPending || submitting}
        />
        {normalized && problem ? <span className="welcome-problem"><TriangleAlert size={13} /> {problem}</span> : null}
        {serverError ? <span className="welcome-problem"><TriangleAlert size={13} /> {serverError}</span> : null}
        <button className="primary-button" type="submit" disabled={!normalized || Boolean(problem) || isPending || submitting}>
          {submitting ? <><LoaderCircle className="spinner" size={15} /> Saving…</> : <><Check size={15} /> Claim username</>}
        </button>
      </form>
    </main>
  );
}
