// apps/web/src/types/next-auth.d.ts
//
// next-auth v5 + pnpm monorepo type augmentation fix.
//
// The problem: pnpm doesn't hoist @auth/core into the top-level node_modules.
// It lives in .pnpm/@auth+core@x.x.x/node_modules/@auth/core instead.
// TypeScript's module augmentation requires the module to be resolvable by
// the compiler, and it can't find it through the normal node_modules path.
//
// The fix: augment "next-auth" and "next-auth/jwt" only (not "@auth/core/jwt"),
// and ensure this file is included via tsconfig "include".
// next-auth re-exports its JWT types from its own subpath, which IS resolvable.

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }

  // Extend the User interface so token.id = user.id works without casting
  interface User {
    id: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
  }
}