// apps/web/src/app/page.tsx
// Home page — communicates the Draft Chess game loop at a glance.
// Z-pattern layout: logo/headline top-left, board motif top-right,
// game loop steps centre, single CTA bottom-right of the Z.

import Link from "next/link";
import { auth } from "@/auth";
import HomeClient from "./HomeClient";

export default async function Home() {
  const session = await auth();
  const user    = session?.user ?? null;

  return <HomeClient user={user} />;
}
