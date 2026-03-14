// src/app/lib/queue-join.ts
// Call this from your queue-join API route after setting queueStatus = 'queued'.
// It adds a 'try-match' job immediately so the matchmaker wakes up without
// waiting for a polling interval.

import { getMatchQueue } from "@/app/lib/queues";

export async function triggerMatchmaking(): Promise<void> {
  try {
    const q = getMatchQueue();
    // Add with a short delay so the DB write has committed before the worker reads it.
    // The job ID is time-based so multiple rapid joins each add their own job.
    await q.add("try-match", {}, { delay: 200 });
  } catch (err) {
    // Non-fatal — the matchmaker will still find the player on its next cycle
    console.error("[Queue] failed to add try-match job:", err);
  }
}
