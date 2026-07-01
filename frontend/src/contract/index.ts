// Hand-written barrel for the generated contract types.
// `sync:contract` only ever overwrites `catalog.ts` / `commands.ts` / `events.ts` —
// never this file.
//
// IMPORTANT: both `commands.ts` and `events.ts` declare their own `Position`
// interface (structurally identical, but two distinct declarations). Never
// `export *` both modules together — TypeScript raises an ambiguous-export
// error on the duplicate `Position` name. `Position` is re-exported from
// EXACTLY ONE module (events.ts) and treated as canonical everywhere in the
// client.
export type { Position } from "./events";

export type {
  Event,
  CommandResult,
  ItemInstance,
  WorldObject,
  Tile,
  Pile,
  Thought,
  Rejection,
  RejectionCode,
  PlayerMoved,
  ItemMoved,
  ActiveHandsChanged,
  ItemAddedToInventory,
  ItemRemovedFromInventory,
  ItemPlacedInWorld,
  ItemRemovedFromWorld,
  PileChanged,
  WorldObjectCreated,
  WorldObjectStateChanged,
  WorldObjectRemoved,
  TileChanged,
  TilesRevealed,
  EnergyChanged,
  ToolDamaged,
  ItemBroke,
  KnowledgeUnlocked,
  ThoughtAdded,
  ActionFailed,
} from "./events";

export type {
  Command,
  CommandEnvelope,
  MovePlayer,
  MoveItem,
  DropItem,
  TakeItem,
  ExecuteAction,
  Rest,
  Observe,
} from "./commands";

export type {
  Catalog,
  ContextActionDef,
  TargetSelector,
  Requirement,
  Effect,
  InputSpec,
  ItemTypeDef,
  WorldObjectTypeDef,
  TerrainTypeDef,
  KnowledgeDef,
  ResearchDef,
  Shape,
  PropertyBag,
} from "./catalog";
