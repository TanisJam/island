# MVP — Energía, costos y durabilidad

> Fuente: MVP Systems Spec §21 y §22.

## 21. Energía y costos

### Objetivo

La energía debe reforzar que el personaje está trabajando físicamente. No debe
frenar el prototipo de forma molesta.

### Costos iniciales

```
Moverse: 0          Examinar: 0          Recoger item: 0
Rebuscar: 1         Arrancar ramas: 1    Golpear roca: 2
Cortar madera pobre: 3
Construir fogata: 5  Construir mesa: 5    Despejar jungla: 10
```

### Umbrales de energía (decidido)

> ✅ **Decidido (C1):** a medida que baja la energía por umbrales, las acciones
> pueden **tardar más** y, si está muy baja, pueden **fallar**. **No hay muerte ni
> daño** en el MVP.

Si no hay energía suficiente:

> "Estoy demasiado cansado para hacer eso ahora."

### Recuperación

MVP: botón "Descansar" desde el click en personaje; recupera **+30 energía**; puede
tener cooldown narrativo o no.

> "Respiro un momento. Puedo seguir."

## 22. Durabilidad

### Herramienta rudimentaria

```
Durabilidad: 20
Cortar madera pobre: -2    Romper fragmentos: -2    Separar restos: -1
```

Al romperse:

> "La herramienta no aguantó más."

### Hacha simple

```
Durabilidad: 40
Cortar árbol: -2    Despejar jungla: -8
```

Al romperse:

> "El mango cedió. Voy a tener que hacer otra."

## Relacionado

- [Herramientas (GDD)](../1-diseno/tecnicas-herramientas.md#20-herramientas)
- [HUD — vida y energía](control-hud.md#vida-y-energía)
- [EnergySystem](../2-dominio/sistemas.md)
- [PREGUNTAS C1](../PREGUNTAS.md#c1--vida-y-energía-en-mvp)
