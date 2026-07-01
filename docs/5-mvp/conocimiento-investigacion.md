# MVP — Conocimiento e investigación

> Fuente: MVP Systems Spec §19 y §20.

## 19. Conocimiento MVP

Para MVP se puede usar un sistema liviano de flags.

```ts
type Knowledge = {
  id: string
  name: string
  kind: "idea" | "technique" | "discovery"
}
```

### Conocimientos iniciales posibles

```
idea_binding · tech_basic_binding · idea_crude_tool · tech_crude_toolmaking ·
idea_fire · discovery_fire_lit · idea_jungle_clearance
```

### Desbloqueos

| Flag | Se desbloquea al... | Pensamiento |
|---|---|---|
| `idea_binding` | tener fibra y rama; intentar usar fibra con rama | "Puedo unir piezas si las ato bien." |
| `tech_basic_binding` | crear la primera herramienta rudimentaria | "La fibra no solo sirve para guardar cosas. Sirve para construir." |
| `idea_fire` | recolectar ramas; ver restos secos; observar fogata construida | "Necesito fuego si quiero pasar la noche." |
| `idea_jungle_clearance` | observar jungla espesa | "Si pudiera cortar esto, tal vez encontraría un paso." |

> ✅ **Decidido (C5):** las flags evolucionarán a técnicas con nivel I/II/III más
> adelante (no en MVP). Ver [técnicas y herramientas](../1-diseno/tecnicas-herramientas.md).

## 20. Investigación MVP

Para el primer MVP la investigación puede ser mínima. No hace falta todavía un árbol
completo, pero sí conviene tener el primer concepto.

### Investigación: Contención de calor

```
Estado inicial: hidden
```

Se revela cuando: el jugador enciende fogata; coloca piedras cerca; prueba
barro/tierra con fuego (en futura iteración).

Para MVP puede quedar como **teaser**.

> "El fuego se escapa rápido. Quizás pueda contener mejor el calor."

Esto prepara el camino hacia horno primitivo, pero no necesariamente debe completarse
en esta vertical slice.

## Relacionado

- [Crafting e investigación (GDD)](../1-diseno/crafting-investigacion.md)
- [Modelo de datos (research)](../2-dominio/modelo-de-datos.md#conocimiento-investigación-y-técnicas)
- [Combinaciones ocultas](construcciones-combinaciones.md)
