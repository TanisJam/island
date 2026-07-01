// AUTOGENERADO desde schemas/commands.json — no editar a mano.

export type Command = MovePlayer | MoveItem | DropItem | TakeItem | ExecuteAction | Rest | Observe;

export interface CommandEnvelope {
  playerId: string;
  clientCommandId: string;
  command: Command;
}
export interface MovePlayer {
  type: "MovePlayer";
  to: Position;
}
export interface Position {
  x: number;
  y: number;
}
export interface MoveItem {
  type: "MoveItem";
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
      };
}
export interface DropItem {
  type: "DropItem";
  itemInstanceId: string;
  to: Position;
}
export interface TakeItem {
  type: "TakeItem";
  target:
    | {
        kind: "world_object";
        id: string;
      }
    | {
        kind: "tile";
        x: number;
        y: number;
      }
    | {
        kind: "item";
        id: string;
      }
    | {
        kind: "pile";
        id: string;
      }
    | {
        kind: "self";
      };
}
export interface ExecuteAction {
  type: "ExecuteAction";
  actionId: string;
  target:
    | {
        kind: "world_object";
        id: string;
      }
    | {
        kind: "tile";
        x: number;
        y: number;
      }
    | {
        kind: "item";
        id: string;
      }
    | {
        kind: "pile";
        id: string;
      }
    | {
        kind: "self";
      };
  inputHints?: string[];
}
export interface Rest {
  type: "Rest";
}
export interface Observe {
  type: "Observe";
  target:
    | {
        kind: "world_object";
        id: string;
      }
    | {
        kind: "tile";
        x: number;
        y: number;
      }
    | {
        kind: "item";
        id: string;
      }
    | {
        kind: "pile";
        id: string;
      }
    | {
        kind: "self";
      };
}
