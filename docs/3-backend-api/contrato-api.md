# Contrato de API

> Propuesta de contrato entre el **backend autoritativo** y cualquier **frontend**.
> Implementa las decisiones [A1–A6](../PREGUNTAS.md#a-arquitectura-backend--frontend-lo-más-importante).
> Detalle del catálogo en [catalogo.md](catalogo.md) y de comandos/eventos en
> [comandos-eventos.md](comandos-eventos.md).
>
> **Forma machine-readable:** el JSON Schema (draft-07) validable de todo este
> contrato vive en [`/schemas`](../../schemas/) — valida el catálogo real con `ajv` y
> genera tipos TS/Swift/Kotlin para cualquier front.

## Principios del contrato

- **JSON sobre HTTP** (WebSocket recién post-MVP para tiempo real en la misma zona).
- **Lectura por snapshot** (estado actual) + **escritura por comando→evento**.
- El backend es **autoritativo**: el cliente nunca decide reglas ni efectos.
- El contrato es **agnóstico de UI**: no expone px, sprites ni layout.
- **Versionado**: el contenido estático (catálogo) se versiona aparte del estado.

## Endpoints

| Método | Ruta | Devuelve | Cacheable |
|---|---|---|---|
| `GET` | `/catalog` | [`Catalog`](catalogo.md#raíz-del-catálogo) (contenido estático) | sí, por `catalogVersion` |
| `GET` | `/zones/{zoneId}` | `ZoneSnapshot` | no (estado vivo) |
| `GET` | `/players/{playerId}/state` | `PlayerState` | no |
| `POST` | `/commands` | `CommandResult` | no |

> El MVP es de **una sola zona personal**; aun así modelamos `zoneId` y `playerId`
> desde el principio ([A5](../PREGUNTAS.md#a5--modelo-de-mundo-por-jugador-o-compartido)).

### Snapshots de lectura

```ts
type ZoneSnapshot = {
  zone: Zone                  // id, ownerPlayerId?, type, width, height
  tiles: Tile[]               // con visibility por jugador ya resuelta
  objects: WorldObject[]      // sólo los visibles/explorados para el jugador
  piles: Pile[]               // agrupamiento visual (B4)
  worldItems: ItemInstance[]  // items sueltos en el suelo de la zona
  catalogVersion: string      // para que el cliente valide su catálogo cacheado
}

type PlayerState = {
  player: Player              // id, name, currentZoneId, position, stats
  inventory: InventoryGrid    // grilla 4x4 con handSlots
  items: ItemInstance[]       // instancias en inventario y manos
  knowledge: string[]         // flags conocidas (idea_*, tech_*, discovery_*)
  thoughtLog: Thought[]
}
```

Los tipos `Zone`, `Tile`, `WorldObject`, `Pile`, `ItemInstance`, `Player`,
`InventoryGrid`, `Thought` están en
[modelo de datos](../2-dominio/modelo-de-datos.md).

## Tipos compartidos del contrato

```ts
type Position = { x: number; y: number }

// Cómo el cliente referencia un objetivo de comando/acción
type TargetRef =
  | { kind: "world_object"; id: string }
  | { kind: "tile"; x: number; y: number }
  | { kind: "item"; id: string }      // instancia (en mundo o inventario)
  | { kind: "pile"; id: string }
  | { kind: "self" }                  // el personaje / inventario propio

// Destino para mover un item (drag & drop)
type Location =
  | { type: "inventory"; ownerId: string; x: number; y: number; rotation?: 0 | 90 }
  | { type: "hand"; hand: "left" | "right" }   // azúcar: mapea a slot (0,0)/(3,0)
  | { type: "world"; zoneId: string; x: number; y: number }
  | { type: "container"; containerId: string; x: number; y: number; rotation?: 0 | 90 }
```

> ✅ **B3:** `rotation` sólo aplica a objetos largos (`1x2`/`1x3`/`1x4`), no a `1x1`.
> ✅ **B5:** las posiciones del mundo son **por tile** (no píxeles); los IDs los
> genera el backend (el cliente usa temp-ids en su predicción).

## POST /commands — sobre/respuesta

El cliente envía **un comando** (o una pequeña secuencia) y recibe los **eventos**
autoritativos que debe aplicar para reconciliar su predicción.

```ts
// Request
type CommandEnvelope = {
  playerId: string
  clientCommandId: string     // idempotencia + correlación con la predicción local
  command: Command            // ver comandos-eventos.md
}

// Response (HTTP 200)
type CommandResult = {
  clientCommandId: string
  accepted: boolean
  events: Event[]             // aplicar en orden para reconciliar
  rejection?: Rejection       // presente si accepted === false
}

type Rejection = {
  code: RejectionCode
  thought?: Thought           // mensaje en primera persona para el HUD
}

type RejectionCode =
  | "out_of_range"
  | "not_walkable"
  | "no_path"
  | "insufficient_energy"
  | "missing_inputs"
  | "missing_knowledge"
  | "no_space"
  | "invalid_target"
  | "not_applicable"
```

## Modelo de errores

Dos niveles distintos, a propósito:

| Tipo | Transporte | Ejemplo | Quién lo muestra |
|---|---|---|---|
| **Error de protocolo** | HTTP `4xx/5xx` | payload malformado, jugador inexistente, no autorizado | manejo técnico del cliente |
| **Rechazo de dominio** | HTTP `200` + `rejection` | fuera de rango, sin energía, sin path | el HUD, como **pensamiento en primera persona** |

Esto mantiene el feedback del juego en su voz. Ej. sin energía →
`rejection.thought = "Estoy demasiado cansado para hacer eso ahora."`; sin path
([C3](../PREGUNTAS.md#c3--pathfinding-sin-camino)) →
`"No puedo llegar allí desde aquí."`

## Flujo cliente ↔ backend

```
1. Boot:    GET /catalog (cachea por versión) · GET /zones/{id} · GET /players/{id}/state
2. Observar/seleccionar/menú: 100% local (datos ya visibles), sin red
3. Acción latency-sensitive (mover, drag&drop): el cliente PREDICE y muestra ya
4. POST /commands  →  CommandResult
5. El cliente APLICA los events (reconciliación); si hay rejection, revierte la
   predicción y muestra el pensamiento
```

Detalle de predicción y reparto de autoridad en
[separación backend / frontend](separacion-backend-frontend.md).

## Versionado

- `catalogVersion`: cambia cuando cambia el contenido autorizado (items, objetos,
  acciones, conocimiento). El cliente compara el `catalogVersion` del snapshot con su
  catálogo cacheado y refetchea si difiere. Formato sugerido: entero monótono o
  semver (`"1.4.0"`). Decisión fina pendiente en
  [B2](../PREGUNTAS.md#b2-itemtype-vs-iteminstance-catálogo-data-driven).
- El **estado** (zona/jugador) nunca se cachea entre sesiones del lado cliente como
  fuente de verdad: siempre se parte del snapshot.

## Autenticación (placeholder)

Fuera de alcance del MVP single-player. Reservar un encabezado/token de sesión que
resuelva el `playerId` del lado servidor en vez de confiar en el del payload, antes
de habilitar multiplayer.

## Real-time (post-MVP)

> ✅ **A4:** al entrar la capa social, los `Event[]` que hoy responden a un comando se
> **difunden por WebSocket** a los jugadores presentes en la **misma zona**. El modelo
> comando→evento no cambia; sólo se agrega el transporte de difusión.

## Relacionado

- [Catálogo (contenido data-driven)](catalogo.md)
- [Comandos y eventos](comandos-eventos.md)
- [Separación backend / frontend](separacion-backend-frontend.md)
- [Modelo de datos](../2-dominio/modelo-de-datos.md)
