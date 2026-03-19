// apps/web/src/app/signup/page.tsx
// Centered card on dark background. Clean, minimal.
// The form is the only thing on the page — no distractions.

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import SignupClient from "./SignupClient";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");
  return <SignupClient />;
}
