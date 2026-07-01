# MVP — Mundo, recursos e items

> Fuente: MVP Systems Spec §12, §13 y §14. Tipos base en
> [modelo de datos](../2-dominio/modelo-de-datos.md).

## 12. Sistema de mundo

```ts
type Tile = {
  x: number
  y: number
  terrain: TerrainType
  walkable: boolean
  tags: string[]
  visibility: VisibilityState
}

type TerrainType =
  | "sand" | "grass" | "shallow_water"
  | "dense_jungle" | "dirt" | "rocky_ground"

type WorldObject = {
  id: string
  objectTypeId: string
  position: Position
  state: Record<string, unknown>
}

type WorldObjectType = {
  id: string
  name: string
  tags: string[]
  blocksMovement: boolean
  description: string
}
```

## 13. Recursos y objetos del mundo

Cada recurso define tags, un pensamiento de primer click y acciones según las manos.
Resumen:

| Objeto | Tags | Manos vacías | Herramienta rudimentaria | Hacha simple |
|---|---|---|---|---|
| **Árbol bajo** | `tree, wood_source, plant` | Arrancar ramas · Examinar · Acercarse | Cortar madera pobre · Desramar | Cortar madera · Talar parcialmente |
| **Pasto alto** | `grass, fiber_source, seed_source` | Rebuscar · Arrancar fibra | Cortar pasto · Recolectar fibra | — |
| **Piedra pequeña (suelo)** | `loose_item, stone, hard` | Recoger · Examinar | — | — |
| **Roca pequeña** | `rock, stone_source, hard` | Examinar · (Piedra en mano: Golpear) | Romper fragmentos | Golpear mal |
| **Restos de naufragio** | `wreckage, starter_resource, cloth_source, wood_source` | Rebuscar · Tirar de tela | Separar piezas · Cortar tela | — |
| **Jungla espesa** | `blocker, dense_jungle, progression_gate, plant` | Examinar | Cortar ramas superficiales | **Despejar camino** |
| **Agua baja** | `water, wet, resource` | Mojar manos · Examinar | — | (Recipiente futuro: Recolectar agua) |

**Despejar camino (hacha + jungla):** consume energía, consume durabilidad de hacha,
cambia tile `dense_jungle` → `grass/dirt`, revela nuevos tiles detrás.

> "Abrí un pequeño paso. La isla sigue más allá."

## 14. Items MVP

Cada item tiene `id`, `name`, `shape`, `properties` y `tags`. Definiciones:

```js
// Piedra pequeña
{ id: "small_stone", name: "Piedra pequeña", shape: { w: 1, h: 1 },
  properties: { hardness: 2, weight: 1, mineral: 1 },
  tags: ["stone", "hard", "tool_head_candidate"] }

// Rama seca
{ id: "dry_branch", name: "Rama seca", shape: { w: 1, h: 2 },
  properties: { wood: 1, fuel_value: 1, rigidity: 1, length: 2 },
  tags: ["wood", "stick", "fuel", "handle_candidate"] }

// Fibra vegetal
{ id: "plant_fiber", name: "Fibra vegetal", shape: { w: 1, h: 1 },
  properties: { flexibility: 2, binding: 2, organic: 1 },
  tags: ["fiber", "binding", "plant"] }

// Semilla silvestre
{ id: "wild_seed", name: "Semilla silvestre", shape: { w: 1, h: 1 },
  properties: { organic: 1, plantable: 1 },
  tags: ["seed", "food_future", "plant"] }

// Restos de tela
{ id: "cloth_scrap", name: "Restos de tela", shape: { w: 1, h: 1 },
  properties: { flexibility: 1, binding: 1, absorbent: 1 },
  tags: ["cloth", "binding", "wreckage"] }

// Madera pobre
{ id: "poor_wood", name: "Madera pobre", shape: { w: 1, h: 2 },
  properties: { wood: 2, structure: 1, fuel_value: 2 },
  tags: ["wood", "fuel", "structure"] }

// Corteza
{ id: "bark", name: "Corteza", shape: { w: 1, h: 2 },
  properties: { organic: 1, dry: 1, fuel_value: 1, fiber_like: 1 },
  tags: ["bark", "fuel", "plant"] }

// Herramienta rudimentaria
{ id: "crude_tool", name: "Herramienta rudimentaria", shape: { w: 1, h: 2 },
  properties: { cutting: 1, scraping: 1, leverage: 1 },
  durability: 20, tags: ["tool", "crude", "cutting"] }

// Hacha simple
{ id: "simple_axe", name: "Hacha simple", shape: { w: 1, h: 2 },
  properties: { cutting: 3, chopping: 3 },
  durability: 40, tags: ["tool", "axe", "cutting", "jungle_clear"] }
```

## Relacionado

- [Recursos del mundo y bloqueo (GDD)](../1-diseno/mundo-bloqueo-recursos.md)
- [Matriz de interacciones MVP](interaccion-matriz.md)
- [Modelo de datos (items)](../2-dominio/modelo-de-datos.md#objetos--items)
- [Catálogo data-driven (B2)](../PREGUNTAS.md#b2-itemtype-vs-iteminstance-catálogo-data-driven)
