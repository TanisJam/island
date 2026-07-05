# MVP — Criterios de éxito, secuencia testeable y bugs aceptables

> Fuente: MVP Systems Spec §23, §24 y §25.

## 23. Criterios de éxito del MVP

El MVP funciona si el jugador puede entender, sin explicación externa:

1. Que puede mirar objetos antes de actuar.
2. Que el menú contextual depende del objeto.
3. Que las manos cambian las opciones disponibles.
4. Que los objetos ocupan espacio físico.
5. Que puede soltar objetos en el mundo.
6. Que el campamento puede funcionar como espacio de organización.
7. Que no hay recetas explícitas, pero sí pistas.
8. Que la jungla es un bloqueo orgánico.
9. Que fabricar una herramienta cambia el mundo.
10. Que abrir el primer paso genera ganas de seguir explorando.

## 24. Secuencia mínima testeable

Esta es la secuencia que el prototipo debe permitir completar:

```
1. Aparezco en la playa.
2. Clickeo árbol y leo pensamiento.
3. Arranco ramas.
4. Clickeo pasto y recolecto fibra.
5. Clickeo piedra y la recojo.
6. Abro inventario clickeando el personaje.
7. Muevo piedra a una mano.
8. Muevo fibra o rama a otra zona.
9. Pruebo interacciones nuevas.
10. Descubro idea de atar.
11. Creo herramienta rudimentaria.
12. Uso herramienta en árbol.
13. Obtengo madera pobre.
14. Creo hacha simple agachado ("Examinar de cerca" + "Probar combinación" sobre
    piedra + madera + fibra) — NO hace falta construir fogata ni mesa para esto.
15. (Opcional) Si construyo una mesa, puedo craftear ahí en cambio: mejor
    calidad (más durabilidad), sin fatiga y más rápido — ver
    [Research: UX de crafteo](../1-diseno/crafting-ux-research.md).
16. Clickeo jungla espesa.
17. Uso hacha para despejar camino.
18. Veo nueva zona.
```

> **Nota (crouch-crafting, Slice D):** la mesa dejó de ser un paso obligatorio del
> paso 14 original ("Construyo fogata o mesa") — ahora es un UPGRADE opcional
> (mejor calidad, sin fatiga, más rápido), nunca un gate. La cadena crítica
> completa hasta el paso 18 sin construir nada. Craftear agachado repetidamente
> también genera un pensamiento de fatiga cada tantos usos, que empuja
> (sin bloquear) hacia construir una mesa.

## 25. Bugs aceptables en prototipo

**Es aceptable que:** el pathfinding sea simple · no haya animaciones complejas ·
las pilas sean simples · las recetas ocultas estén hardcodeadas · no haya guardado
persistente · el inventario sólo acepte rectángulos · la visión no tenga obstáculos ·
no haya rotación · no haya multiplayer · no haya balance fino.

**No es aceptable que:** el jugador no entienda qué hacer · los clicks sean confusos ·
las manos no cambien acciones · el inventario físico sea irrelevante · el feedback
parezca un log técnico · la jungla se sienta como pared invisible · el descubrimiento
sea sólo "probá todo con todo".

> **Nota:** algunos "bugs aceptables" se redefinieron por decisión de proyecto —
> p.ej. **sí** hay persistencia (SQLite, [A1](../PREGUNTAS.md#a1--el-mvp-usa-backend-o-es-cliente-puro))
> y **sí** hay rotación de objetos largos ([B3](../PREGUNTAS.md#b3--inventario-regla-de-manos-y-formas)).
> La lista de arriba es la del documento original.

## Relacionado

- [Objetivo y alcance](objetivo-alcance.md)
- [Experiencia del MVP (20 min)](experiencia-20min.md)
- [Regla de oro del MVP](../2-dominio/reglas-de-expansion.md#regla-de-oro-del-mvp)
