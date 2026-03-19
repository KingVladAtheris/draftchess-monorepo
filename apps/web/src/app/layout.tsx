// apps/web/src/app/layout.tsx
// CHANGE: Wrapped with ToastProvider so any client component in the tree
// can call useToast() without prop-drilling.
import type { Metadata } from "next";
import { Outfit, DM_Sans } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import SessionProvider from "@/components/SessionProvider";
import { ToastProvider } from "@/components/ToastProvider";
import { auth } from "@/auth";

const outfit = Outfit({
  subsets:  ["latin"],
  variable: "--font-display",
  display:  "swap",
  weight:   ["400", "500", "600", "700", "800"],
});

const dmSans = DM_Sans({
  subsets:  ["latin"],
  variable: "--font-body",
  display:  "swap",
  weight:   ["300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title:       "DraftChess",
  description: "Build your army. Outwit your opponent.",
  icons: { icon: "/favicon.ico" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <html lang="en" className={`${outfit.variable} ${dmSans.variable}`}>
      <body className="min-h-screen bg-[#0f1117] text-white antialiased">
        <SessionProvider session={session}>
          <ToastProvider>
            <Nav />
            <main>{children}</main>
          </ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
