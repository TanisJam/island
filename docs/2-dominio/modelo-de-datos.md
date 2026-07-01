# Modelo de datos

> Fuente: GDD v2 §13 y §30; MVP Spec §5, §9, §11, §12, §17, §19, §26.
> Los tipos están en TypeScript tal como en los documentos originales. Donde GDD y
> MVP difieren, se marca **(visión completa)** vs **(MVP)**.

Ver también la decisión sobre modelo rico vs plano:
[PREGUNTAS B1](../PREGUNTAS.md#b1--gdd-vs-mvp-modelo-completo-o-simplificado-primero).

---

## Jugador

```ts
type Player = {
  id: string
  name: string
  currentZoneId: string
  position: Position
  stats: PlayerStats
  inventoryId: string
  knownTechniques: PlayerTechnique[]
  researchState: PlayerResearchState[]
  discoveredFlags: string[]
  thoughtLog: Thought[]
}

type PlayerStats = {
  health: number
  maxHealth: number
  energy: number
  maxEnergy: number
}
```

## Mundo

```ts
type Zone = {
  id: string
  ownerPlayerId?: string
  type: "personal" | "shared" | "wild" | "gremio"
  width: number
  height: number
  tiles: Tile[]
  objects: WorldObject[]
}

type Tile = {
  x: number
  y: number
  terrain: string            // MVP: TerrainType (ver abajo)
  walkable: boolean
  tags: string[]
  discoveredByPlayerIds?: string[]
  // MVP añade: visibility: VisibilityState
}

type WorldObject = {
  id: string
  typeId: string             // GDD lo llama también objectTypeId
  zoneId: string
  position: Position
  state: Record<string, unknown>
  tags: string[]
  visibility: "visible" | "hidden" | "discovered"
}

// MVP
type TerrainType =
  | "sand"
  | "grass"
  | "shallow_water"
  | "dense_jungle"
  | "dirt"
  | "rocky_ground"

type WorldObjectType = {       // MVP: catálogo de tipos de objeto del mundo
  id: string
  name: string
  tags: string[]
  blocksMovement: boolean
  description: string
}
```

## Objetos / Items

```ts
// (visión completa) — GDD §13
type ItemType = {
  id: string
  name: string
  description: string
  category: ItemCategory
  shape: ItemShape
  baseProperties: ItemProperties
  tags: string[]
}

type ItemInstance = {
  id: string
  itemTypeId: string
  durability?: number
  quality?: number
  state?: Record<string, unknown>
  location: ItemLocation
}

type ItemLocation =
  | { type: "player_inventory"; playerId: string; x: number; y: number; rotation: number }
  | { type: "world"; zoneId: string; x: number; y: number }
  | { type: "container"; containerId: string; x: number; y: number; rotation: number }
  | { type: "machine_slot"; machineId: string; slotId: string }
  | { type: "pile"; pileId: string }
  | { type: "surface"; surfaceId: string; x: number; y: number; rotation: number }
```

**Propiedades** (no recetas exactas): `hardness`, `sharpness`, `flexibility`,
`fuel_value`, `heat_resistance`, `conductivity`, `weight`, `organic`, `mineral`,
`fibrous`, `wetness`, `dryness`, `edible`... Las propiedades permiten que un sistema
acepte distintos materiales sin exigir una receta exacta.

> En el **MVP** las propiedades viven inline en cada item y las formas son
> rectangulares (`1x1`, `1x2`, `1x3`, `1x4`, `2x2`). Ver
> [Items MVP](../5-mvp/mundo-items.md).

## Inventario

```ts
type InventoryGrid = {
  id: string
  ownerType: "player" | "container" | "machine" | "surface"
  ownerId: string
  width: number
  height: number
  handSlots?: {
    left: Position
    right: Position
  }
}
```

> `ownerType: "surface"` ahora tiene su variante `ItemLocation` correspondiente
> (arriba) — ya no hay contradicción entre ambos. En la rebanada actual, la
> grilla de una superficie (ej. la mesa rústica) NO está respaldada por un
> `InventoryGrid` genérico: vive como un registro liviano
> `GameState.inventories: Record<string, { width: number; height: number }>`
> indexado por el id del `WorldObject` (el `surfaceId`). `container` y
> `machine_slot` siguen sin implementar/diferidos.

```ts
// MVP
type Pile = {
  id: string
  itemTypeId: string
  zoneId: string
  position: Position
  itemInstanceIds: string[]
}
```

Inventario inicial: grilla `4x4`. La fila superior representa las manos
(`x--x`): los slots de las puntas son manos; los dos centrales permiten objetos
largos sostenidos con ambas manos. Ver
[Inventario físico](../1-diseno/inventario-fisico.md).

✅ **Decidido (B3):** se implementa **rotación 90° para objetos largos** (`1x2`,
`1x3`, `1x4`), **no** para `1x1`. La regla de "activo en mano" se mantiene como en
el MVP: activo si ocupa el slot `(0,0)` o `(3,0)`.

✅ **Decidido (B4):** una `Pile` es **sólo visual** por ahora (agrupamiento de
instancias del mismo tipo en un tile); no es una entidad persistente con lógica
propia.

## Pensamientos

```ts
type Thought = {
  id: string
  playerId: string           // MVP omite playerId en el type local
  text: string
  kind: ThoughtKind
  createdAt: string          // MVP: timestamp: number
  relatedEntityId?: string
  relatedSystem?: string     // sólo MVP
}

type ThoughtKind =
  | "observation"
  | "idea"
  | "discovery"
  | "warning"
  | "failure"   // GDD lo llama "failure"/"fallo útil"
  | "memory"
  | "system"    // sólo MVP (pero narrativo)
  | "social"    // sólo visión completa
```

## Conocimiento, investigación y técnicas

```ts
// (MVP) — sistema liviano de flags
type Knowledge = {
  id: string
  name: string
  kind: "idea" | "technique" | "discovery"
}

// (visión completa) — GDD §18–§19
type ResearchProject = {
  id: string
  name: string
  description: string
  status: "hidden" | "idea" | "active" | "completed"
  nodes: ResearchNode[]
  unlocks: Unlock[]
}

type ResearchNode = {
  id: string
  name: string
  description: string
  visible: boolean
  progress: number
  requiredProgress: number
  acceptedProperties: PropertyContributionRule[]
  unlocksOnComplete: string[]
}

type PropertyContributionRule = {
  property: string
  multiplier: number
  maxContributionPerItem?: number
  diminishingReturns?: boolean
}
```

Los nodos piden **propiedades**, no objetos exactos (ej. "Contención de calor"
acepta piedra, barro, ladrillo, cerámica, pero cada uno aporta distinto). Un fallo
puede aportar progreso de investigación.

## Máquinas

```ts
// (visión completa) — GDD §21
type MachineProject = {
  id: string
  name: string
  slots: FunctionalSlot[]
  prototypeResult: string
}

type FunctionalSlot = {
  id: string
  label: string
  requiredFunction: string
  acceptedProperties: string[]
  progress: number
  requiredProgress: number
}
```

Una máquina empieza como **proyecto funcional**: necesita resolver funciones
(superficie dura, movimiento repetido, eje, recipiente de salida), no una receta
`3 piedra + 2 madera + 1 cuerda`. La primera versión casi siempre es imperfecta
(prototipo → básica → automática).

## Acción contextual

El tipo `ContextAction` (motor de interacción) está documentado aparte en
[Interacción contextual](interaccion-contextual.md), porque es el núcleo del
gameplay y necesita su propia explicación.

## Estado global (referencia de implementación)

```ts
// MVP Spec §26 — agregado de runtime del backend
type GameState = {
  player: Player
  world: WorldState
  inventories: Record<string, InventoryGrid>
  items: Record<string, ItemInstance>
  piles: Record<string, Pile>
  thoughts: Thought[]
  knowledge: Set<string>
  selectedTarget?: TargetRef
}
```

## Relacionado

- [Sistemas](sistemas.md)
- [Interacción contextual](interaccion-contextual.md)
- [Separación backend / frontend](../3-backend-api/separacion-backend-frontend.md)
