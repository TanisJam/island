# Dirección UX/UI — "Luz de fuego"

> Documento consolidado de dirección de interfaz e interacción para Isla Misteriosa.
> Reúne las decisiones tomadas en la sesión de diseño de UX/UI. Se apoya en la
> identidad ya documentada (`presentacion-visual.md`, `ui-hud.md`, `control-mouse.md`,
> `pensamientos.md`, `inventario-fisico.md`, `0-vision/02-pilares.md`) y, donde
> corresponde, **reemplaza** decisiones previas (ver §10).

---

## 1. Tesis visual: Luz de fuego

El ancla emocional del juego es la fogata: *"El fuego prendió. Por primera vez desde
que desperté, tengo un punto al que volver."* El arco es **calidez = seguridad =
agencia**. De ahí sale una única tesis que unifica toda la interfaz:

> **Lo que podés tocar, usar o tenés equipado —y cada descubrimiento— se ilumina
> cálido. Lo dormido, el recuerdo y lo inalcanzable quedan fríos y apagados.**

No es un "dark mode con acento" genérico: la semántica de la luz sale de la ficción.
La brasa es el único acento y siempre significa lo mismo: *acá hay agencia*.

---

## 2. Sistema de tokens

### Color (6 tokens, anclados en los terrenos ya documentados)

| Token | Hex | Rol |
|-------|-----|-----|
| `sombra-jungla` | `#0f1a16` | Fondo / misterio. Verde muy oscuro (deriva de dense_jungle `#1f5c3a`), **no** negro plano. |
| `madera-deriva` | `#2b2620` | Paneles y ventanas flotantes (madera curtida). |
| `arena-hueso` | `#e8dcc0` | Texto primario (deriva de sand `#d9c089`), **no** un `#eee` plano. |
| `brasa` | `#f0a24e` | **El acento.** Activo, equipado, interactivo, seleccionable. |
| `descubrimiento` | `#ff7a3d` | Brasa caliente. Solo para el momento de descubrir (destello puntual). |
| `recuerdo` | `#6b6a5c` | Gris-verde apagado: explorado fuera de vista, inactivo, inalcanzable. |

Terrenos (fuente única, ya en `render/assets.ts`): sand `#d9c089`, grass `#6a9a4f`,
shallow_water `#4a90c2`, dense_jungle `#1f5c3a`, dirt `#8a6b4a`, rocky_ground `#8a8a8a`.

### Tipografía — el par codifica una verdad del contenido

El juego tiene DOS registros que los docs separan de forma tajante: el mensaje técnico
(prohibido) y el pensamiento en primera persona (obligatorio). Los separamos
tipográficamente:

- **Capa instrumento** (energía, contadores `×N`, labels de manos, títulos de ventana):
  fuente **bitmap/pixel** (referencia: Silkscreen). Refuerza el mundo pixel-art.
- **Capa voz** (pensamientos, acciones, examinar): fuente **humanista cálida y legible**
  (referencia: Spectral itálica). El pensamiento se siente *pensado*, no *impreso por el
  sistema*.

> La tipografía no es un vehículo neutro: encoda la distinción voz ⟷ instrumento que ya
> es ley en `pensamientos.md`.

### Semántica de la luz (estados)

| Estado | Tratamiento |
|--------|-------------|
| Equipado (en mano) | Glow de brasa alrededor del ítem. |
| Seleccionable / bajo el cursor | Contorno de brasa. |
| Tile seleccionado | Anillo de brasa pulsante. |
| Trabajando (acción en curso) | Progreso cálido en la voz + el objeto (ver §7). |
| Descubrimiento | Destello de `descubrimiento` puntual. |
| Explorado (fuera de vista) | Atenuado con `recuerdo`, "como recuerdo". |
| No visto / inalcanzable | Oscuro; sin afordancias. |

### Layout y firma

- **El mapa es la vista** (pantalla completa). La UI casi no existe hasta que se la pide.
- **Overlay inferior sin marco**, flotando sobre el mapa:
  `[mano izq] [pensamiento + energía] [mano der]`.
  La legibilidad sin caja se resuelve con un **degradado de oscuridad** que sube desde el
  borde inferior (la penumbra fuera del alcance del fuego) — contraste sin marco duro.
