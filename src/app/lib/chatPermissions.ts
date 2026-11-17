import type { ChatAction, UserRole } from "../types";

const REVIEWER_ACTIONS: ChatAction["type"][] = [
  "open_review",
  "open_duplicate_compare",
  "filter_dashboard",
  "navigate_review_list",
  "confirm_score",
];

const VIEWER_ACTIONS: ChatAction["type"][] = [
  "open_review",
  "open_duplicate_compare",
  "filter_dashboard",
  "navigate_review_list",
];

export function filterActionsByRole(actions: ChatAction[] | undefined, role: UserRole): ChatAction[] {
  if (!actions?.length) return [];
  const allowed = role === "viewer" ? VIEWER_ACTIONS : REVIEWER_ACTIONS;
  return actions.filter(a => allowed.includes(a.type));
}

