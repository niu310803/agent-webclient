import {
  ALL_HISTORY_OWNERS,
  type HistoryOwnerKey,
  type HistoryOwnerOption,
} from "@/features/chats/lib/globalHistory";

export function readInitialHistoryOwnerKey(
  searchParams: URLSearchParams,
): HistoryOwnerKey {
  const agentKey = searchParams.get("agentKey")?.trim() ?? "";
  return agentKey ? `agent:${agentKey}` : ALL_HISTORY_OWNERS;
}

export function resolveLoadedHistoryOwnerKey(input: {
  ownerKey: HistoryOwnerKey;
  ownerOptions: HistoryOwnerOption[];
  loading: boolean;
}): HistoryOwnerKey {
  if (
    input.loading ||
    input.ownerKey === ALL_HISTORY_OWNERS ||
    input.ownerOptions.some((option) => option.key === input.ownerKey)
  ) {
    return input.ownerKey;
  }
  return ALL_HISTORY_OWNERS;
}
