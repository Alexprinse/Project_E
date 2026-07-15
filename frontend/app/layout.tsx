import type { Metadata } from "next";
import { Inter, Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/features/Sidebar";
import { BottomTabBar } from "@/components/features/BottomTabBar";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Marg — Industrial Knowledge Terminal",
  description:
    "AI-powered Industrial Knowledge Graph and Hybrid RAG QA platform for asset-intensive industries.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Marg",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#0D1117" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </head>
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${ibmPlexMono.variable} flex h-screen w-screen overflow-hidden bg-background text-foreground font-sans`}
      >
        {/* No service worker — avoids stale chunk caching in dev */}

        {/* ── Sidebar (desktop lg+) ── */}
        <Sidebar />

        {/* ── Main Work Area ── */}
        <main className="flex-1 flex flex-col overflow-hidden relative lg:pb-0 mobile-content-padding min-w-0">
          {children}
        </main>

        {/* ── Bottom Tab Bar (mobile + tablet, hidden lg+) ── */}
        <BottomTabBar />
      </body>
    </html>
  );
}
