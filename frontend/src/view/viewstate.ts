import type { Event, Position, Tile } from "../contract";
import type { Store } from "../state/store";
import type { ClientSnapshot } from "../state/snapshot";
import { chebyshev, euclid, forEachTileInVision, tileKey } from "../state/visibility";

export type Visibility = "unseen" | "explored" | "visible";

/**
 * Per-tile tween-duration constant (2nd playtest pass fix: "movement tween
 * has a FIXED duration regardless of distance"; 7th pass fix: "movement
 * should be slower" bumped this from 100 to 180 so walking reads
 * deliberately). Previously every tween used a single fixed `MOVE_MS` (200ms)
 * no matter how many tiles it covered — a far "ir hasta ahí" straight-line
 * move (design.md "Graceful Degradation": far movement is a straight-line
 * `MovePlayer`, no stepped tween) crossed many tiles in the SAME 200ms as an
 * adjacent 1-tile step, so it visually raced across the screen while the
 * 1-tile step looked comparatively slow. `tweenDurationFor` below multiplies
 * this per-tile constant by the tile distance so every tween moves at the
 * same constant tiles-per-second pace, clamped by `MIN_TWEEN_MS`/
 * `MAX_TWEEN_MS` so a 1-tile step never feels instant and a very long trek
 * never feels sluggish. This does NOT add real action-durations — it only
 * scales the existing tween easing/duration. Because movement is now tweened
 * leg-by-leg along `PlayerMoved.path` (see `buildLegs`), a multi-tile path's
 * total duration scales with its length automatically — one leg per waypoint,
 * each at this same per-tile pace. */
export const MS_PER_TILE = 180;
const MIN_TWEEN_MS = 100;
const MAX_TWEEN_MS = 600;

/** Node-safe guard, mirrors `render/canvas.ts`'s own copy — kept local
 * instead of importing across the presentation-layer boundary. When true,
 * movement and the vision field it drives should snap instantly rather than
 * animate (spec "Reduced motion respected"). */
