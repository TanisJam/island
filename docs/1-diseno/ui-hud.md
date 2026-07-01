# UI principal / HUD

> Fuente: GDD v2 §8. El detalle del MVP está en [control y HUD MVP](../5-mvp/control-hud.md).

La UI debe ser mínima y contextual.

## 8.1. HUD inferior

```
[Mano izquierda] [Teletipo / Vida / Energía] [Mano derecha]
```

## 8.2. Mano izquierda y mano derecha

Las manos muestran lo que el personaje tiene activo:

```
Mano izquierda: Piedra
Mano derecha: Fibra
```

Estas manos no son simples accesos rápidos. Son una representación directa de la
fila superior del inventario (ver [inventario físico](inventario-fisico.md)).

## 8.3. Teletipo de pensamientos

En el centro del HUD hay una marquesina o teletipo con pensamientos en primera
persona:

> "Creo que estas ramas podrían servirme."

Debe mostrar: observaciones, ideas, fallos, descubrimientos, advertencias,
recuerdos. Al hacer click en el teletipo, se abre el historial de pensamientos.

## 8.4. Vida y energía

Bajo el teletipo:

```
Vida     100/100
Energía   80/100
```

La energía no debe ser un sistema agresivo estilo mobile, sino una forma de limitar
esfuerzo físico temprano.

## 8.5. Click en el personaje

Click en el personaje abre el panel personal. Opciones: inventario, estado,
cuaderno, técnicas, pensamientos, descansar.

El personaje es el acceso al "menú principal", no una barra fija llena de botones.

## Relacionado

- [Sistema de pensamientos](pensamientos.md)
- [Inventario físico](inventario-fisico.md)
- [Control mouse-only](control-mouse.md)
- [HUD del MVP](../5-mvp/control-hud.md)
