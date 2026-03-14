// src/app/api/signup/route.ts
// CHANGE: uses consumeAuth (fail-closed) instead of consume.
import { prisma } from "@draftchess/db";
import bcrypt from "bcrypt";
import { NextRequest } from "next/server";
import { consumeAuth, signupLimiter } from "@/app/lib/rate-limit";

export async function POST(request: NextRequest) {
  const limited = await consumeAuth(signupLimiter, request); // keyed by IP
  if (limited) return limited;

  try {
    const { email, username, password } = await request.json();

    if (!email || !username || !password) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400 }
      );
    }

    if (username.length < 2 || username.length > 32) {
      return new Response(
        JSON.stringify({ error: "Username must be between 2 and 32 characters" }),
        { status: 400 }
      );
    }

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });

    if (existingUser) {
      return new Response(
        JSON.stringify({ error: "An account with those details already exists" }),
        { status: 409 }
      );
    }

    const salt         = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    await prisma.user.create({
      data: { email, username, passwordHash },
    });

    return new Response(
      JSON.stringify({ message: "User created successfully" }),
      { status: 201 }
    );
  } catch (error) {
    console.error("Signup error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}
