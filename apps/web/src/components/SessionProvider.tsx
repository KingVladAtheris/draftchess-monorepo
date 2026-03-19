// apps/web/src/components/SessionProvider.tsx
// Thin wrapper around next-auth/react SessionProvider.
// Must be a client component since SessionProvider uses React context.
// Wrap the root layout with this so any client component in the tree
// can call useSession() and get live session state.

"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

export default function SessionProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  return (
    <NextAuthSessionProvider session={session}>
      {children}
    </NextAuthSessionProvider>
  );
}
