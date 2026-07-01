# Catálogo MVP — contenido data-driven

Contenido **autorado** que el backend sirve read-only en `GET /catalog`
(decisión [B2](../docs/PREGUNTAS.md#b2-itemtype-vs-iteminstance-catálogo-data-driven)).
Esquema y semántica en
[`docs/3-backend-api/catalogo.md`](../docs/3-backend-api/catalogo.md).

## Archivos

| Archivo | Colección | Contenido |
|---|---|---|
| `meta.json` | — | `catalogVersion` y lista de colecciones |
| `terrains.json` | `terrains` | 6 terrenos (sand, grass, dirt, shallow_water, rocky_ground, dense_jungle) |
| `items.json` | `items` | 9 items del MVP (§14 del MVP Spec) con propiedades y formas |
| `world-objects.json` | `worldObjects` | tipos de objeto del mundo (árbol, pasto, roca, naufragio, fogata, mesa) |
| `knowledge.json` | `knowledge` | 7 flags de conocimiento (idea / technique / discovery) |
| `actions.json` | `actions` | acciones contextuales unificadas (interacción + crafting) |
| `research.json` | `research` | teaser de investigación (Contención de calor) |

El backend ensambla estos archivos en una única respuesta `Catalog`
(con `catalogVersion` desde `meta.json`).

## Cómo lo consume cada lado

- **Backend:** carga estos JSON en SQLite/memoria al iniciar
  ([A1](../docs/PREGUNTAS.md#a1--el-mvp-usa-backend-o-es-cliente-puro)); valida
  `ExecuteAction` contra `actions`; resuelve `inputs`, tira `successChance` y aplica
  `effects` como [eventos](../docs/3-backend-api/comandos-eventos.md).
- **Frontend:** consume el catálogo para nombres, formas, tamaños de sprite y para
  mostrar la `observation` **local** al seleccionar (sin round-trip). Recalcula el
  *preview* del menú con la copia de las reglas de `actions`.

## Versionado

`meta.json.catalogVersion` sube ante cualquier cambio de contenido. El cliente
compara contra el `catalogVersion` del snapshot de zona y refetchea si difiere.

## La cadena jugable del MVP (cómo encaja el contenido)

```
arrancar ramas / rebuscar fibra / recoger piedra
  → discover_binding (idea_binding)
  → improvise_crude_tool  → crude_tool  (+ tech_basic_binding, tech_crude_toolmaking)
  → cut_tree_crude        → poor_wood, bark
  → build_campfire        → campfire    (+ idea_fire)
  → light_campfire (0.6)  → fogata lit  (+ discovery_fire_lit) → teaser heat_containment
  → build_table           → rustic_table
  → craft_simple_axe      → simple_axe
  → clear_jungle          → tile dirt + reveal  (cierre del MVP)
```

## Flags reservadas (sin trigger en MVP)

- `idea_crude_tool`: el backend puede desbloquearla heurísticamente al sostener un
  `tool_head_candidate` junto a un `handle_candidate` (no vía acción del catálogo).
  Queda definida porque es parte del set de conocimiento del diseño.

## Pendientes menores

- Radio exacto de `adjacent_ground` / `surface` para resolver `inputs`
  ([C4](../docs/PREGUNTAS.md#c4--combinaciones-ocultas-dónde-y-cómo-se-detectan)).
- Tabla de loot más rica que `chance` por item (post-MVP).
- `light_log` (Tronco 1x4) aparece en los tamaños de inventario pero no es obtenible
  en el MVP: no se incluye como item autorado todavía.
