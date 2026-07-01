// AUTOGENERADO desde schemas/catalog.json — no editar a mano.

export type TargetSelector =
  | {
      kind: "world_object";
      anyTags: string[];
    }
  | {
      kind: "tile";
      anyTerrain?: ("sand" | "grass" | "shallow_water" | "dense_jungle" | "dirt" | "rocky_ground")[];
      anyTags?: string[];
    }
  | {
      kind: "item";
      anyTags: string[];
    }
  | {
      kind: "self";
    };
export type Requirement =
  | {
      type: "distance";
      max: number;
    }
  | {
      type: "hand";
      slot?: "left" | "right" | "any";
      anyTags?: string[];
      minProps?: PropertyBag;
    }
  | {
      type: "hand_empty";
      slot: "left" | "right" | "any";
    }
  | {
      type: "knowledge";
      knowledgeId: string;
    }
  | {
      type: "energy";
      min: number;
    }
  | {
      type: "target_state";
      key: string;
      value: unknown;
    }
  | {
      type: "target_tag";
      tag: string;
    };
export type Effect =
  | {
      type: "add_item";
      itemTypeId: string;
      to: "inventory" | "ground";
      amount?: number;
      chance?: number;
    }
  | {
      type: "consume_input";
      input: string;
    }
  | {
      type: "remove_target";
    }
  | {
      type: "consume_energy";
      amount: number;
    }
  | {
      type: "damage_active_tool";
      amount: number;
    }
  | {
      type: "change_tile";
      terrain: "sand" | "grass" | "shallow_water" | "dense_jungle" | "dirt" | "rocky_ground";
    }
  | {
      type: "reveal_around_target";
      radius: number;
    }
  | {
      type: "set_target_state";
      key: string;
      value: unknown;
    }
  | {
      type: "create_world_object";
      objectTypeId: string;
      at: "target_tile" | "player_tile";
    }
  | {
      type: "unlock_knowledge";
      knowledgeId: string;
    }
  | {
      type: "add_thought";
      text: string;
      kind: "observation" | "idea" | "discovery" | "warning" | "failure" | "memory" | "system";
    };

export interface Catalog {
  catalogVersion: string;
  terrains: TerrainTypeDef[];
  items: ItemTypeDef[];
  worldObjects: WorldObjectTypeDef[];
  knowledge: KnowledgeDef[];
  actions: ContextActionDef[];
  research: ResearchDef[];
}
export interface TerrainTypeDef {
  id: "sand" | "grass" | "shallow_water" | "dense_jungle" | "dirt" | "rocky_ground";
  name: string;
  walkable: boolean;
  tags: string[];
  observation?: string;
}
export interface ItemTypeDef {
  id: string;
  name: string;
  description: string;
  shape: Shape;
  rotatable: boolean;
  properties: PropertyBag;
  tags: string[];
  durability?: number;
  observation?: string;
}
export interface Shape {
  w: number;
  h: number;
}
export interface PropertyBag {
  [k: string]: number;
}
export interface WorldObjectTypeDef {
  id: string;
  name: string;
  description: string;
  tags: string[];
  blocksMovement: boolean;
  states?: string[];
  defaultState?: {};
  surfaceGrid?: Shape;
  observation?: string;
  observationByState?: {
    [k: string]: string;
  };
}
export interface KnowledgeDef {
  id: string;
  name: string;
  kind: "idea" | "technique" | "discovery";
  unlockOnObserveTags?: string[];
  unlockThought?: string;
}
export interface ContextActionDef {
  id: string;
  label: string;
  priority: number;
  appliesTo: TargetSelector;
  requirements: Requirement[];
  inputs?: InputSpec[];
  /**
   * @minItems 1
   */
  effects: [Effect, ...Effect[]];
  successChance?: number;
  thoughts?: {
    preview?: string;
    success?: string;
    fail?: string;
  };
}
export interface InputSpec {
  name: string;
  /**
   * @minItems 1
   */
  scope: ["hands" | "adjacent_ground" | "surface", ...("hands" | "adjacent_ground" | "surface")[]];
  match: {
    anyTags?: string[];
    minProps?: PropertyBag;
  };
  count: number;
  consume: boolean;
}
export interface ResearchDef {
  id: string;
  name: string;
  status: "hidden" | "idea" | "active" | "completed";
  revealedBy?: string[];
  teaserThought?: string;
}
