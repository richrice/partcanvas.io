"use client";

import { ChevronDown, CircleUserRound, Github, LogIn, LogOut, Mail } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth/client";

// Sign-in / account menu for the topbar. Also owns the "no username yet"
// redirect: any signed-in visit without a chosen username lands on /welcome.
export function AuthMenu() {
  const { data: session, isPending } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isPending && session?.user && !session.user.username && pathname !== "/welcome") {
      router.push("/welcome");
    }
  }, [isPending, session, pathname, router]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const signIn = (provider: "github" | "google") => {
    void authClient.signIn.social({ provider, callbackURL: window.location.pathname });
  };

  if (isPending) return <div className="auth-menu" ref={menuRef} />;

  if (!session?.user) {
    return (
      <div className="auth-menu" ref={menuRef}>
        <button className="ghost-button" onClick={() => setOpen((value) => !value)}>
          <LogIn size={15} /> Sign in <ChevronDown size={14} />
        </button>
        {open && (
          <div className="example-menu auth-dropdown">
            <span className="menu-label">SIGN IN TO PUBLISH</span>
            <button onClick={() => signIn("github")}><Github size={16} /> Continue with GitHub</button>
            <button onClick={() => signIn("google")}><Mail size={16} /> Continue with Google</button>
          </div>
        )}
      </div>
    );
  }

  const { user } = session;
  return (
    <div className="auth-menu" ref={menuRef}>
      <button className="ghost-button" onClick={() => setOpen((value) => !value)}>
        {user.image
          // eslint-disable-next-line @next/next/no-img-element -- tiny avatar from the OAuth provider; next/image adds nothing here
          ? <img className="auth-avatar" src={user.image} alt="" width={20} height={20} />
          : <CircleUserRound size={16} />}
        {user.username ?? user.name}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="example-menu auth-dropdown">
          <span className="menu-label">{user.email}</span>
          <button onClick={() => { setOpen(false); void authClient.signOut().then(() => router.refresh()); }}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