function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface RenderEntity {
  id: string;
  kind: "player" | "object" | "item" | "pile";
  typeId: string;
  renderPos: Position; // interpolated float tile coords
  // Derived from the avatar's CURRENT interpolated tile (see `avatarTile()`
  // below), not the authoritative player position — fix: "vision field must
  // follow the moving avatar, not jump to the destination". Every entity
  // shares the same vision reference point as the tiles in `Frame.tiles`.
  visibility: Visibility;
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

/** One waypoint-to-waypoint segment of a tween in flight. */
type Leg = { from: Position; to: Position; duration: number };

type TweenEntity = {
  id: string;
  kind: RenderEntity["kind"];
  typeId: string;
  authoritativePos: Position; // == legs.at(-1).to once legs is non-empty; kept as its own field for readability
  renderPos: Position;
  legs: Leg[]; // remaining legs to walk, in order; empty once settled
  legElapsed: number; // elapsed within legs[0]
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

/** Tween duration for moving from `from` to `to`: constant per-tile speed
 * (`MS_PER_TILE`), using the same CHEBYSHEV metric as the rest of the
 * codebase (state/visibility.ts, actions/available.ts's "distance"
 * requirement), clamped to `[MIN_TWEEN_MS, MAX_TWEEN_MS]`. */
function tweenDurationFor(from: Position, to: Position): number {
  const distance = chebyshev(from, to);
  return Math.min(MAX_TWEEN_MS, Math.max(MIN_TWEEN_MS, distance * MS_PER_TILE));
}

/** Smoothstep. Eases in TIME so a leg doesn't feel mechanically linear.
 * Symmetric around t=0.5, which keeps the midpoint of a leg exactly at its
 * spatial midpoint. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Builds the leg sequence for a move from `startPos` to the final
 * authoritative `pos`. When `path` (the backend's A* route, `PlayerMoved.path`)
 * carries waypoints, the avatar tweens through EACH of them in order — one
 * leg per waypoint, `startPos -> path[0] -> path[1] -> ... -> pos` — instead
 * of a single straight-line lerp that could cut across obstacles/terrain
 * (fix: "movement must follow the real path"). Falls back to a single direct
 * leg when there's no path (e.g. a single-tile step never produces one, or
 * the caller is a non-player entity that never carries a path). Under
 * `prefers-reduced-motion`, always collapses to one zero-duration leg — an
 * instant snap, which also makes the vision field (derived from the same
 * interpolated position) snap instead of animate. */
function buildLegs(startPos: Position, pos: Position, path: Position[] | undefined): Leg[] {
  if (prefersReducedMotion()) return [{ from: startPos, to: pos, duration: 0 }];

  const waypoints = path && path.length > 0 ? path : [pos];
  const legs: Leg[] = [];
  let from = startPos;
  for (const to of waypoints) {
    legs.push({ from, to, duration: tweenDurationFor(from, to) });
    from = to;
  }
  return legs;
}

/**
 * Derived presentation layer between the `Store` and the `Renderer`
 * (design.md SEAM 3). `ViewState` OWNS the previous render position per
 * entity — the snapshot only ever carries the current authoritative
 * position, so `sync` remembers `renderPos` before redirecting a tween.
 *
 * LOAD-BEARING (spec "ViewState as Derived Presentation Layer" + tasks.md
 * 2.3, revised by the 7th playtest fix pass): per-tile and per-entity
 * `visibility` is computed here from the avatar's CURRENT INTERPOLATED tile
 * — not the authoritative snapshot position — via `renderedVisibility`, so the
 * fog/vision field visually follows the moving sprite instead of snapping to
 * the destination. The reference tile is only recomputed when it actually
 * changes (crosses a tile boundary), not every frame, to avoid boundary
 * shimmer and keep it cheap.
 *
 * `renderedVisibility` additionally gates "explored" by `revealedVisual`, a
 * presentation-only set of tiles the avatar's vision has actually swept (fix:
 * "fog must lift progressively as the avatar walks, not reveal a whole
 * destination area instantly on a far move") — see `revealedVisual` below.
 * `discovered` itself (the authoritative mirror) is untouched by this gate.
 * The `Renderer` must never call `visibilityOf`/`visibilityFrom` or receive a
 * `ClientSnapshot` — it only reads `Frame.tiles[].visibility` and
 * `Frame.entities[].visibility`.
 */
export function createViewState(store: Store): ViewState {
  const entities = new Map<string, TweenEntity>();
  let lastSnapshot: ClientSnapshot = store.getState();
  let clockMs = 0;

  // Fix: "movement must follow the real path" — captures the most recent
  // `PlayerMoved.path` per player id via the raw-events channel, consumed
  // (and cleared) the next time that entity's position is reconciled.
  const pendingPaths = new Map<string, Position[]>();
  // Presentation-only: tiles the interpolated avatar's vision has actually
  // swept (or that were explicitly revealed). Gates the "explored" render so
  // fog lifts progressively as the avatar walks, WITHOUT touching the
  // authoritative `discovered` mirror. Seeded with what is already explored
  // so a reload shows the known map immediately.
  const revealedVisual = new Set<string>(lastSnapshot.discovered);
  store.subscribeEvents((events: Event[]) => {
    for (const e of events) {
      if (e.type === "PlayerMoved") pendingPaths.set(e.playerId, e.path);
      if (e.type === "TilesRevealed") {
        for (const t of e.tiles) revealedVisual.add(tileKey(t.x, t.y));
      }
    }
  });

  // Fix: "vision field must follow the moving avatar" — the tile reference
  // used by `renderedVisibility` (see `frame()` below) for every visibility
  // check this frame. Updated only when the avatar's rounded (interpolated)
  // tile actually changes.
  let avatarTile: Position = lastSnapshot.player.position;

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
        renderPos: { ...pos },
        legs: [],
        legElapsed: 0,
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
      // the new starting point — no snap (tasks.md 2.2/2.4). Duration scales
      // with the actual distance of each leg, not a fixed constant — see
      // `tweenDurationFor`/`buildLegs`.
      const path = pendingPaths.get(id);
      pendingPaths.delete(id);
      existing.legs = buildLegs(existing.renderPos, pos, path);
      existing.legElapsed = 0;
      existing.authoritativePos = pos;
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
      // A full resync from the authoritative snapshot should immediately reveal
      // everything already explored; the movement-progressive reveal only applies
      // to live in-session discovery, not to a fresh authoritative snapshot.
      for (const k of snapshot.discovered) revealedVisual.add(k);
    },

    update(dt: number): void {
      clockMs += dt;
      for (const entity of entities.values()) {
        let remaining = dt;
        while (remaining > 0 && entity.legs.length > 0) {
          const leg = entity.legs[0]!;
          const legRemaining = leg.duration - entity.legElapsed;
          if (legRemaining <= 0) {
            // Zero-duration (or already-complete) leg: snap and advance
            // without consuming any of `remaining` — avoids an infinite loop
            // and makes the reduced-motion single-leg case instant.
            entity.renderPos = leg.to;
            entity.legs.shift();
            entity.legElapsed = 0;
            continue;
          }
          if (remaining < legRemaining) {
            entity.legElapsed += remaining;
            entity.renderPos = lerp(leg.from, leg.to, ease(entity.legElapsed / leg.duration));
            remaining = 0;
          } else {
            remaining -= legRemaining;
            entity.renderPos = leg.to;
            entity.legs.shift();
            entity.legElapsed = 0;
          }
        }
      }
    },

    frame(): Frame {
      const snapshot = lastSnapshot;

      const player = entities.get(snapshot.player.id);
      const avatarRenderPos = player ? player.renderPos : snapshot.player.position;
      const nextAvatarTile = { x: Math.round(avatarRenderPos.x), y: Math.round(avatarRenderPos.y) };
      if (!samePos(avatarTile, nextAvatarTile)) {
        avatarTile = nextAvatarTile;
        forEachTileInVision(snapshot, avatarTile, (k) => revealedVisual.add(k));
      }

      // Local visibility computation (replaces the old `visibilityFrom` call):
      // within `visionRadius` of the avatar's current interpolated tile is
      // "visible"; otherwise "explored" additionally requires the tile to be
      // in `revealedVisual` (swept by the avatar's vision or explicitly
      // revealed), so a far destination's fog lifts progressively as the
      // avatar walks instead of all at once when `discovered` gains it.
      const renderedVisibility = (pos: Position): Visibility => {
        if (euclid(avatarTile, pos) <= snapshot.visionRadius) return "visible";
        const key = tileKey(pos.x, pos.y);
        if (snapshot.discovered.has(key) && revealedVisual.has(key)) return "explored";
        return "unseen";
      };

      const tiles = snapshot.tiles.map((tile) => ({
        ...tile,
        visibility: renderedVisibility({ x: tile.x, y: tile.y }),
      }));

      const renderEntities: RenderEntity[] = [];
      for (const entity of entities.values()) {
        renderEntities.push({
          id: entity.id,
          kind: entity.kind,
          typeId: entity.typeId,
          renderPos: entity.renderPos,
          visibility: renderedVisibility(entity.authoritativePos),
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
