import type { AppState, ChatTransition } from "@/app/state/types";

export function isChatTransitionPending(
  transition: ChatTransition | null | undefined,
): boolean {
  return Boolean(
    transition &&
      (transition.phase === "loading" ||
        transition.phase === "applying" ||
        transition.phase === "restoring"),
  );
}

export function isChatTransitionBlockingInteractions(
  transition: ChatTransition | null | undefined,
): boolean {
  if (!transition) return false;
  if (transition.phase === "error") return true;
  return transition.displayMode !== "background" &&
    isChatTransitionPending(transition);
}

export function isCurrentChatTransition(
  state: Pick<AppState, "chatTransition">,
  seq: number,
  targetChatId: string,
): boolean {
  const transition = state.chatTransition;
  return Boolean(
    transition &&
      transition.seq === seq &&
      transition.targetChatId === String(targetChatId || "").trim(),
  );
}
