// apps/web/src/app/play/royal/page.tsx
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";
import { redirect } from "next/navigation";
import SelectClient from "@/app/play/select/SelectClient";
import { MODE_CONFIG } from "@draftchess/shared/game-modes";

export default async function PlayPauperPage({
  searchParams,
}: {
  searchParams: Promise<{ challengeId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = parseInt(session.user.id);

  const cfg    = MODE_CONFIG["pauper"];
  const drafts = await prisma.draft.findMany({
    where:   { userId, mode: "pauper" },
    orderBy: { updatedAt: "desc" },
    select:  { id: true, name: true, points: true, updatedAt: true },
  });
  const { challengeId } = await searchParams;

  return <SelectClient drafts={drafts} mode="pauper" budget={cfg.draftBudget} isChallengeMode={!!challengeId} challengeId={challengeId ?? null}/>;
}
