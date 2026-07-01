# MVP — Mapa inicial y sistema de visión

> Fuente: MVP Systems Spec §4 y §5.

## 4. Mapa inicial

### Tamaño recomendado

```
32x24 tiles (o similar)
```

Lo suficientemente chico para que el jugador no se pierda, lo suficientemente grande
para sentir exploración.

> ✅ **Decidido (D2):** tile base **16x16 px**, escalado en juego **x3 o x4**. Ver
> [tamaños de asset](../4-frontend/responsabilidades-frontend.md#targets-y-especificaciones-decidido).

### Zonas del mapa

```
Playa inicial · Claro de campamento · Borde de jungla espesa ·
Pequeña orilla de agua · Zona de recursos livianos · Restos de naufragio
```

### Layout conceptual

```
[JUNGLA DENSA / BLOQUEO]
[árboles] [pasto] [rocas] [árboles]

        [claro inicial]
   ramas   piedras   pasto

        [jugador despierta]

[arena / restos / agua / costa]
```

### Objetivos del mapa

El mapa debe comunicar tres cosas:

1. Estoy atrapado en un lugar limitado.
2. Hay recursos suficientes para empezar.
3. Hay un bloqueo visible que parece resoluble más adelante.

## 5. Sistema de visión

### Estados de visibilidad

```ts
type VisibilityState = "unseen" | "explored" | "visible"
```

| Estado | Significado | Visual |
|---|---|---|
| **Unseen** | nunca visto | negro, niebla densa, sin interacción |
| **Explored** | visto antes, fuera del radio actual | oscuro, desaturado, mantiene silueta |
| **Visible** | dentro del radio de visión | color normal, interactuable, menú disponible |

**Para MVP (explored):**

```
Los tiles explorados se pueden clickear para moverse si son caminables.
Los objetos fuera de visión actual no se pueden interactuar.
```

> ✅ **Decidido (C2):** alcanza con esta regla para el slice (sin línea de visión
> real con obstáculos).

### Radio de visión inicial

```
5 tiles
```

Regla simple (sin línea de visión real con obstáculos):

```
Todo tile dentro de distancia circular <= 5 está visible.
Todo tile visto antes pero fuera de radio queda explored.
Todo tile nunca visto queda unseen.
```

## Relacionado

- [Presentación visual (visión limitada)](../1-diseno/presentacion-visual.md#63-visión-limitada)
- [Visibility System](../2-dominio/sistemas.md)
- [Modelo de datos (Tile)](../2-dominio/modelo-de-datos.md#mundo)
