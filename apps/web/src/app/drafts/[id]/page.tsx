// apps/web/src/app/drafts/[id]/page.tsx
// CHANGES:
//   - Fetches draft.mode alongside existing fields.
//   - Derives budget from mode via modeBudget().
//   - Passes mode and budget as props to ClientDraftEditor.

import { auth } from "@/auth";
import { prisma } from "@draftchess/db";
import { redirect } from "next/navigation";
import ClientDraftEditor from "./ClientDraftEditor";
import { modeBudget, type GameMode } from "@draftchess/shared/game-modes";

export default async function DraftEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id } = await params;

  const userId  = parseInt(session.user.id);
  const draftId = parseInt(id);

  const draft = await prisma.draft.findFirst({
    where: {
      id: draftId,
      userId,
    },
    select: {
      id:     true,
      fen:    true,
      points: true,
      name:   true,
      mode:   true,   // ← added
    },
  });

  if (!draft) {
    redirect("/drafts");
  }

  const mode   = (draft.mode ?? "standard") as GameMode;
  const budget = modeBudget(mode);

  return (
    <ClientDraftEditor
      initialFen={draft.fen}
      initialPoints={draft.points}
      draftId={draft.id}
      initialName={draft.name ?? ""}
      mode={mode}        // ← added
      budget={budget}    // ← added
    />
  );
}
