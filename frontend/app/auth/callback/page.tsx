"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { auth, authApi } from "@/lib/api";

export default function OAuthCallback() {
  const router = useRouter();
  const [msg, setMsg] = useState("Finishing sign-in...");

  useEffect(() => {
    (async () => {
      try {
        const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
        const params = new URLSearchParams(hash);
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        if (!accessToken || !refreshToken) {
          setMsg("Missing tokens — redirecting to login.");
          setTimeout(() => router.replace("/login"), 1200);
          return;
        }
        const tempUser = { id: "", email: "", full_name: null, is_active: true, is_superuser: false, created_at: "" };
        auth.set({ access_token: accessToken, refresh_token: refreshToken, token_type: "bearer", user: tempUser });
        const me = await authApi.me();
        auth.set({ access_token: accessToken, refresh_token: refreshToken, token_type: "bearer", user: me });
        router.replace("/chat");
      } catch (e) {
        setMsg((e as Error).message);
        setTimeout(() => router.replace("/login"), 1500);
      }
    })();
  }, [router]);

  return (
    <div className="min-h-screen grid place-items-center px-4 text-center">
      <div>
        <Spinner size={28} />
        <div className="mt-3 text-xs text-ink-muted">{msg}</div>
      </div>
    </div>
  );
}
