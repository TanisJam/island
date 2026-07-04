# Research: UX de crafteo sin libro de recetas

El problema actual no es la falta de contenido: es la baja legibilidad de un sistema deliberadamente oculto. La dirección recomendada es **mostrar reglas, propiedades y contexto**, pero mantener ocultas las soluciones exactas hasta que el jugador las descubra.

## Conclusión ejecutiva

Para *Isla Misteriosa*, el mejor camino de MVP es un híbrido:

1. `Examinar/Observe` revela propiedades de materiales.
2. Los items muestran **propiedades conocidas**, no recetas completas.
3. La mesa, las manos y el suelo dan feedback de cercanía.
4. Existe una acción más visible tipo **Probar combinación**.
5. Lo ya descubierto se guarda como recuerdo/idea aprendida.

Esto preserva el misterio sin convertir el crafteo en adivinanza opaca.

## Diagnóstico del sistema actual

El sistema actual obliga al jugador a adivinar demasiadas cosas al mismo tiempo:

| Fricción | Efecto en el jugador |
|---|---|
| No sabe qué combina | Prueba al azar o abandona. |
| No sabe dónde combinar | Manos, suelo, mesa y fogata compiten sin señal suficiente. |
| No sabe cuándo está cerca | Si la acción no aparece, parece que nada sirve. |
| Las pistas son efímeras | El teletipo no alcanza como memoria de hipótesis. |
| El feedback de fallo es pobre | No diferencia “mal material”, “falta pieza” o “lugar incorrecto”. |

Principio clave: **misterio no es ausencia de información**. El jugador puede descubrir la solución, pero necesita entender las reglas del mundo.

## Casos comparados

### Zelda: Tears of the Kingdom — combinación legible

Nintendo explica en *Ask the Developer* que TotK buscó que el jugador pudiera hacer lo que cree que puede hacer. Para eso, los objetos comunican uso de forma visual y familiar: ventiladores parecen ventiladores, piezas pegadas muestran “pegamento”, y el feedback sonoro refuerza que algo quedó unido.

**Qué aporta:**

- Los materiales deben comunicar uso posible antes de abrir un menú.
- El feedback visual/sonoro de “esto encaja” es tan importante como el resultado.
- La fantasía de craftear funciona mejor cuando el jugador entiende propiedades simples: largo, pesado, cortante, flexible, inflamable, recipiente, superficie.

**Aplicación posible:**

```text
Rama observada → larga · rígida · sirve como mango
Fibra observada → flexible · sirve para atar
Piedra afilada observada → cortante · pesada
```

### Minecraft — del descubrimiento puro al recuerdo asistido

Minecraft empezó con crafting de grilla y recetas memorizadas. Con el tiempo incorporó el Recipe Book: recetas organizadas, búsqueda, filtro de craftable y desbloqueo por criterios como tener ciertos materiales o tocar agua.

**Qué aporta:**

- El descubrimiento puro escala mal cuando hay muchas combinaciones.
- Un sistema puede ocultar recetas al inicio, pero recordarlas después.
- El desbloqueo por contacto con materiales es una forma simple de enseñar sin tutorial pesado.

**Aplicación posible:**

No usar un libro inicial de recetas. Sí usar un registro posterior:

```text
Idea recordada: herramienta rudimentaria
Necesita: algo cortante + algo que sirva como mango + algo para atar
Puede hacerse: en manos o sobre una mesa
```

### Don’t Starve — categorías, prototipado y estaciones

Don’t Starve muestra recetas por categorías y usa estaciones de prototipado. Algunas recetas se desbloquean cerca de una máquina; después quedan aprendidas.

**Qué aporta:**

- Las estaciones explican el **dónde**.
- La categoría explica el **para qué**.
- El prototipado convierte una acción puntual en conocimiento permanente.

**Aplicación posible:**

La mesa rústica no debería ser solo almacenamiento: debería comunicar “acá se ordenan piezas”. La fogata comunica “acá se prueba calor”.

### Subnautica — observar/escANEAR antes de fabricar

Subnautica usa exploración, escaneo y blueprints. El jugador descubre tecnología mirando el mundo, y luego fabrica desde un Fabricator.

**Qué aporta:**

- El conocimiento nace de observar, no de abrir un menú global.
- La fabricación es una consecuencia de exploración.
- Un blueprint puede ser explícito porque ya fue ganado.

