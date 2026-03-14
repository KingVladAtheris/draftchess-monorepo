// src/app/drafts/standard/page.tsx — redirect to /drafts with mode anchor
// The drafts overview shows all modes in sections. Deep-linking to a mode
// redirects to the overview which scrolls to the right section via the anchor.
import { redirect } from "next/navigation";
export default function DraftsStandardPage() {
  redirect("/drafts#standard");
}
