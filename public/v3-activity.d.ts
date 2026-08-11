import type { V3FrontendActivityData } from "./v3-api.js";

export interface V3ActivityCardViewRow {
  title: string;
  label: string;
  timestamp: string;
  primary: string;
  secondary: string;
}

export interface V3ActivityCardView {
  emptyMessage: string;
  rows: V3ActivityCardViewRow[];
  footer: string;
}

export function v3ActivityRecordLabel(
  item: V3FrontendActivityData["items"][number],
  locale: "en-US" | "az-AZ"
): string;

export function createV3ActivityCardView(
  data: V3FrontendActivityData,
  locale: "en-US" | "az-AZ"
): V3ActivityCardView;
