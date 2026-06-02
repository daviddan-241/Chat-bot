"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/api";
import { Spinner } from "@/components/ui/spinner";

export default function RootRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(auth.access ? "/chat" : "/login");
  }, [router]);
  return (
    <div className="flex h-screen items-center justify-center">
      <Spinner size={28} />
    </div>
  );
}