- **Firma** (donde se gasta toda la audacia): **el pensamiento activo iluminado por el
  fuego** + el ítem equipado con glow de brasa. Un flicker cálido, sutilísimo, respetando
  `prefers-reduced-motion`. Todo lo demás, quieto y disciplinado.

Mockup interactivo de referencia: [`mockups/luz-de-fuego.html`](./mockups/luz-de-fuego.html).

---

## 3. Modelo de interacción: mapa + UI contextual y flotante

- **Por defecto** (sin tocar nada): solo el mapa y el overlay inferior sin marco.
- **Todo lo demás son ventanas flotantes o menús contextuales** que se despliegan al
  interactuar (clic en el personaje → sus opciones; clic en un objeto → sus acciones).
- Las ventanas **quedan abiertas o se cierran a voluntad** (fijar 📌 / descartar ✕);
  clic en el vacío descarta lo no fijado. Se pueden reposicionar (drag por la barra).
- Sigue vigente el paradigma de **dos clics** de `control-mouse.md` (observar → actuar),
  ahora expresado a través del menú contextual.

---

## 4. El menú contextual como sistema de afinidades (traits/affordances)

Este es el corazón del modelo y su mayor virtud es la **modularidad**: cualquier cosa que
pongamos después en un tile o en el inventario **aporta sus propias acciones**, sin tocar
el resto.

**Principio:** cada "cosa" (terreno, objeto del mundo, ítem en el piso, ítem en mano, ítem
de inventario, el personaje) declara **propiedades** y **afordancias** (verbos que ofrece).
El menú es la **resolución en vivo** de todas las afordancias aplicables según el contexto.

> Esto coincide con el grano data-driven que el backend ya tiene: `actions.json` define
> acciones con requisitos por propiedad. El menú del cliente es un **preview** derivado de
> esos requisitos + contexto vivo; el backend sigue siendo autoritativo (anti-cheat).
> No se hardcodea por tile.

### Inputs de contexto

- **Distancia** al jugador (chebyshev, como usa `engine.ts checkRequirement`): 0 (propio),
  1 (adyacente), >1 (lejos).
- **Qué hay en el tile** (terreno + objeto del mundo).
- **Qué hay en el piso** (ítems / pilas).
- **Qué tenés en las manos** (izquierda / derecha).
- **Qué sabe el personaje** (conocimiento / técnicas — gatea afordancias).
- **Visibilidad** (visible / explorado / no visto).

### Taxonomía por distancia

| Distancia | Secciones del menú |
|-----------|--------------------|
| **0 · propio** | *Yo* (ver mis cosas, ver pensamientos, decir algo) · *Aquí* (rebuscar, cortar pasto, cavar — con las manos o con herramienta) · *En el suelo*, si hay ítems (examinar, improvisar, recoger). |
| **1 · adyacente** | *Interactuar con el objeto* (según lo que tengas en mano) · soltar algo acá · recoger del suelo · examinar · ir. |
| **>1 · lejos visible** | observar · acercarme (hasta poder usarlo) · ir hasta ahí. |
| **>1 · penumbra/explorado** | intentar ver · ir hacia allá · recordar. |
| **no visto / sin camino** | solo un pensamiento ("No alcanzo a ver qué hay ahí" / "No puedo llegar allí desde aquí"). |

El gating por distancia es diseño, no limitación técnica: no podés "cortar" un árbol a
distancia 2 — primero *acercarme*. Recién adyacente aparece *interactuar*.

### Menú de un ítem de inventario (clic; drag = mover)

Afordancias gateadas por las propiedades del ítem:

- **Examinar** (siempre) — ver §5.
- **Soltar** · **Lanzar** (si es arrojable) · **Rotar** (solo forma 1×2/1×3, ya en
  `inventario-fisico.md`) · **A la mano / equipar** · **Interactuar/usar** (si tiene uso
  propio) · **Combinar/improvisar** — ver §6.

---

## 5. Las tres capas de "saber"

Le da coherencia a examinar, actuar e improvisar como un mismo sistema temporal:

