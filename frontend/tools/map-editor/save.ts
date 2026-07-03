import type { ZoneTemplate } from "../../src/contract/zone";

/**
 * Thin POST client for `zone-write-middleware.ts`'s `POST
 * /__save-zone/:zoneId` (design.md Slice 3 task 3.4/3.6). Deliberately its
 * own tiny module — mirrors `texture-panel.ts`'s decoupled save flow
 * (own POST call, own result shape) rather than folding this into
 * `main.ts`, so the save wire format stays a single reviewable unit
 * independent of the DOM/canvas wiring.
 */

export interface SaveZoneError {
  instancePath: string;
  message: string;
}

export type SaveZoneResult = { ok: true } | { ok: false; errors: SaveZoneError[] };

export async function saveZone(zoneId: string, template: ZoneTemplate): Promise<SaveZoneResult> {
  const res = await fetch(`/__save-zone/${encodeURIComponent(zoneId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(template),
  });
  return (await res.json()) as SaveZoneResult;
}