**Aplicación posible:**

`Observe` debería ser parte central del loop de crafting:

```text
Observás la fibra.
“Se retuerce sin romperse. Podría servir para unir piezas.”

Conocimiento ganado:
- propiedad:fibra.flexible
- idea:atar_piezas
```

### Terraria — guía contextual por material

Terraria tiene un NPC Guide: si le mostrás un material, te dice qué se puede fabricar con él y qué estación requiere. Además, la ventana de crafting normal solo muestra lo actualmente craftable.

**Qué aporta:**

- El jugador pregunta desde un material concreto, no desde una lista universal.
- La ayuda contextual reduce wiki-dependencia.
- Mostrar estación requerida elimina una de las incertidumbres más molestas.

**Aplicación posible:**

No hace falta un NPC. El objeto examinado puede cumplir ese rol:

```text
Fibra conocida
Puede ayudar a: atar, reforzar, colgar
Suele necesitar: piezas rígidas o una superficie de trabajo
```

### Little Alchemy 2 — experimentación con historial e hints

Little Alchemy permite probar combinaciones sin penalidad, mantiene un panel de descubrimientos y ofrece pistas oficiales/personalizadas cuando el jugador se traba.

**Qué aporta:**

- La experimentación libre funciona si el costo de fallar es bajo.
- El historial reduce carga mental.
- Los hints son una válvula de escape, no el sistema principal.

**Aplicación posible:**

Para MVP, el equivalente mínimo sería un historial pequeño de ideas descubiertas y “casi descubrimientos”.

### Potion Craft — crafteo por propiedades espaciales

Potion Craft no se basa solo en listas. Los ingredientes tienen comportamiento físico/espacial dentro de un mapa alquímico. El jugador aprende cómo se mueve cada ingrediente y planifica rutas.

**Qué aporta:**

- Mostrar el comportamiento del material puede ser más potente que mostrar una receta.
- El crafteo se vuelve lectura de propiedades, no memorización.

**Aplicación posible:**

En *Isla Misteriosa*, los materiales deberían tener propiedades legibles que atraviesen varias recetas:

```text
Fibra: ata / flexible / combustible débil
Barro: moldeable / húmedo / endurece con calor
Piedra: pesada / dura / puede astillarse
```

### Noita — caso cautelar de profundidad opaca

Noita tiene sistemas alquímicos y de varitas muy profundos. También muestra el riesgo de una simulación con reglas poderosas pero poca legibilidad: muchos jugadores terminan dependiendo de guías externas para entender recetas, interacciones y mecánicas avanzadas.

**Qué aporta:**

- La profundidad sin señal se convierte en oscuridad.
- Un sistema puede ser brillante para expertos y frustrante para nuevos jugadores.
- Si el juego no enseña sus reglas, la wiki se vuelve parte del diseño aunque no quieras.

**Aplicación posible:**

Evitar combinaciones críticas sin pistas. Si una receta bloquea la cadena de 20 minutos, debe tener feedback gradual y múltiples pistas previas.

## Patrones reutilizables para Isla Misteriosa

### 1. Propiedades visibles, recetas ocultas

Mostrar propiedades descubiertas por observación:

| Tipo | Ejemplos |
|---|---|
| Forma | largo, plano, hueco, puntiagudo |
| Material | rígido, flexible, quebradizo, moldeable |
| Función | corta, ata, contiene, golpea, sostiene |
| Reacción | arde, se moja, endurece con calor, se rompe |

El jugador no ve “hacha = piedra + rama + fibra”. Ve que necesita resolver una intención funcional.

### 2. Feedback de cercanía

El sistema debe diferenciar fallos:

```text
Nada interesante.
Estas piezas tienen una relación, pero falta algo para unirlas.
La forma sirve, pero este material se rompe al forzarlo.
Casi funciona: necesitás una superficie estable.
Listo para armar.
```

### 3. Acción “Probar combinación”

Hoy, si el contexto no es exacto, la acción desaparece. Eso castiga la exploración.

Mejor: permitir probar más seguido y responder con feedback útil.

```text
Probar combinación
→ “La piedra queda en la punta de la rama, pero no se sostiene.”
```

### 4. Mesa como superficie de hipótesis

La mesa debería ser una interfaz de pensamiento, no solo un contenedor espacial.

Estados posibles:

