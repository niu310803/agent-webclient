import {
  hasDesktopHostBridge,
  postDesktopHostMessage,
} from "@/shared/data/desktop/desktopHostBridge";
import { isDesktopAppMode } from "@/shared/utils/routing";

export const DESKTOP_HISTORY_OPEN_CHAT_REQUEST_TYPE =
  "desktop:agent-webclient:history-open-chat";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function requestDesktopHistoryOpenChat(input: {
  agentKey: string;
  chatId: string;
}): boolean {
  const agentKey = normalizeText(input.agentKey);
  const chatId = normalizeText(input.chatId);
  if (
    !agentKey ||
    !chatId ||
    typeof window === "undefined" ||
    !isDesktopAppMode() ||
    !hasDesktopHostBridge()
  ) {
    return false;
  }
  return postDesktopHostMessage({
    type: DESKTOP_HISTORY_OPEN_CHAT_REQUEST_TYPE,
    requestId: `desktop_history_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    agentKey,
    chatId,
  });
}
