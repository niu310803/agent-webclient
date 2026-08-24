import type { TranslateParams } from "@/shared/i18n";

type Translate = (key: string, params?: TranslateParams) => string;

export function formatResponseDuration(
  durationMs: number | undefined,
  t: Translate,
): string {
  if (!Number.isFinite(durationMs) || Number(durationMs) < 0) {
    return "";
  }

  const value = Number(durationMs);
  if (value < 1000) {
    return t("timeline.toolPill.duration.milliseconds", {
      count: Math.round(value),
    });
  }
  if (value < 60_000) {
    return t("timeline.toolPill.duration.seconds", {
      count: Number((value / 1000).toFixed(value >= 10_000 ? 0 : 1)),
    });
  }

  const totalSeconds = Math.round(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return t("timeline.toolPill.duration.minutes", { minutes, seconds });
  }

  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return t("timeline.responseDuration.hours", {
    hours,
    minutes: remainMinutes,
  });
}
