// apps/web/src/app/drafts/page.tsx
// CHANGES:
//   - Drafts split into per-mode sections (Standard / Pauper / Royal) with anchor IDs.
//   - Each section has its own "New draft" button and correct point budget.
//   - Mode badges and budget bars are mode-aware.

import { auth } from "@/auth";
import { prisma } from "@draftchess/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { MODE_CONFIG, type GameMode } from "@draftchess/shared/game-modes";

type DraftOverviewItem = {
  id:        number;
  name:      string | null;
  points:    number;
  mode:      string;
  updatedAt: Date;
};

async function createNewDraft(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = parseInt(session.user.id);
  const rawMode = formData.get("mode") as string | null;
  const mode: GameMode = (rawMode === "pauper" || rawMode === "royal") ? rawMode : "standard";
  const newDraft = await prisma.draft.create({
    data: { userId, mode, fen: "8/8/8/8/8/8/8/4K3 w - - 0 1", points: 0 },
  });
  revalidatePath("/drafts");
  redirect(`/drafts/${newDraft.id}`);
}

function timeAgo(date: Date) {
  const d = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7)   return `${d}d ago`;
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const MODE_STYLE: Record<string, { badge: string; bar: string; border: string; heading: string; newBtn: string }> = {
  standard: {
    badge:   "bg-amber-500/15 text-amber-400 border-amber-500/25",
    bar:     "bg-amber-400/70",
    border:  "hover:border-amber-500/20",
    heading: "text-amber-400",
    newBtn:  "bg-amber-500/15 text-amber-400 border-amber-500/25 hover:bg-amber-500/25",
  },
  pauper: {
    badge:   "bg-sky-500/15 text-sky-400 border-sky-500/25",
    bar:     "bg-sky-400/70",
    border:  "hover:border-sky-500/20",
    heading: "text-sky-400",
    newBtn:  "bg-sky-500/15 text-sky-400 border-sky-500/25 hover:bg-sky-500/25",
  },
  royal: {
    badge:   "bg-purple-500/15 text-purple-400 border-purple-500/25",
    bar:     "bg-purple-400/70",
    border:  "hover:border-purple-500/20",
    heading: "text-purple-400",
    newBtn:  "bg-purple-500/15 text-purple-400 border-purple-500/25 hover:bg-purple-500/25",
  },
};

export default async function DraftsOverview() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const userId = parseInt(session.user.id);

  const allDrafts: DraftOverviewItem[] = await prisma.draft.findMany({
    where:   { userId },
    orderBy: { updatedAt: "desc" },
    select:  { id: true, name: true, points: true, mode: true, updatedAt: true },
  });

  const byMode = {
    standard: allDrafts.filter(d => !d.mode || d.mode === "standard"),
    pauper:   allDrafts.filter(d => d.mode === "pauper"),
    royal:    allDrafts.filter(d => d.mode === "royal"),
  };

  const modeEntries = Object.entries(MODE_CONFIG) as [GameMode, typeof MODE_CONFIG[GameMode]][];
  const totalDrafts = allDrafts.length;

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-8 py-10">
      {/* Page header */}
      <div className="flex items-center justify-between mb-10 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-800 text-white">My Drafts</h1>
          <p className="text-white/45 text-sm mt-1">
            {totalDrafts === 0 ? "No drafts yet" : `${totalDrafts} draft${totalDrafts !== 1 ? "s" : ""} across all modes`}
          </p>
        </div>
      </div>

      {/* Per-mode sections */}
      <div className="flex flex-col gap-14">
        {modeEntries.map(([mode, cfg]) => {
          const drafts = byMode[mode];
          const st = MODE_STYLE[mode];

          return (
            <section key={mode} id={mode}>
              {/* Section header */}
              <div className="flex items-center justify-between mb-5 gap-3">
                <div>
                  <h2 className={`font-display text-xl font-700 ${st.heading}`}>{cfg.label}</h2>
                  <p className="text-white/35 text-xs mt-0.5">{cfg.draftBudget}pt army · {cfg.auxPoints} aux pts</p>
                </div>
                <form action={createNewDraft}>
                  <input type="hidden" name="mode" value={mode} />
                  <button
                    type="submit"
                    className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${st.newBtn}`}
                  >
                    + New {cfg.label} draft
                  </button>
                </form>
              </div>

              {drafts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl border border-dashed border-white/8">
                  <p className="text-white/30 text-sm mb-1">No {cfg.label} drafts yet</p>
                  <p className="text-white/20 text-xs">Create one to start playing {cfg.label} matches.</p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {drafts.map((draft) => {
                    const budget = cfg.draftBudget;
                    return (
                      <div
                        key={draft.id}
                        className={`group relative p-5 rounded-2xl border border-white/8 bg-white/[0.02] hover:bg-white/[0.05] ${st.border} transition-all duration-200`}
                      >
                        <Link
                          href={`/drafts/${draft.id}`}
                          className="absolute inset-0 rounded-2xl"
                          aria-label={`Edit ${draft.name || `Draft #${draft.id}`}`}
                        />

                        <div className="flex items-start justify-between gap-2 mb-3">
                          <h3 className="font-display font-600 text-white group-hover:text-white/90 transition-colors truncate text-base">
                            {draft.name || `Draft #${draft.id}`}
                          </h3>
                          <span className="text-xs text-white/30 flex-shrink-0 mt-0.5">{timeAgo(draft.updatedAt)}</span>
                        </div>

                        {/* Budget bar */}
                        <div className="flex items-center gap-2 mb-3">
                          <div className="flex-1 h-0.5 rounded-full bg-white/8 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${st.bar}`}
                              style={{ width: `${Math.min(100, (draft.points / budget) * 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-white/35 tabular-nums flex-shrink-0">
                            {draft.points}/{budget}
                          </span>
                        </div>

                        {/* Delete button */}
                        <div className="relative z-10 flex justify-end">
                          <form
                            action={async () => {
                              "use server";
                              const s = await auth();
                              if (!s?.user?.id) return;
                              const uid = parseInt(s.user.id);

                              const activeGame = await prisma.game.findFirst({
                                where: {
                                  status: { in: ["active", "prep"] },
                                  OR: [{ draft1Id: draft.id }, { draft2Id: draft.id }],
                                },
                                select: { id: true },
                              });
                              if (activeGame) {
                                console.warn(`[Drafts] user ${uid} tried to delete draft ${draft.id} in active game ${activeGame.id}`);
                                return;
                              }

                              const userQueued = await prisma.user.findFirst({
                                where: { id: uid, queuedDraftId: draft.id },
                                select: { id: true },
                              });
                              if (userQueued) {
                                console.warn(`[Drafts] user ${uid} tried to delete draft ${draft.id} which is queued`);
                                return;
                              }

                              await prisma.draft.deleteMany({ where: { id: draft.id, userId: uid } });
                              revalidatePath("/drafts");
                            }}
                          >
                            <button
                              type="submit"
                              className="text-xs text-white/20 hover:text-red-400 transition-colors px-2 py-1 rounded"
                            >
                              Delete
                            </button>
                          </form>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
