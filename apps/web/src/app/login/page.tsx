// apps/web/src/app/login/page.tsx
// Centered card on dark background. Clean, minimal.
// The form is the only thing on the page — no distractions.

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import LoginClient from "./LoginClient";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");
  return <LoginClient />;
}
