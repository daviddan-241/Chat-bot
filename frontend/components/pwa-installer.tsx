"use client";
import * as React from "react";

/** Register the service worker once on the client. */
export function PWAInstaller() {
  React.useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const isLocalhost =
      location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (!isLocalhost && location.protocol !== "https:") return;
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}
