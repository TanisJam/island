# MVP — Interacción contextual y matriz de interacciones

> Fuente: MVP Systems Spec §17 y §18. Los tipos (`ContextAction`,
> `ActionRequirement`, `ActionEffect`) están en
> [interacción contextual (dominio)](../2-dominio/interaccion-contextual.md).

## 17. Generación de acciones

**Input:** target, distancia al target, items activos en manos, estado del target,
conocimientos descubiertos, energía.

**Output:** lista ordenada de acciones contextuales, acción principal, pensamiento de
preview.

> El detalle de los tipos y el reparto back/front está en
> [dominio](../2-dominio/interaccion-contextual.md) y
> [PREGUNTAS A3](../PREGUNTAS.md#a3--dónde-se-calculan-las-acciones-contextuales).

## 18. Matriz de interacciones MVP

### Árbol bajo

| Estado manos | Acción | Resultado |
|---|---|---|
| Vacías | Arrancar ramas | +rama seca, -energía |
| Piedra | Golpear con piedra | chance baja de rama/corteza, pensamiento |
| Fibra | Examinar/atar | pensamiento idea |
| Herramienta rudimentaria | Cortar madera pobre | +madera pobre, daño herramienta |
| Hacha simple | Cortar madera | +madera pobre mejor, daño hacha |

### Pasto alto

| Estado manos | Acción | Resultado |
|---|---|---|
| Vacías | Rebuscar | +fibra o semilla |
| Vacías | Arrancar fibra | +fibra |
| Herramienta rudimentaria | Cortar pasto | +más fibra, chance semilla |
| Hacha simple | Cortar | +fibra, no óptimo |

### Roca pequeña

| Estado manos | Acción | Resultado |
|---|---|---|
| Vacías | Examinar | pensamiento |
| Piedra | Golpear | +piedra pequeña chance, -energía |
| Herramienta rudimentaria | Romper fragmentos | +piedra pequeña, daño herramienta |
| Hacha simple | Golpear mal | pensamiento "no es para esto" |

### Restos de naufragio

| Estado manos | Acción | Resultado |
|---|---|---|
| Vacías | Rebuscar | +restos de tela o rama |
| Herramienta rudimentaria | Separar piezas | +madera pobre / tela |
| Piedra | Golpear | posible madera pobre, pensamiento |
| Fibra | Comparar/atar | idea de atadura |

### Jungla espesa

| Estado manos | Acción | Resultado |
|---|---|---|
| Vacías | Examinar | bloqueo |
| Herramienta rudimentaria | Cortar ramas superficiales | pensamiento, quizá fibra, no abre camino |
| Hacha simple | Despejar camino | cambia tile, revela zona |

### Tile vacío

| Estado manos | Acción | Resultado |
|---|---|---|
| Cualquiera | Caminar | mover |
| Item arrastrado | Soltar | item al mundo |
| Manos vacías en arena | Rebuscar | piedra/semilla chance |

## Relacionado

- [Interacción contextual (dominio)](../2-dominio/interaccion-contextual.md)
- [Recursos e items (MVP)](mundo-items.md)
- [Combinaciones ocultas](construcciones-combinaciones.md)
