import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { ScanSearch } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/app/providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Investigation Assistant",
  description:
    "Organize and extract information from workplace investigation interview transcripts.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        <QueryProvider>
          <div className="min-h-screen bg-background">
            <header className="border-b">
              <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
                <Link
                  href="/"
                  className="flex items-center gap-2 font-semibold tracking-tight"
                >
                  <ScanSearch className="size-5" />
                  Investigation Assistant
                </Link>
              </div>
            </header>
            <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
          </div>
          <Toaster richColors position="top-center" />
        </QueryProvider>
      </body>
    </html>
  );
}