- **Examinar = pasado/presente.** Muestra lo que YA entendés de la cosa, en primera
  persona, y a veces **avanza el entendimiento** (un pensamiento nuevo). Crece con el uso.
  Es el pilar "conocimiento es progreso". **Nunca una ficha de stats** — observaciones e
  hipótesis: *"Es dura y pesada. Ya vi que astilla la corteza. Si la atara a algo,
  golpearía más fuerte."* El examinar temprano es vago; se afina con el conocimiento.
- **Acciones = presente.** Los verbos que podés intentar ahora.
- **Intuición / improvisar = futuro (hipótesis).** Lo que SENTÍS que podrías hacer (§6).

---

## 6. Crafting como cadena de gestos físicos

### Por qué el "soltar en el piso → transformar" se siente mágico (y se reemplaza)

El modelo previo (fusión por co-ubicación en el suelo) falla en tres frentes:

1. **No hay un ACTO** — los ítems se fusionan por un chequeo de proximidad; es una receta
   oculta disparada por un gesto espacial arbitrario.
2. **Es instantáneo** — sin esfuerzo ni tiempo. Un náufrago atando una piedra a un palo no
   es un chasquido.
3. **Pasa en el suelo, lejos de las manos** — contradice el pilar "las manos definen la
   intención".

### El modelo: un gesto transitivo, con estados intermedios que ramifican

Craftear es **una acción de las manos que ensambla cosas a la vista, cuesta esfuerzo y
puede salir imperfecta.** No es "ingredientes → resultado", es una **cadena de gestos**:

```
rama  ──"atar fibra"──►  rama con fibra floja  ──"encajar piedra"──►  hacha tosca
                              │
                              └──"apretar más"──► (mejor agarre)   [rama que puede o no habilitar más]
```

- Cada acción produce un **objeto/estado intermedio** que es, a su vez, otro "actor" con
  sus propias afordancias (habilita nuevas acciones). Modularidad hasta el final.
- **Algunas ramas no llevan a nada**, y eso es el descubrimiento: un intento sin salida
  deja un **pensamiento de aprendizaje** ("así no; la fibra sola no aguanta el peso").
  El árbol de acciones tiene callejones que ENSEÑAN (categoría "fallo útil").
- Es la misma gramática que todo lo demás: combinar es solo un verbo contextual más.

### El espacio físico del crafteo

- **Las manos** son el espacio primario (combinás lo que sostenés; límite natural de 2
  piezas).
- **La mesa / workspace** extiende las manos para ensamblajes de más de dos piezas o para
  dejar algo a medio hacer (engancha con la feature "surface/mesa" del roadmap).
- **El suelo es guardado-en-el-mundo**, no un combinador mágico.

La fricción es el motor: hacer todo a mano es limitante → construís mesa, después
herramientas, después máquinas (pilar 5, "las máquinas emergen del dolor").

### Intuición / improvisar (anti-recetario)

Cuando hay materiales combinables a mano, aparece la afordancia *improvisar*. Reglas para
mantener el pilar "NO es un libro de recetas":

1. **La pista es una INTUICIÓN, no una fórmula.** En la voz del juego, atada a lo que
   sostenés: *"Con esto en las manos... siento que podría atar algo."*
2. **La especificidad se gatea por CONOCIMIENTO.** Un novato con palo+cuerda recibe algo
   vago (*"me falta algo"*); a medida que aprende, la intuición nombra un material concreto
   (*"tal vez una piedra"*). Esto preserva el descubrimiento.
3. **Improvisar es un INTENTO que puede fallar productivamente** — el fallo deja un
   aprendizaje direccional, no un checklist mostrado de antemano.
4. **Múltiples posibilidades = intuición de potencial**, apuntando a DIRECCIONES por
   propiedad/rol ("algo para atar", "algo con peso", "algo con filo"), no a nombres de
   recetas ni cantidades.

**Regla dura:** nunca mostrar receta, cantidad de ingredientes, ni nombre del resultado
antes de crear. Examinar muestra lo aprendido (pasado); improvisar muestra lo que sentís
que podrías intentar (hipótesis). El resultado se descubre haciendo.

---

## 7. Acciones con duración

Para que nada se sienta instantáneo — **pero acotado**, porque la UX es observacional y
mouse-first: ponerle delay a todo la volvería insufrible.

