// apps/web/src/app/api/signup/route.ts
import { prisma }                        from "@draftchess/db";
import bcrypt                            from "bcrypt";
import { NextRequest, NextResponse }     from "next/server";
import { consumeAuth, signupLimiter }    from "@/app/lib/rate-limit";
import { logger }                        from "@draftchess/logger";

const log = logger.child({ module: "web:signup" });

// Username: 2–32 chars, alphanumeric + underscores/hyphens, no leading/trailing
const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,30}[a-zA-Z0-9]$|^[a-zA-Z0-9]{1,2}$/;
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const limited = await consumeAuth(signupLimiter, request);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email, username, password } = body as Record<string, unknown>;

  if (typeof email !== "string" || typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const trimmedEmail    = email.trim().toLowerCase();
  const trimmedUsername = username.trim();

  // Email format
  if (!EMAIL_RE.test(trimmedEmail)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  // Username rules
  if (trimmedUsername.length < 2 || trimmedUsername.length > 32) {
    return NextResponse.json(
      { error: "Username must be between 2 and 32 characters" },
      { status: 400 },
    );
  }
  if (!USERNAME_RE.test(trimmedUsername)) {
    return NextResponse.json(
      { error: "Username may only contain letters, numbers, underscores, and hyphens" },
      { status: 400 },
    );
  }

  // Password complexity: min 8 chars, at least one letter and one number
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return NextResponse.json(
      { error: "Password must contain at least one letter and one number" },
      { status: 400 },
    );
  }

  try {
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email: trimmedEmail }, { username: trimmedUsername }] },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with those details already exists" },
        { status: 409 },
      );
    }

    const salt         = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    await prisma.user.create({
      data: { email: trimmedEmail, username: trimmedUsername, passwordHash },
    });

    log.info({ username: trimmedUsername }, "new user registered");

    return NextResponse.json({ message: "User created successfully" }, { status: 201 });
  } catch (error) {
    log.error({ err: error }, "signup error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
