// AUTOGENERADO desde schemas/events.json — no editar a mano.

export type Event =
  | PlayerMoved
  | ItemMoved
  | ActiveHandsChanged
  | ItemAddedToInventory
  | ItemRemovedFromInventory
  | ItemPlacedInWorld
  | ItemRemovedFromWorld
  | PileChanged
  | WorldObjectCreated
  | WorldObjectStateChanged
  | WorldObjectRemoved
  | TileChanged
  | TilesRevealed
  | EnergyChanged
  | ToolDamaged
  | ItemBroke
  | KnowledgeUnlocked
  | ThoughtAdded
  | ActionFailed
  | CombinationAttempted;
export type RejectionCode =
  | "out_of_range"
  | "not_walkable"
  | "no_path"
  | "insufficient_energy"
  | "missing_inputs"
  | "missing_knowledge"
  | "no_space"
  | "invalid_target"
  | "not_applicable";

export interface CommandResult {
  clientCommandId: string;
  accepted: boolean;
  events: Event[];
  rejection?: Rejection;
}
export interface PlayerMoved {
  type: "PlayerMoved";
  playerId: string;
  path: Position[];
  position: Position;
}
export interface Position {
  x: number;
  y: number;
}
export interface ItemMoved {
  type: "ItemMoved";
  itemInstanceId: string;
  to:
    | {
        type: "inventory";
        ownerId: string;
        x: number;
        y: number;
        rotation?: 0 | 90;
      }
    | {
        type: "hand";
        hand: "left" | "right";
      }
    | {
        type: "world";
        zoneId: string;
        x: number;
        y: number;
      }
    | {
        type: "container";
        containerId: string;
        x: number;
        y: number;
        rotation?: 0 | 90;
      }
    | {
        type: "surface";
        surfaceId: string;
        x: number;
        y: number;
        rotation?: 0 | 90;
      };
}
export interface ActiveHandsChanged {
  type: "ActiveHandsChanged";
  left?: string;
  right?: string;
}
export interface ItemAddedToInventory {
  type: "ItemAddedToInventory";
  item: ItemInstance;
}
export interface ItemInstance {
  id: string;
  itemTypeId: string;
  durability?: number;
  quality?: number;
  state?: {};
  location:
    | {
        type: "player_inventory";
        playerId: string;
        x: number;
        y: number;
        rotation: number;
      }
    | {
        type: "world";
        zoneId: string;
        x: number;
        y: number;
      }
    | {
        type: "container";
        containerId: string;
        x: number;
        y: number;
        rotation: number;
      }
    | {
        type: "machine_slot";
        machineId: string;
        slotId: string;
      }
    | {
        type: "pile";
        pileId: string;
      }
    | {
        type: "surface";
        surfaceId: string;
        x: number;
        y: number;
        rotation: number;
      };
}
export interface ItemRemovedFromInventory {
  type: "ItemRemovedFromInventory";
  itemInstanceId: string;
}
export interface ItemPlacedInWorld {
  type: "ItemPlacedInWorld";
  item: ItemInstance;
  position: Position;
}
export interface ItemRemovedFromWorld {
  type: "ItemRemovedFromWorld";
  itemInstanceId: string;
}
export interface PileChanged {
  type: "PileChanged";
  pile: Pile;
}
export interface Pile {
  id: string;
  itemTypeId: string;
  zoneId: string;
  position: Position;
  itemInstanceIds: string[];
}
export interface WorldObjectCreated {
  type: "WorldObjectCreated";
  object: WorldObject;
}
export interface WorldObject {
  id: string;
  objectTypeId: string;
  position: Position;
  state: {};
  tags?: string[];
  visibility?: "visible" | "hidden" | "discovered";
}
export interface WorldObjectStateChanged {
  type: "WorldObjectStateChanged";
  objectId: string;
  state: {};
}
export interface WorldObjectRemoved {
  type: "WorldObjectRemoved";
  objectId: string;
}
export interface TileChanged {
  type: "TileChanged";
  position: Position;
  /**
   * Terrain id, freely addable via the collections editor. Canonical seed ids: sand, grass, shallow_water, dense_jungle, dirt, rocky_ground.
   */
  terrain: string;
  walkable: boolean;
}
export interface TilesRevealed {
  type: "TilesRevealed";
  tiles: Tile[];
}
export interface Tile {
  x: number;
  y: number;
  /**
   * Terrain id, freely addable via the collections editor. Canonical seed ids: sand, grass, shallow_water, dense_jungle, dirt, rocky_ground.
   */
  terrain: string;
  walkable: boolean;
  tags: string[];
  visibility: "unseen" | "explored" | "visible";
}
export interface EnergyChanged {
  type: "EnergyChanged";
  energy: number;
}
export interface ToolDamaged {
  type: "ToolDamaged";
  itemInstanceId: string;
  durability: number;
}
export interface ItemBroke {
  type: "ItemBroke";
  itemInstanceId: string;
}
export interface KnowledgeUnlocked {
  type: "KnowledgeUnlocked";
  knowledgeId: string;
}
export interface ThoughtAdded {
  type: "ThoughtAdded";
  thought: Thought;
}
export interface Thought {
  id: string;
  text: string;
  kind: "observation" | "idea" | "discovery" | "warning" | "failure" | "memory" | "system";
  timestamp: number;
  relatedEntityId?: string;
  relatedSystem?: string;
}
export interface ActionFailed {
  type: "ActionFailed";
  actionId: string;
  thought?: Thought;
}
export interface CombinationAttempted {
  type: "CombinationAttempted";
  signature: string;
}
export interface Rejection {
  code: RejectionCode;
  thought?: Thought;
}