- **Acciones que afectan el mundo / trabajo físico** (cortar, cavar, atar, golpear, un
  paso de crafteo) → **tienen duración**.
- **Acciones observacionales / de UI** (examinar, seleccionar, abrir/cerrar ventanas, leer
  pensamientos, moverse un tile) → **instantáneas o casi**. Mirar no es laburar.

### El payoff: el progreso se siente en el tiempo

La duración se **deriva por dato** (cada acción del catálogo trae su esfuerzo) y se
**escala por herramienta, conocimiento y energía**:

- Cortar un árbol con las manos = lento y agotador. Con hacha tosca = más rápido. Con
  hacha buena = un tris. Cansado = más lento.

Así, mejor herramienta = menos segundos de trabajo: anti-magia **y** motor de progresión
en una sola mecánica (el "dolor" es el tiempo/esfuerzo que la herramienta te ahorra).

### Requisitos

- **Server-autoritativa**: el backend confirma la finalización con un evento (anti-cheat);
  el cliente muestra progreso predicho.
- **Feedback en la voz/visual** mientras el personaje trabaja.
- **Cancelable**: moverte interrumpe.
- **Conexión con la arquitectura:** esta mecánica (acción con duración + feedback continuo)
  es exactamente lo que habilita la espina realtime de `frontend-seams` — el `ViewState` +
  game loop animan el beat de "trabajando" entre snapshots autoritativos.

---

## 8. Pilares respetados

1. **El mundo se entiende observándolo** — examinar como sistema de conocimiento (§5).
2. **El crafting es físico** — gestos de las manos, estados intermedios, no fusión mágica (§6).
3. **Las manos definen la intención** — el menú contextual depende de lo que sostenés (§4).
4. **El conocimiento es progreso** — examinar y la intuición se afinan con lo aprendido (§5, §6).
5. **Las máquinas emergen del dolor** — la duración/fricción del trabajo a mano motiva
   mesa → herramientas → máquinas (§6, §7).
6. **La isla bloquea y guía orgánicamente** — gating por distancia/visibilidad (§4).
7. **La cooperación acelera, no reemplaza** — "decir algo" y el modelo async intactos.

---

## 9. Qué NO es (no-goals)

- No es un recetario: sin listas de ingredientes, cantidades ni nombres de resultado antes
  de crear.
- No es una UI siempre-visible: el mapa manda; los menús se piden.
- No agrega delay a las acciones observacionales/UI.
- No craftea desde la mochila (la mochila es guardado; se craftea con manos + mesa).
- No cambia la voz (español, primera persona) ni el paradigma de dos clics.

---

## 10. Decisiones que este documento reemplaza / precisa

- **Crafting por co-ubicación en el suelo** (soltar materiales al lado → fusión) → se
  reemplaza por **cadena de gestos físicos con las manos / mesa** (§6). El "soltar al lado"
  sigue existiendo como gesto de manipulación, no como disparador de fusión automática.
- **Movimiento snap por tile** (`PREGUNTAS.md B5`) → se mantiene el modelo (un tile por
  acción), con **interpolación cosmética** (tween ~120ms, ya implementado en `ViewState`)
  como capa de presentación, no como cambio del modelo de movimiento.

---

## 11. Próximos pasos de implementación

Mapea directo a las costuras que ya existen (ver `4-frontend/` y el cambio `frontend-seams`):

- **`Ui` (seam)** — el HUD sin marco + ventanas flotantes contextuales.
- **`AssetResolver` (seam)** — descriptores visuales por propiedad (ver
  `4-frontend/pipeline-de-arte.md`).
- **`ViewState` + game loop (seam)** — animación de estados: equipado, selección,
  "trabajando" (progreso de acción con duración), destello de descubrimiento.
- **`computeAvailableActions` (`actions/`)** — resolución del menú contextual como preview
  del sistema de afinidades.
- **Backend / catálogo** — propiedades por ítem/objeto, requisitos de acción por propiedad,
  duración por acción (escalable), cadenas de crafteo con estados intermedios. Autoritativo.
- **Feature "surface/mesa"** — el workspace de ensamblaje (ya en el roadmap).
