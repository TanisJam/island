# MVP — Sistema de control y HUD

> Fuente: MVP Systems Spec §6 y §7. Diseño general en
> [control mouse-only](../1-diseno/control-mouse.md) y [UI / HUD](../1-diseno/ui-hud.md).

## 6. Sistema de control

El juego se juega solo con mouse. No debe requerir teclado para completar el MVP.

### Primer click — selecciona y observa

Debe: seleccionar tile u objeto, marcar highlight, mostrar pensamiento, mostrar menú
contextual, **no** ejecutar una acción destructiva todavía.

### Segundo click en el mismo objetivo

Ejecuta acción principal si está en rango. Si no está en rango, mueve al personaje
hacia el objetivo.

```
Para MVP recomendado:
Segundo click lejos = caminar hacia el objetivo.
Tercer click cerca  = ejecutar acción principal.
```

Esto evita acciones accidentales. (Alternativa más rápida para el futuro: segundo
click lejos = caminar y luego ejecutar automáticamente.)

### Click en tile vacío

> "Suelo arenoso. Podría rebuscar algo."

Acciones: caminar; rebuscar si está cerca; soltar item si hay item arrastrado.

> ✅ **Decidido (C3):** si no hay path válido al destino, pensamiento en primera
> persona: *"No puedo llegar allí desde aquí."* (A* sobre tiles `walkable`).

### Click en personaje

Abre menú personal. Opciones MVP: Inventario · Estado · Pensamientos · Cerrar.
(Opciones futuras: Cuaderno, Técnicas, Descansar, Mapa, Relaciones.)

## 7. HUD principal

### Layout

```
| Mano izquierda | Teletipo / Vida / Energía | Mano derecha |
```

### Mano izquierda / Mano derecha

Muestran el item activo asociado a cada mano.

```
MANO IZQUIERDA        MANO IZQUIERDA
Piedra                Vacía
```

### Teletipo

Muestra el último pensamiento importante. Debe sentirse como una marquesina, no como
un log técnico. Al hacer click: abre historial de pensamientos.

```
"Creo que estas ramas podrían servirme."
```

### Vida y energía

```
Vida: 100/100      Energía: 100/100
```

En MVP la vida sólo existe como indicador. La energía sí se usa (ver
[energía y durabilidad](energia-durabilidad.md)).

## Relacionado

- [Control mouse-only (GDD)](../1-diseno/control-mouse.md)
- [UI / HUD (GDD)](../1-diseno/ui-hud.md)
- [InputSystem / InteractionSystem](../2-dominio/sistemas.md)
- [Energía y durabilidad](energia-durabilidad.md)
