import type { Metadata } from "next";
import Link from "next/link";
import { Inter, Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Database, LayoutDashboard, MessageSquare, Network, Radio } from "lucide-react";
import { BottomTabBar } from "@/components/features/BottomTabBar";

// Official Next.js font loading configuration
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
  title: "Sutradhar — Industrial Knowledge Terminal",
  description: "AI-powered Industrial Knowledge Graph and Hybrid RAG QA platform for asset-intensive industries.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Sutradhar",
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
        {/* PWA & Status Bar Theming */}
        <meta name="theme-color" content="#14181C" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        {/* Viewport: allow pinch-zoom for graph, but prevent unwanted scaling elsewhere */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </head>
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${ibmPlexMono.variable} flex h-screen w-screen overflow-hidden bg-background text-foreground font-sans`}
      >
        {/* Service Worker registration — inline to avoid a separate client component */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').catch(function(e) {
                    console.warn('SW registration failed:', e);
                  });
                });
              }
            `,
          }}
        />
        {/* ── Sidebar: visible on lg+ only ── */}
        <aside className="hidden lg:flex w-64 border-r border-border bg-card flex-col justify-between shrink-0 select-none">
          <div className="flex flex-col">
            {/* Console Logo */}
            <div className="p-6 border-b border-border bg-muted/20">
              <Link href="/" className="flex items-center gap-3">
                <Radio className="h-5 w-5 text-primary animate-pulse" />
                <span className="font-display font-bold text-base tracking-widest text-slate-100 uppercase">
                  SUTRADHAR
                </span>
              </Link>
              <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mt-1">
                Knowledge Intelligence
              </div>
            </div>

            {/* Menu Items */}
            <nav className="p-4 flex flex-col gap-1">
              <Link
                href="/"
                className="flex items-center gap-3 px-4 py-3 rounded text-xs font-semibold tracking-wider font-display text-slate-300 hover:bg-accent hover:text-slate-100 transition-all duration-150 group"
              >
                <LayoutDashboard className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                Dashboard
              </Link>

              <Link
                href="/ingestion"
                className="flex items-center gap-3 px-4 py-3 rounded text-xs font-semibold tracking-wider font-display text-slate-300 hover:bg-accent hover:text-slate-100 transition-all duration-150 group"
              >
                <Database className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                Ingestion Pipeline
              </Link>

              <Link
                href="/copilot"
                className="flex items-center gap-3 px-4 py-3 rounded text-xs font-semibold tracking-wider font-display text-slate-300 hover:bg-accent hover:text-slate-100 transition-all duration-150 group"
              >
                <MessageSquare className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                AI Copilot Chat
              </Link>

              <Link
                href="/graph-explorer"
                className="flex items-center gap-3 px-4 py-3 rounded text-xs font-semibold tracking-wider font-display text-slate-300 hover:bg-accent hover:text-slate-100 transition-all duration-150 group"
              >
                <Network className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                P&ID Graph Explorer
              </Link>
            </nav>
          </div>

          {/* Footer Terminal Info */}
          <div className="p-6 border-t border-border flex flex-col gap-1 text-[10px] font-mono text-muted-foreground bg-muted/10">
            <div>DB: Neo4j AuraDB</div>
            <div>Model: Gemini 2.5 Pro</div>
            <div className="flex items-center gap-1.5 mt-2">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-success animate-ping" />
              <span>OVERSEER LINK ONLINE</span>
            </div>
          </div>
        </aside>

        {/* ── Main Work Area ── */}
        {/* mobile-content-padding adds bottom space so content clears the tab bar */}
        <main className="flex-1 flex flex-col overflow-hidden relative lg:pb-0 mobile-content-padding">
          {children}
        </main>

        {/* ── Bottom Tab Bar (mobile + tablet only, hidden lg+) ── */}
        <BottomTabBar />
      </body>
    </html>
  );
}
