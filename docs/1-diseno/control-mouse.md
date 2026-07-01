# Control mouse-only

> Fuente: GDD v2 §7. El detalle del MVP está en [control y HUD MVP](../5-mvp/control-hud.md).

El juego debe poder jugarse solo con mouse.

## 7.1. Principio principal

```
Primer click = observar / seleccionar.
Segundo click = actuar o moverse.
```

## 7.2. Click en tile vacío

**Primer click:**

> "Suelo arenoso. Podría rebuscar piedras pequeñas."

**Segundo click:** caminar hasta ese tile.

> ✅ **Decidido (C3):** si no hay path válido (rodeado de jungla/agua), mostrar un
> pensamiento en primera persona: *"No puedo llegar allí desde aquí."* Pathfinding
> A* simple sobre tiles `walkable`.

## 7.3. Click en objeto

**Primer click:** selecciona objeto; muestra contorno/highlight; muestra menú
contextual cerca del objeto; muestra pensamiento o descripción.

**Segundo click:** si está lejos, caminar hacia distancia válida; si está cerca,
ejecutar acción principal.

## 7.4. Click con objeto en mano

El contexto cambia. Ejemplos:

```
Piedra en mano + árbol:   golpear con piedra · raspar corteza · examinar · acercarse.
Fibra en mano + rama:     atar · trenzar · comparar · recoger.
Hacha en mano + árbol:    cortar · desramar · examinar.
```

## Relacionado

- [Sistema de interacción contextual](../2-dominio/interaccion-contextual.md)
- [Presentación visual](presentacion-visual.md)
- [Control y HUD (MVP)](../5-mvp/control-hud.md)
- [Responsabilidades del frontend](../4-frontend/responsabilidades-frontend.md)
