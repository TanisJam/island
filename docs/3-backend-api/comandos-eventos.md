# Comandos y eventos

> El backend recibe **comandos** (intenciones del jugador) y responde con **eventos**
> (cambios autoritativos de estado). Implementa la decisión
> [A4](../PREGUNTAS.md#a4--protocolo-y-estilo-de-api). Tipos compartidos
> (`TargetRef`, `Location`, `Position`) y sobre/respuesta en
> [contrato-api.md](contrato-api.md).

## Principio

- Los comandos son **semánticos** (qué quiere hacer el jugador), nunca efectos
  crudos. El backend decide el resultado.
- Cada comando devuelve `Event[]`. El cliente los aplica para reconciliar su
  predicción optimista; ante `rejection`, revierte y muestra el pensamiento.
- Dos familias: **manipulación directa** (mover, drag & drop — el cliente predice) y
  **acciones de juego** (pueden fallar — el cliente espera confirmación).

---

## Catálogo de comandos

```ts
type Command =
  | MovePlayer
  | MoveItem
  | DropItem
  | TakeItem
  | ExecuteAction
  | Rest
  | Observe
```

### MovePlayer — manipulación directa

```ts
type MovePlayer = { type: "MovePlayer"; to: Position }
```

El backend calcula y valida el path autoritativo (A* sobre `walkable`,
[C3](../PREGUNTAS.md#c3--pathfinding-sin-camino)) y lo devuelve.

- **Emite:** `PlayerMoved`
- **Rechaza:** `not_walkable` (destino bloqueado), `no_path`
  (*"No puedo llegar allí desde aquí."*)

### MoveItem — manipulación directa (drag & drop dentro del inventario)

```ts
type MoveItem = { type: "MoveItem"; itemInstanceId: string; to: Location }
```

Cubre mover dentro de la grilla, poner/sacar de mano (`to.type === "hand"`) y rotar
(`to.rotation`). Cambiar a slot de mano recalcula las acciones contextuales del lado
cliente.

- **Emite:** `ItemMoved` (+ `ActiveHandsChanged` si cambió una mano)
- **Rechaza:** `no_space`, `invalid_target`

### DropItem — inventario → mundo

```ts
type DropItem = { type: "DropItem"; itemInstanceId: string; to: Position }
```

- **Emite:** `ItemRemovedFromInventory`, `ItemPlacedInWorld` (+ `PileChanged` si se
  agrupa visualmente)
- **Rechaza:** `out_of_range`, `not_walkable` (tile inválido para soltar)

### TakeItem — mundo / pila → inventario

```ts
type TakeItem = { type: "TakeItem"; target: TargetRef }  // kind "item" o "pile"
```

Para una pila, toma **una** instancia ([MVP](../5-mvp/inventario-dragdrop-pilas.md#interacciones-con-pila)).

- **Emite:** `ItemRemovedFromWorld` (o `PileChanged`), `ItemAddedToInventory`
- **Rechaza:** `out_of_range`, `no_space` (*"No tengo espacio para acomodarlo."*)

### ExecuteAction — acción de juego (la primitiva del gameplay)

```ts
type ExecuteAction = {
  type: "ExecuteAction"
  actionId: string          // id de un ContextActionDef del catálogo
  target: TargetRef
  inputHints?: string[]      // opcional: instancias para desambiguar inputs
}
```

El backend revalida `requirements`, resuelve `inputs` desde el estado autoritativo
(anti-cheat), tira `successChance` ajustado por energía
([C1](../PREGUNTAS.md#c1--vida-y-energía-en-mvp)) y aplica los `effects`.

- **Emite:** cualquier combinación de los eventos de efecto (ver mapeo abajo); si la
  tirada falla, `ActionFailed`.
- **Rechaza:** `out_of_range`, `insufficient_energy`, `missing_inputs`,
  `missing_knowledge`, `not_applicable`

### Rest — recuperar energía

```ts
type Rest = { type: "Rest" }
```

- **Emite:** `EnergyChanged` (+`ThoughtAdded` *"Respiro un momento. Puedo seguir."*).
  Recupera +30 ([MVP](../5-mvp/energia-durabilidad.md#recuperación)).

### Observe — desbloqueos por observación (opcional)

```ts
type Observe = { type: "Observe"; target: TargetRef }
```

El cliente lo envía la **primera vez** que observa algo que puede gatillar un
desbloqueo (ej. observar jungla espesa → `idea_jungle_clearance`). Observar en sí es
local y gratis; este comando sólo existe para consecuencias autoritativas.

- **Emite:** `KnowledgeUnlocked`, `ThoughtAdded` (o ninguno)
- **Rechaza:** nunca (no-op si no hay desbloqueo)

---

## Catálogo de eventos

```ts
type Event =
  // Movimiento
  | { type: "PlayerMoved"; playerId: string; path: Position[]; position: Position }
  // Inventario / items
  | { type: "ItemMoved"; itemInstanceId: string; to: Location }
  | { type: "ActiveHandsChanged"; left?: string; right?: string }   // itemInstanceIds
  | { type: "ItemAddedToInventory"; item: ItemInstance }
  | { type: "ItemRemovedFromInventory"; itemInstanceId: string }
  | { type: "ItemPlacedInWorld"; item: ItemInstance; position: Position }
  | { type: "ItemRemovedFromWorld"; itemInstanceId: string }
  | { type: "PileChanged"; pile: Pile }
  // Mundo
  | { type: "WorldObjectCreated"; object: WorldObject }
  | { type: "WorldObjectStateChanged"; objectId: string; state: Record<string, unknown> }
  | { type: "WorldObjectRemoved"; objectId: string }
  | { type: "TileChanged"; position: Position; terrain: TerrainType; walkable: boolean }
  | { type: "TilesRevealed"; tiles: Tile[] }
  // Jugador / herramientas / conocimiento
  | { type: "EnergyChanged"; energy: number }
  | { type: "ToolDamaged"; itemInstanceId: string; durability: number }
  | { type: "ItemBroke"; itemInstanceId: string }
  | { type: "KnowledgeUnlocked"; knowledgeId: string }
  | { type: "ThoughtAdded"; thought: Thought }
  // Resultado de acción
  | { type: "ActionFailed"; actionId: string; thought?: Thought }
```

`ItemInstance`, `WorldObject`, `Pile`, `Tile`, `Thought` →
[modelo de datos](../2-dominio/modelo-de-datos.md).

---

## Mapeo `Effect` → `Event`

Cómo cada [efecto del catálogo](catalogo.md#effect--resultado-autoritativo) se
materializa al ejecutar una acción:

| Effect | Evento(s) emitido(s) |
|---|---|
| `add_item` (to inventory) | `ItemAddedToInventory` |
| `add_item` (to ground) | `ItemPlacedInWorld` (+ `PileChanged`) |
| `consume_input` / `remove_target` | `ItemRemovedFromInventory` / `ItemRemovedFromWorld` / `WorldObjectRemoved` |
| `consume_energy` | `EnergyChanged` |
| `damage_active_tool` | `ToolDamaged` (+ `ItemBroke` si llega a 0) |
| `change_tile` | `TileChanged` |
| `reveal_around_target` | `TilesRevealed` |
| `set_target_state` | `WorldObjectStateChanged` |
| `create_world_object` | `WorldObjectCreated` |
| `unlock_knowledge` | `KnowledgeUnlocked` |
| `add_thought` | `ThoughtAdded` |

Además, toda acción con `thoughts.success`/`thoughts.fail` emite el `ThoughtAdded`
correspondiente, y un fallo de tirada emite `ActionFailed`.

## Mapeo comando → eventos posibles (resumen)

| Comando | Familia | Eventos típicos |
|---|---|---|
| `MovePlayer` | directa | `PlayerMoved` |
| `MoveItem` | directa | `ItemMoved`, `ActiveHandsChanged` |
| `DropItem` | directa | `ItemRemovedFromInventory`, `ItemPlacedInWorld`, `PileChanged` |
| `TakeItem` | directa | `ItemRemovedFromWorld`/`PileChanged`, `ItemAddedToInventory` |
| `ExecuteAction` | juego | según efectos (tabla de arriba) + `ThoughtAdded`/`ActionFailed` |
| `Rest` | juego | `EnergyChanged`, `ThoughtAdded` |
| `Observe` | juego | `KnowledgeUnlocked`, `ThoughtAdded` (o ninguno) |

## Reconciliación en el cliente

1. El cliente aplica el efecto **optimista** de los comandos de manipulación directa
   antes de la respuesta (mover personaje, mover item).
2. Al llegar `CommandResult`, aplica `events` en orden. Si coinciden con su
   predicción, no se nota nada.
3. Si hay `rejection`, **revierte** la predicción y muestra `rejection.thought`.
4. Para `ExecuteAction` no se predice el resultado (puede fallar): el cliente puede
   mostrar un estado "intentando…" y resolver con los eventos.

## Real-time (post-MVP)

> ✅ **A4:** con jugadores en la misma zona, estos mismos `Event[]` se **difunden por
> WebSocket** a los presentes, además de responder al emisor. El catálogo de comandos
> y eventos no cambia.

## Relacionado

- [Contrato de API](contrato-api.md)
- [Catálogo](catalogo.md)
- [Separación backend / frontend](separacion-backend-frontend.md)
- [Sistemas (qué módulo procesa qué)](../2-dominio/sistemas.md)
