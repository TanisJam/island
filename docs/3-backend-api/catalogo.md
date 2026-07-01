# Catálogo (contenido data-driven)

> El catálogo es **contenido autorizado, estático y versionado** que el backend sirve
> read-only en `GET /catalog`. Implementa la decisión
> [B2](../PREGUNTAS.md#b2-itemtype-vs-iteminstance-catálogo-data-driven): nada de
> reglas hardcodeadas — items, objetos, terrenos, conocimiento y **acciones** son
> data. Los tipos conceptuales viven en
> [modelo de datos](../2-dominio/modelo-de-datos.md) e
> [interacción contextual](../2-dominio/interaccion-contextual.md); acá está la forma
> **serializable y concreta** del contrato.

## Raíz del catálogo

```ts
type Catalog = {
  catalogVersion: string
  terrains: TerrainTypeDef[]
  items: ItemTypeDef[]
  worldObjects: WorldObjectTypeDef[]
  knowledge: KnowledgeDef[]
  actions: ContextActionDef[]     // interacción + crafting unificados
  research: ResearchDef[]         // mínimo en MVP (teaser)
}
```

> **Decisión de diseño:** interacción y crafting son **la misma primitiva**
> (`ContextActionDef`). "Cortar árbol" y "improvisar herramienta" sólo difieren en su
> selector de target y en de dónde salen sus inputs.

---

## TerrainTypeDef

```ts
type TerrainTypeDef = {
  id: TerrainType            // "sand" | "grass" | "shallow_water" | "dense_jungle" | "dirt" | "rocky_ground"
  name: string
  walkable: boolean
  tags: string[]
  observation?: string       // pensamiento de "primer click"; lo muestra el cliente LOCAL (A2)
}
```

```json
[
  { "id": "sand",          "name": "Arena",         "walkable": true,  "tags": ["ground", "searchable"] },
  { "id": "grass",         "name": "Pasto",         "walkable": true,  "tags": ["ground"] },
  { "id": "dirt",          "name": "Tierra",        "walkable": true,  "tags": ["ground", "diggable"] },
  { "id": "shallow_water", "name": "Agua baja",     "walkable": false, "tags": ["water", "wet"] },
  { "id": "rocky_ground",  "name": "Suelo rocoso",  "walkable": true,  "tags": ["ground", "hard"] },
  { "id": "dense_jungle",  "name": "Jungla espesa", "walkable": false, "tags": ["blocker", "progression_gate"] }
]
```

## ItemTypeDef

```ts
type ItemTypeDef = {
  id: string
  name: string
  description: string
  shape: { w: number; h: number }      // 1x1, 1x2, 1x3, 1x4, 2x2
  rotatable: boolean                    // ✅ B3: false para 1x1
  properties: Record<string, number>   // bolsa de propiedades (hardness, fuel_value, ...)
  tags: string[]
  durability?: number                   // sólo herramientas
  observation?: string                  // pensamiento de "primer click" (cliente local)
}
```

```json
{
  "id": "plant_fiber", "name": "Fibra vegetal",
  "description": "Fibras resistentes que se pueden trenzar o atar.",
  "shape": { "w": 1, "h": 1 }, "rotatable": false,
  "properties": { "flexibility": 2, "binding": 2, "organic": 1 },
  "tags": ["fiber", "binding", "plant"]
}
```

> La lista completa de items del MVP (con sus propiedades) está en
> [mundo-items.md §14](../5-mvp/mundo-items.md#14-items-mvp). Acá sólo se fija el
> **esquema**.

## WorldObjectTypeDef

Metadata del tipo de objeto del mundo. Las **interacciones** no viven acá: son
`ContextActionDef` que apuntan a este objeto por tags.

```ts
type WorldObjectTypeDef = {
  id: string
  name: string
  description: string
  tags: string[]
  blocksMovement: boolean
  states?: string[]                 // estados posibles, ej. ["unlit", "lit"]
  defaultState?: Record<string, unknown>
  observation?: string              // pensamiento de "primer click" por defecto (cliente local)
  observationByState?: Record<string, string>  // observación según estado, ej. { unlit, lit }
}
```

```json
{
  "id": "campfire", "name": "Fogata",
  "description": "Un lugar para mantener fuego.",
  "tags": ["station", "fire", "heat_source"],
  "blocksMovement": false,
  "states": ["unlit", "lit"],
  "defaultState": { "lit": false, "fuel": 0 }
}
```

## KnowledgeDef

```ts
type KnowledgeDef = {
  id: string
  name: string
  kind: "idea" | "technique" | "discovery"
  unlockOnObserveTags?: string[]    // observar un target con estos tags lo desbloquea (comando Observe)
  unlockThought?: string            // pensamiento al desbloquearse por observación
}
```

```json
[
  { "id": "idea_binding",         "name": "Atar",                 "kind": "idea" },
  { "id": "tech_basic_binding",   "name": "Atadura básica",       "kind": "technique" },
  { "id": "idea_crude_tool",      "name": "Improvisar herramienta","kind": "idea" },
  { "id": "tech_crude_toolmaking","name": "Herrería rudimentaria","kind": "technique" },
  { "id": "idea_fire",            "name": "Hacer fuego",          "kind": "idea" },
  { "id": "discovery_fire_lit",   "name": "Mantener el fuego",    "kind": "discovery" },
  { "id": "idea_jungle_clearance","name": "Despejar jungla",      "kind": "idea" }
]
```

---

## ContextActionDef (la primitiva central)

```ts
type ContextActionDef = {
  id: string
  label: string                      // texto del menú contextual
  priority: number                   // orden en el menú; la principal = mayor priority aplicable
  appliesTo: TargetSelector          // sobre qué target aparece
  requirements: Requirement[]        // condiciones de habilitación (gating)
  inputs?: InputSpec[]               // items a juntar/consumir del contexto (crafting)
  effects: Effect[]                  // resultado autoritativo
  successChance?: number             // 0..1, default 1 (ver energía/umbrales abajo)
  thoughts?: {
    preview?: string                 // al seleccionar (primer click)
    success?: string
    fail?: string                    // si successChance < 1 y falla
  }
}
```

### TargetSelector — sobre qué aparece la acción

```ts
type TargetSelector =
  | { kind: "world_object"; anyTags: string[] }   // ej. tags ["tree"]
  | { kind: "tile"; anyTerrain?: TerrainType[]; anyTags?: string[] }
  | { kind: "item"; anyTags: string[] }           // item suelto en el mundo
  | { kind: "self" }                              // sobre el personaje (descansar, etc.)
```

### Requirement — condiciones de habilitación

```ts
type Requirement =
  | { type: "distance"; max: number }
  | { type: "hand"; slot?: "left" | "right" | "any"; anyTags?: string[]; minProps?: Record<string, number> }
  | { type: "hand_empty"; slot: "left" | "right" | "any" }
  | { type: "knowledge"; knowledgeId: string }
  | { type: "energy"; min: number }
  | { type: "target_state"; key: string; value: unknown }
  | { type: "target_tag"; tag: string }
```

### InputSpec — items que se juntan del contexto (crafting)

Resuelve el pilar "combinar por contexto" ([C4](../PREGUNTAS.md#c4--combinaciones-ocultas-dónde-y-cómo-se-detectan)):
los inputs pueden venir de las manos, del suelo adyacente o de la superficie de una
estación. El backend resuelve **qué instancias concretas** matchean (autoritativo).

```ts
type InputSpec = {
  name: string                       // referenciado por los effects
  scope: ("hands" | "adjacent_ground" | "surface")[]
  match: { anyTags?: string[]; minProps?: Record<string, number> }
  count: number
  consume: boolean                   // si se gasta al ejecutar
}
```

`adjacent_ground` = tiles vecinos al jugador/target; `surface` = grilla de una
estación (mesa). Radio exacto de `adjacent_ground`: pendiente menor de
[C4](../PREGUNTAS.md#c4--combinaciones-ocultas-dónde-y-cómo-se-detectan).

### Effect — resultado autoritativo

Cada effect se traduce, al ejecutarse, en uno o más [eventos](comandos-eventos.md#catálogo-de-eventos).

```ts
type Effect =
  | { type: "add_item"; itemTypeId: string; to: "inventory" | "ground"; amount?: number; chance?: number }
  | { type: "consume_input"; input: string }              // gasta el InputSpec por nombre
  | { type: "remove_target" }
  | { type: "consume_energy"; amount: number }
  | { type: "damage_active_tool"; amount: number }
  | { type: "change_tile"; terrain: TerrainType }
  | { type: "reveal_around_target"; radius: number }
  | { type: "set_target_state"; key: string; value: unknown }
  | { type: "create_world_object"; objectTypeId: string; at: "target_tile" | "player_tile" }
  | { type: "unlock_knowledge"; knowledgeId: string }
  | { type: "add_thought"; text: string; kind: ThoughtKind }
```

### Energía y umbrales

> ✅ **C1:** `successChance` es la base; el backend la **penaliza por umbrales de
> energía baja** y puede aumentar la duración estimada. Sin energía suficiente para el
> `requirement.energy`, la acción se **rechaza** (no se ejecuta). No hay muerte en MVP.

El backend puede devolver un `durationMs` opcional como hint de animación; es
informativo, no autoritativo del resultado.

---

## Ejemplos de acciones (MVP, contenido real)

**1. Interacción simple — arrancar ramas con las manos:**

```json
{
  "id": "pull_branches", "label": "Arrancar ramas", "priority": 10,
  "appliesTo": { "kind": "world_object", "anyTags": ["tree"] },
  "requirements": [
    { "type": "distance", "max": 1 },
    { "type": "hand_empty", "slot": "any" },
    { "type": "energy", "min": 1 }
  ],
  "effects": [
    { "type": "consume_energy", "amount": 1 },
    { "type": "add_item", "itemTypeId": "dry_branch", "to": "inventory" }
  ],
  "thoughts": { "preview": "Veo ramas secas. Podría arrancar algunas con las manos." }
}
```

**2. Crafting por contexto — improvisar herramienta rudimentaria:**

```json
{
  "id": "improvise_crude_tool", "label": "Improvisar herramienta", "priority": 50,
  "appliesTo": { "kind": "tile", "anyTags": ["ground"] },
  "requirements": [{ "type": "distance", "max": 1 }],
  "inputs": [
    { "name": "head",   "scope": ["hands", "adjacent_ground", "surface"], "match": { "anyTags": ["tool_head_candidate"] }, "count": 1, "consume": true },
    { "name": "handle", "scope": ["hands", "adjacent_ground", "surface"], "match": { "anyTags": ["handle_candidate"] },    "count": 1, "consume": true },
    { "name": "binder", "scope": ["hands", "adjacent_ground", "surface"], "match": { "minProps": { "binding": 1 } },        "count": 1, "consume": true }
  ],
  "effects": [
    { "type": "consume_input", "input": "head" },
    { "type": "consume_input", "input": "handle" },
    { "type": "consume_input", "input": "binder" },
    { "type": "unlock_knowledge", "knowledgeId": "tech_basic_binding" },
    { "type": "add_item", "itemTypeId": "crude_tool", "to": "inventory" }
  ],
  "thoughts": {
    "preview": "Creo que podría improvisar una herramienta.",
    "success": "No es una gran herramienta, pero es mejor que mis manos."
  }
}
```

**3. Desbloqueo de conocimiento primero (sin crear item) — idea de atar:**

```json
{
  "id": "discover_binding", "label": "Probar a atar", "priority": 40,
  "appliesTo": { "kind": "world_object", "anyTags": ["tree", "stick"] },
  "requirements": [
    { "type": "distance", "max": 1 },
    { "type": "hand", "slot": "any", "minProps": { "binding": 1 } },
    { "type": "knowledge", "knowledgeId": "idea_binding" }
  ],
  "effects": [
    { "type": "unlock_knowledge", "knowledgeId": "idea_binding" },
    { "type": "add_thought", "text": "Puedo unir piezas si las ato bien.", "kind": "idea" }
  ]
}
```

> Nota: la *idea* `idea_binding` se desbloquea por **observación/contexto**; recién
> después habilita el crafting del ejemplo 2. Ver
> [conocimiento MVP](../5-mvp/conocimiento-investigacion.md).

**4. Con azar — encender fogata:**

```json
{
  "id": "light_campfire", "label": "Intentar encender", "priority": 60,
  "appliesTo": { "kind": "world_object", "anyTags": ["fire"] },
  "requirements": [
    { "type": "distance", "max": 1 },
    { "type": "target_state", "key": "lit", "value": false },
    { "type": "hand", "slot": "any", "anyTags": ["tool", "stone"] },
    { "type": "energy", "min": 2 }
  ],
  "inputs": [
    { "name": "fuel", "scope": ["surface", "adjacent_ground"], "match": { "minProps": { "fuel_value": 1 } }, "count": 1, "consume": true }
  ],
  "successChance": 0.6,
  "effects": [
    { "type": "consume_energy", "amount": 2 },
    { "type": "consume_input", "input": "fuel" },
    { "type": "set_target_state", "key": "lit", "value": true },
    { "type": "unlock_knowledge", "knowledgeId": "discovery_fire_lit" }
  ],
  "thoughts": {
    "success": "El fuego prendió. Por primera vez desde que desperté, tengo un punto al que volver.",
    "fail": "Casi prende, pero todavía no entiendo bien cómo mantenerlo."
  }
}
```

**5. Cambiar el mundo y abrir camino — despejar jungla:**

```json
{
  "id": "clear_jungle", "label": "Despejar camino", "priority": 70,
  "appliesTo": { "kind": "tile", "anyTerrain": ["dense_jungle"] },
  "requirements": [
    { "type": "distance", "max": 1 },
    { "type": "hand", "slot": "any", "anyTags": ["jungle_clear"] },
    { "type": "energy", "min": 10 }
  ],
  "effects": [
    { "type": "consume_energy", "amount": 10 },
    { "type": "damage_active_tool", "amount": 8 },
    { "type": "change_tile", "terrain": "dirt" },
    { "type": "reveal_around_target", "radius": 3 }
  ],
  "thoughts": {
    "preview": "La vegetación es demasiado cerrada. No voy a poder pasar empujando.",
    "success": "Abrí un pequeño paso. La isla no termina acá."
  }
}
```

Estos cinco casos cubren los modos que el MVP necesita: recolectar, craftear por
contexto, desbloquear conocimiento, azar, y mutar el mundo. La
[matriz de interacciones](../5-mvp/interaccion-matriz.md) se traduce 1:1 a entradas de
`actions`.

---

## ResearchDef (mínimo en MVP)

```ts
type ResearchDef = {
  id: string
  name: string
  status: "hidden" | "idea" | "active" | "completed"
  revealedBy?: string[]            // ids de eventos/condiciones que lo revelan
  teaserThought?: string
}
```

```json
{
  "id": "heat_containment", "name": "Contención de calor", "status": "hidden",
  "revealedBy": ["discovery_fire_lit"],
  "teaserThought": "El fuego se escapa rápido. Quizás pueda contener mejor el calor."
}
```

El modelo rico de research (`ResearchNode`, `PropertyContributionRule`) se incorpora
en MVP 0.3; ver [modelo de datos](../2-dominio/modelo-de-datos.md#conocimiento-investigación-y-técnicas)
y [B1](../PREGUNTAS.md#b1--gdd-vs-mvp-modelo-completo-o-simplificado-primero).

## Autoría y versionado

- El catálogo se autora como **JSON**, una colección por archivo, en
  [`/catalog`](../../catalog/) (raíz del repo). El backend lo carga en SQLite/memoria
  al iniciar ([A1](../PREGUNTAS.md#a1--el-mvp-usa-backend-o-es-cliente-puro)) y lo
  ensambla en la respuesta de `GET /catalog`.
- **Contenido MVP autorado:** [`catalog/`](../../catalog/) — `terrains.json`,
  `items.json`, `world-objects.json`, `knowledge.json`, `actions.json`,
  `research.json`, `meta.json`.
- `observation` lo muestra el **cliente local** al seleccionar (no hace round-trip);
  sólo el comando `Observe` reporta al backend para desbloqueos por observación.
- Cualquier cambio de contenido sube `catalogVersion`. El cliente refetchea cuando el
  `catalogVersion` del snapshot difiere del cacheado.

## Relacionado

- [Contrato de API](contrato-api.md)
- [Comandos y eventos](comandos-eventos.md)
- [Interacción contextual (dominio)](../2-dominio/interaccion-contextual.md)
- [Matriz de interacciones MVP](../5-mvp/interaccion-matriz.md)
- [Items MVP](../5-mvp/mundo-items.md)
