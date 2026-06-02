import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import { PWAInstaller } from "@/components/pwa-installer";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nova — AI Workspace",
  description: "Streaming AI chat, live artifacts, 19+ agents, projects, files, GitHub, deploys.",
  applicationName: "Nova",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Nova",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0d14",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* iOS PWA + status-bar styling */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Nova" />
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
        <PWAInstaller />
      </body>
    </html>
  );
}
