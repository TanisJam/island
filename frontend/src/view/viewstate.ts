import type { Position, Tile } from "../contract";
import type { Store } from "../state/store";
import type { ClientSnapshot } from "../state/snapshot";
import { visibilityOf } from "../state/visibility";

export type Visibility = "unseen" | "explored" | "visible";

/** Tween duration for an entity moving between two tiles. Resolves design.md's
 * open question ("MOVE_MS tween duration constant") — not architectural, just
 * a reasonable default for a single-tile step at the game's pace. Bumped from
 * the original 120ms (playtest feedback: movement felt too fast/mechanical);
 * kept modest — this only softens the tween easing/duration, it does NOT add
 * real action-durations (that's a separate, future change). */
export const MOVE_MS = 200;

export interface RenderEntity {
  id: string;
  kind: "player" | "object" | "item" | "pile";
  typeId: string;
  renderPos: Position; // interpolated float tile coords
  visibility: Visibility; // derived from the AUTHORITATIVE position, never renderPos
  count?: number; // piles
  state?: Record<string, unknown>; // objects (e.g. campfire lit)
}

export interface Frame {
  zone: { width: number; height: number };
  tiles: (Tile & { visibility: Visibility })[]; // discrete, visibility attached here
  entities: RenderEntity[]; // interpolated; visibility attached, NOT pre-culled
  clockMs: number; // global anim clock (bob/FX)
}

export interface ViewState {
  update(dt: number): void;
  sync(snapshot: ClientSnapshot): void;
  frame(): Frame;
}

type TweenEntity = {
  id: string;
  kind: RenderEntity["kind"];
  typeId: string;
  authoritativePos: Position; // == targetPos; kept as its own field for readability
  fromPos: Position;
  targetPos: Position;
  renderPos: Position;
  elapsed: number;
  duration: number;
  count?: number;
  state?: Record<string, unknown>;
};

function samePos(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

function lerp(a: Position, b: Position, t: number): Position {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Smoothstep. Movement stays a straight line in SPACE (no path waypoints —
 * `PlayerMoved.path` tweening is deferred, see design.md "Open Questions"),
 * but eases in TIME so it doesn't feel mechanically linear. Symmetric around
 * t=0.5, which keeps the midpoint of a tween exactly at the spatial midpoint. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Derived presentation layer between the `Store` and the `Renderer`
 * (design.md SEAM 3). `ViewState` OWNS the previous render position per
 * entity — the snapshot only ever carries the current authoritative
 * position, so `sync` remembers `renderPos` before redirecting a tween.
 *
 * LOAD-BEARING (spec "ViewState as Derived Presentation Layer" + tasks.md
 * 2.3): per-tile and per-entity `visibility` is computed here from the
 * AUTHORITATIVE snapshot position via the existing `visibilityOf`, never
 * from `renderPos`. The `Renderer` must never call `visibilityOf` or receive
 * a `ClientSnapshot` — it only reads `Frame.tiles[].visibility` and
 * `Frame.entities[].visibility`.
 */
export function createViewState(store: Store): ViewState {
  const entities = new Map<string, TweenEntity>();
  let lastSnapshot: ClientSnapshot = store.getState();
  let clockMs = 0;

  function upsert(
    id: string,
    kind: RenderEntity["kind"],
    typeId: string,
    pos: Position,
    extra: { count?: number; state?: Record<string, unknown> },
  ): void {
    const existing = entities.get(id);
    if (!existing) {
      // New entity: spawns at the authoritative position, no tween (matches
      // "spawn new entities at authoritative pos" — tasks.md 2.2).
      entities.set(id, {
        id,
        kind,
        typeId,
        authoritativePos: pos,
        fromPos: pos,
        targetPos: pos,
        renderPos: { ...pos },
        elapsed: MOVE_MS,
        duration: MOVE_MS,
        count: extra.count,
        state: extra.state,
      });
      return;
    }

    existing.typeId = typeId;
    existing.count = extra.count;
    existing.state = extra.state;
    if (!samePos(existing.authoritativePos, pos)) {
      // Mid-tween redirect: remember the CURRENT interpolated renderPos as
      // the new starting point — no snap (tasks.md 2.2/2.4).
      existing.fromPos = existing.renderPos;
      existing.targetPos = pos;
      existing.authoritativePos = pos;
      existing.elapsed = 0;
      existing.duration = MOVE_MS;
    }
  }

  function reconcile(snapshot: ClientSnapshot): void {
    const seen = new Set<string>();

    const track = (id: string, kind: RenderEntity["kind"], typeId: string, pos: Position, extra: { count?: number; state?: Record<string, unknown> } = {}): void => {
      seen.add(id);
      upsert(id, kind, typeId, pos, extra);
    };

    track(snapshot.player.id, "player", "player", snapshot.player.position);

    for (const obj of snapshot.objects) {
      track(obj.id, "object", obj.objectTypeId, obj.position, { state: obj.state as Record<string, unknown> });
    }

    // Items grouped into a pile become ONE pile entity (+ count), not N
    // overlapping item entities — mirrors the pile-vs-item skip logic that
    // used to live in render/canvas.ts.
    const piledItemIds = new Set(snapshot.piles.flatMap((p) => p.itemInstanceIds));
    for (const pile of snapshot.piles) {
      track(pile.id, "pile", pile.itemTypeId, pile.position, { count: pile.itemInstanceIds.length });
    }
    for (const item of snapshot.items) {
      if (item.location.type !== "world") continue;
      if (piledItemIds.has(item.id)) continue;
      track(item.id, "item", item.itemTypeId, { x: item.location.x, y: item.location.y });
    }

    for (const id of [...entities.keys()]) {
      if (!seen.has(id)) entities.delete(id);
    }

    lastSnapshot = snapshot;
  }

  reconcile(store.getState());
  store.subscribe(reconcile);

  return {
    sync(snapshot: ClientSnapshot): void {
      reconcile(snapshot);
    },

    update(dt: number): void {
      clockMs += dt;
      for (const entity of entities.values()) {
        if (entity.elapsed >= entity.duration) {
          entity.renderPos = entity.targetPos;
          continue;
        }
        entity.elapsed = Math.min(entity.elapsed + dt, entity.duration);
        const t = entity.duration === 0 ? 1 : clamp01(entity.elapsed / entity.duration);
        entity.renderPos = lerp(entity.fromPos, entity.targetPos, ease(t));
      }
    },

    frame(): Frame {
      const snapshot = lastSnapshot;
      const tiles = snapshot.tiles.map((tile) => ({
        ...tile,
        visibility: visibilityOf(snapshot, { x: tile.x, y: tile.y }),
      }));

      const renderEntities: RenderEntity[] = [];
      for (const entity of entities.values()) {
        renderEntities.push({
          id: entity.id,
          kind: entity.kind,
          typeId: entity.typeId,
          renderPos: entity.renderPos,
          visibility: visibilityOf(snapshot, entity.authoritativePos),
          count: entity.count,
          state: entity.state,
        });
      }

      return {
        zone: { width: snapshot.zone.width, height: snapshot.zone.height },
        tiles,
        entities: renderEntities,
        clockMs,
      };
    },
  };
}
