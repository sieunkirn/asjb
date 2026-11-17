import { isScoringApiError } from "../../api/scoring";

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function errorText(e: unknown, fallback: string): string {
  if (isScoringApiError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}
