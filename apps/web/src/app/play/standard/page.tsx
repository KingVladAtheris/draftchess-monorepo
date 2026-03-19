// apps/web/src/app/play/standard/page.tsx
import { auth } from "@/auth";
import { prisma } from "@draftchess/db";
import { redirect } from "next/navigation";
import SelectClient from "@/app/play/select/SelectClient";
import { MODE_CONFIG } from "@draftchess/shared/game-modes";

export default async function PlayStandardPage({
  searchParams,
}: {
  searchParams: Promise<{ challengeId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = parseInt(session.user.id);

  const cfg    = MODE_CONFIG["standard"];
  const drafts = await prisma.draft.findMany({
    where:   { userId, mode: "standard" },
    orderBy: { updatedAt: "desc" },
    select:  { id: true, name: true, points: true, updatedAt: true },
  });
  const { challengeId } = await searchParams;

  return <SelectClient drafts={drafts} mode="standard" budget={cfg.draftBudget} isChallengeMode={!!challengeId} challengeId={challengeId ?? null}/>;
}
