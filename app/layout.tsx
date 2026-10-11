import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { KeyProvider } from "@/components/kit/KeyProvider";
import { THEME_INIT_SCRIPT } from "@/components/kit/ThemeToggle";
import { TopoBackground } from "@/components/TopoBackground";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Powder Index: Utah snow, ranked every morning",
  description:
    "A daily powder ranking for twelve Utah ski resorts, built from public SNOTEL and National Weather Service data with dbt and DuckDB. Ask the data a question in plain English.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
        >
          Skip to content
        </a>
        <TopoBackground />
        <KeyProvider>{children}</KeyProvider>
      </body>
    </html>
  );
}
