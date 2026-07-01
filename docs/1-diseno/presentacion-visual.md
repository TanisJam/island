# Presentación visual

> Fuente: GDD v2 §6.

## 6.1. Cámara

- Top-down 2D.
- Pixel art.
- Perspectiva ligeramente inclinada, similar a juegos de granja o RPG 2D.
- Tiles visibles.
- Objetos colocables en el mundo.

## 6.2. Estilo

- Naturaleza cálida pero misteriosa.
- Isla tropical / subtropical.
- Bosque y jungla densa.
- Playa, rocas, agua, claros.
- Fogata y base como centros visuales de seguridad.

## 6.3. Visión limitada

El jugador tiene un radio de visión. Estados de tile:

```
No visto:
- completamente oscuro o cubierto.

Explorado:
- visible de forma apagada, como recuerdo.

Visible:
- color normal, interactuable.
```

**Para MVP:** radio circular simple, sin bloqueo real por línea de visión.

**Para futuro:** árboles, paredes y rocas bloquean visión; antorchas amplían
visión; torres o miradores revelan zonas.

> El detalle de implementación de los tres estados está en
> [sistema de visión del MVP](../5-mvp/mapa-y-vision.md). El render de cada estado lo
> hace el [frontend](../4-frontend/responsabilidades-frontend.md).

## Relacionado

- [Control mouse-only](control-mouse.md)
- [UI / HUD](ui-hud.md)
- [Mapa y visión (MVP)](../5-mvp/mapa-y-vision.md)
