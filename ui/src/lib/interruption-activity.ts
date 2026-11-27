import type { TaskInterruptionPresentation } from "@paperclipai/shared";

export function interruptionShowsAgentWorking(
  interruption: Pick<TaskInterruptionPresentation, "state" | "retryWait"> | null | undefined,
): boolean {
  return interruption?.state === "working" && !interruption.retryWait;
}
