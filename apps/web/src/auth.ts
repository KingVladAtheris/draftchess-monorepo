// apps/web/src/auth.ts
import NextAuth, { type NextAuthResult } from "next-auth";
import type { NextAuthConfig }           from "next-auth";
import CredentialsProvider               from "next-auth/providers/credentials";
import { prisma }                        from "@draftchess/db";
import bcrypt                            from "bcrypt";

const authConfig: NextAuthConfig = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email:    { label: "Email",    type: "email"    },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        try {
          const user = await prisma.user.findUnique({
            where:  { email: credentials.email as string },
            select: { id: true, email: true, username: true, passwordHash: true },
          });

          if (!user?.passwordHash) return null;

          const isValid = await bcrypt.compare(
            credentials.password as string,
            user.passwordHash,
          );

          if (!isValid) return null;

          return {
            id:    user.id.toString(),
            email: user.email,
            name:  user.username,
          };
        } catch (error) {
          console.error("[auth] authorize error:", error);
          return null;
        }
      },
    }),
  ],

  session: { strategy: "jwt" },

  pages: { signIn: "/login" },

  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token?.id) session.user.id = token.id as string;
      return session;
    },
  },

  secret: process.env.AUTH_SECRET,
};

// Use NextAuthResult to annotate each export individually.
// Destructuring and letting TS infer causes "cannot be named without a reference
// to next-auth/lib internals" in pnpm monorepos. NextAuthResult is a stable
// public type that avoids the internal path reference entirely.
const result: NextAuthResult = NextAuth(authConfig);

export const handlers: NextAuthResult["handlers"] = result.handlers;
export const auth:     NextAuthResult["auth"]     = result.auth;
export const signIn:   NextAuthResult["signIn"]   = result.signIn;
export const signOut:  NextAuthResult["signOut"]  = result.signOut;