| Estado | Mensaje |
|---|---|
| Sin relación | “No ves una forma clara de unir esto.” |
| Relación parcial | “Hay una idea, pero falta una pieza funcional.” |
| Cerca | “Esto podría ser una herramienta si lo atás bien.” |
| Listo | “Podés armar una herramienta rudimentaria.” |

### 5. Memoria posterior al descubrimiento

Una vez descubierta una combinación, el juego debe recordarla como conocimiento adquirido.

No es un libro de recetas inicial. Es memoria del personaje.

```text
Ideas aprendidas
- Herramienta rudimentaria
  - algo cortante
  - algo como mango
  - algo para atar
```

## Opciones de diseño

### Opción A — Hipótesis por propiedades

**Descripción:** los materiales muestran propiedades conocidas; las combinaciones se expresan como necesidades funcionales.

**Ventajas:**

- Muy alineada con el GDD.
- Mantiene descubrimiento.
- Escala mejor que recetas exactas.

**Riesgos:**

- Requiere escribir buen contenido de propiedades y feedback.
- Si las propiedades son vagas, no resuelve el problema.

**Veredicto:** recomendada como base.

### Opción B — Observe como puerta de crafting

**Descripción:** examinar materiales, objetos y estaciones desbloquea ideas parciales.

**Ventajas:**

- Refuerza el pilar “Mirar → Entender”.
- Conecta G2 con rediseño de crafting.
- Barato si ya existe `Observe` en backend.

**Riesgos:**

- Si las ideas no persisten, se pierden.

**Veredicto:** debería entrar en el primer ciclo de mejora.

### Opción C — Recuerdos después del descubrimiento

**Descripción:** lo descubierto queda registrado con ingredientes por propiedad, no necesariamente por objeto exacto.

**Ventajas:**

- Evita frustración de memoria.
- No revela soluciones nuevas.
- Compatible con cuaderno post-MVP o panel MVP mínimo.

**Riesgos:**

- Puede parecer “libro de recetas” si se presenta demasiado explícito.

**Veredicto:** usar versión mínima para MVP.

### Opción D — Mesa como tablero de experimentación

**Descripción:** la mesa muestra estados de compatibilidad entre piezas.

**Ventajas:**

- Muy intuitivo.
- Convierte organización espacial en pensamiento visible.

**Riesgos:**

- Mayor costo UI.
- Puede requerir iteración visual.

**Veredicto:** buen segundo ciclo, después de propiedades/Observe.

### Opción E — Guía contextual por item

**Descripción:** al seleccionar/examinar un item, se muestran usos amplios.

**Ventajas:**

- Barato.
- Reduce incertidumbre rápido.

**Riesgos:**

- Puede sentirse demasiado directo si revela resultados.

**Veredicto:** útil si se limita a funciones, no recetas.

## Recomendación para el próximo ciclo

Abrir un ciclo **crafting-legibility** antes del playtest largo.

Alcance sugerido:

1. Cablear `Observe` desde frontend.
2. Agregar propiedades conocidas a items clave del MVP.
3. Mostrar propiedades en el panel contextual del item.
4. Agregar feedback de cercanía para combinaciones críticas.
5. Guardar descubrimientos como ideas recordadas.

No incluir todavía:

- Cuaderno completo.
- Árbol de research amplio.
- Todas las recetas post-MVP.
- UI compleja de mesa tipo tablero avanzado.

## Criterios de éxito

- El jugador entiende que una rama puede funcionar como mango antes de saber la receta exacta.
- El jugador entiende por qué piedra + rama todavía no alcanza.
- El jugador sabe si está usando el lugar incorrecto.
- La acción de experimentar no desaparece silenciosamente.
- Una receta descubierta no debe memorizarse fuera del juego.
- La cadena de 20 minutos puede completarse sin wiki ni ayuda externa.

## Fuentes consultadas

- Nintendo — *Ask the Developer Vol. 9: The Legend of Zelda: Tears of the Kingdom*, partes 4 y 5.
- Minecraft Wiki — `Crafting` y `Recipe book`.
- Don’t Starve Wiki — `Crafting`.
- Terraria Wiki — `Guide` y `Recipes`.
- Little Alchemy 2 — sitio oficial de hints.
- Steam — páginas oficiales de *Subnautica* y *Potion Craft*.
- Potion Craft Wiki — overview de crafting/ingredientes.
- Noita Wiki — `Alchemy` y `Guide: Wand Mechanics`.
