// src/app/play/page.tsx — redirect to standard mode
import { redirect } from "next/navigation";
export default function PlayPage() {
  redirect("/play/standard");
}
