"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/stores/auth-store";
import { useToast } from "@/components/ui/toast";
import { googleOAuthApi } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const { register, loading, user, bootstrap, initialized } = useAuthStore();
  const { push } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  useEffect(() => { if (!initialized) bootstrap(); }, [initialized, bootstrap]);
  useEffect(() => { if (user) router.replace("/chat"); }, [user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await register(email, password, fullName || undefined);
      router.replace("/chat");
    } catch (err) {
      push({ kind: "error", title: "Sign up failed", message: (err as Error).message });
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-sm glass rounded-2xl p-6"
      >
        <div className="flex items-center gap-2 mb-5">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-accent to-fuchsia-500 grid place-items-center shadow-lg">
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-none">Nova</h1>
            <p className="text-xs text-ink-muted mt-0.5">AI Workspace</p>
          </div>
        </div>

        <h2 className="text-lg font-semibold mb-1">Create account</h2>
        <p className="text-xs text-ink-muted mb-5">Start your AI workspace in seconds.</p>

        <SocialButtons />
        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-[10px] uppercase tracking-wider text-ink-faint">or</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-ink-muted">Full name (optional)</label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-xs text-ink-muted">Email</label>
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-ink-muted">Password</label>
            <Input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1"
            />
            <p className="text-[10px] text-ink-faint mt-1">At least 8 characters.</p>
          </div>
          <Button type="submit" disabled={loading} className="w-full mt-2">
            {loading ? "Creating..." : "Create account"}
          </Button>
        </form>

        <p className="text-xs text-ink-muted mt-5 text-center">
          Already have an account?{" "}
          <Link href="/login" className="text-accent-glow hover:underline">
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}

function SocialButtons() {
  const { push } = useToast();
  const google = useMutation({
    mutationFn: () => googleOAuthApi.start("signin"),
    onSuccess: (d) => { window.location.href = d.authorize_url; },
    onError: (e) => push({ kind: "error", title: "Google not configured", message: (e as Error).message }),
  });
  return (
    <Button type="button" variant="outline" className="w-full" onClick={() => google.mutate()} disabled={google.isPending}>
      <GoogleIcon /> Continue with Google
    </Button>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.84h5.43c-.24 1.26-.96 2.34-2.04 3.06l3.3 2.55c1.92-1.77 3.03-4.38 3.03-7.5 0-.69-.06-1.35-.18-1.95H12z"/>
      <path fill="#34A853" d="M5.97 14.28l-.74.57-2.62 2.04C4.35 19.65 7.92 22 12 22c2.7 0 4.95-.9 6.6-2.43l-3.3-2.55c-.93.63-2.13 1-3.3 1-2.55 0-4.71-1.71-5.49-4.02z"/>
      <path fill="#FBBC05" d="M2.61 7.11A9.97 9.97 0 0 0 2 12c0 1.77.42 3.45 1.17 4.89l3.36-2.61c-.18-.54-.27-1.11-.27-1.71 0-.6.09-1.17.27-1.71L2.61 7.11z"/>
      <path fill="#4285F4" d="M12 5.4c1.47 0 2.79.51 3.84 1.5l2.88-2.88C16.95 2.4 14.7 1.5 12 1.5 7.92 1.5 4.35 3.84 2.61 7.11l3.36 2.61C6.78 7.11 8.94 5.4 12 5.4z"/>
    </svg>
  );
}
