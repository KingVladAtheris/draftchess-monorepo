// apps/web/src/app/profile/page.tsx
// Redirects /profile → /profile/[username] for the logged-in user.
// If not logged in, redirects to /login.
//
// Note: authorize() sets name = user.username, so session.user.name IS the username.

import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function ProfileRedirectPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const username = session.user.name;

  if (!username) {
    redirect("/");
  }

  redirect(`/profile/${username}`);
}
