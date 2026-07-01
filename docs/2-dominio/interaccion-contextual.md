# Sistema de interacción contextual

> Fuente: GDD v2 §14 y MVP Spec §17.
> Es el **núcleo del gameplay**: convierte el contexto físico en acciones posibles.

## Generador de acciones

Las acciones disponibles se calculan a partir de:

```
target + distancia + manos + herramienta + conocimiento + estado del objeto = acciones
```

**Input** (MVP): target, distancia al target, items activos en manos, estado del
target, conocimientos descubiertos, energía.

**Output:** lista ordenada de acciones contextuales + acción principal + pensamiento
de preview.

## Acción contextual

```ts
// (visión completa) — GDD §14.2
type ContextAction = {
  id: string
  label: string
  priority: number
  requiredDistance: number
  requiredHeldProperties?: string[]
  requiredHeldItems?: string[]
  requiredKnowledge?: string[]
  targetTags?: string[]
  effect: ActionEffect
  thoughtOnPreview?: string
  thoughtOnSuccess: string
  thoughtOnFail?: string
}
```

En el **MVP** el tipo se aplana un poco y usa listas explícitas de requisitos y
efectos:

```ts
// (MVP) — MVP Spec §17
type ContextAction = {
  id: string
  label: string
  priority: number
  requiredDistance: number
  requirements: ActionRequirement[]
  effects: ActionEffect[]
  previewThought?: string
  successThought?: string
  failureThought?: string
}

type ActionRequirement =
  | { type: "distance"; max: number }
  | { type: "held_item"; itemTypeId: string }
  | { type: "held_property"; property: string; minValue: number }
  | { type: "knowledge"; knowledgeId: string }
  | { type: "energy"; amount: number }
  | { type: "target_state"; key: string; value: unknown }

type ActionEffect =
  | { type: "add_item"; itemTypeId: string; amount?: number }
  | { type: "remove_item"; itemInstanceId: string }
  | { type: "consume_energy"; amount: number }
  | { type: "damage_tool"; amount: number }
  | { type: "change_tile"; terrain: TerrainType }
  | { type: "change_object_state"; key: string; value: unknown }
  | { type: "create_world_object"; objectTypeId: string }
  | { type: "unlock_knowledge"; knowledgeId: string }
  | { type: "add_thought"; text: string; kind: ThoughtKind }
```

## Acción principal

Cada contexto debe tener una acción principal (la que ejecuta el segundo/tercer
click). Ejemplos:

```
Árbol + manos vacías:   acción principal = arrancar ramas.
Árbol + hacha:          acción principal = cortar.
Roca + pico:            acción principal = picar.
Fogata + carbón:        acción principal = añadir combustible.
Tile vacío + item en mano: acción principal = soltar/colocar.
```

Esto permite jugar con doble click sin abrir menús excesivos.

## Menú contextual

El menú debe aparecer **cerca del objeto o tile seleccionado**, no abajo. El mismo
target ofrece acciones distintas según las manos:

```
Árbol bajo                Árbol bajo (piedra en mano)   Árbol bajo (hacha en mano)
──────────                ───────────────────────────   ──────────────────────────
Arrancar ramas            Golpear con piedra            Cortar
Examinar                  Raspar corteza                Desramar
Acercarse                 Examinar                      Examinar
```

## Por qué importa para la arquitectura

Este motor es **autoritativo en el backend**: define qué se puede hacer y qué pasa
al hacerlo, incluyendo las **combinaciones ocultas** (anti-cheat). El cliente puede
recalcular el *preview* localmente para que el menú aparezca sin latencia, pero la
**ejecución** la valida el backend. Ver
[separación back/front](../3-backend-api/separacion-backend-frontend.md) y
[PREGUNTAS A3](../PREGUNTAS.md#a3--dónde-se-calculan-las-acciones-contextuales).

## Relacionado

- [Control mouse-only](../1-diseno/control-mouse.md)
- [Matriz de interacciones MVP](../5-mvp/interaccion-matriz.md)
- [Crafting e investigación](../1-diseno/crafting-investigacion.md)
