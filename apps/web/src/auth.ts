// apps/web/src/auth.ts
import NextAuth, { type NextAuthResult } from "next-auth";
import type { NextAuthConfig }           from "next-auth";
import CredentialsProvider               from "next-auth/providers/credentials";
import { prisma }                        from "@draftchess/db";
import bcrypt                            from "bcrypt";
import { logger }                        from "@draftchess/logger";

const log = logger.child({ module: "web:auth" });

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

        // Basic format guards before hitting the DB
        const email    = (credentials.email as string).trim().toLowerCase();
        const password = credentials.password as string;

        if (!email || !password) return null;

        try {
          const user = await prisma.user.findUnique({
            where:  { email },
            select: { id: true, email: true, username: true, passwordHash: true, isBanned: true },
          });

          if (!user?.passwordHash) return null;

          // Banned users cannot log in
          if (user.isBanned) {
            log.warn({ userId: user.id }, "banned user attempted login");
            return null;
          }

          const isValid = await bcrypt.compare(password, user.passwordHash);
          if (!isValid) return null;

          return {
            id:    user.id.toString(),
            email: user.email,
            name:  user.username,
          };
        } catch (error) {
          log.error({ err: error }, "authorize error");
          return null;
        }
      },
    }),
  ],

  session: {
    strategy: "jwt",
    // Explicit session lifetime — 30 days, sliding
    maxAge:   30 * 24 * 60 * 60,
  },

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

const result: NextAuthResult = NextAuth(authConfig);

export const handlers: NextAuthResult["handlers"] = result.handlers;
export const auth:     NextAuthResult["auth"]     = result.auth;
export const signIn:   NextAuthResult["signIn"]   = result.signIn;
export const signOut:  NextAuthResult["signOut"]  = result.signOut;
