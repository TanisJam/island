# Preguntas y decisiones abiertas

Dudas que surgieron al bajar los documentos. Están agrupadas por área. Donde
puedo, dejo una **recomendación** con su tradeoff para acelerar la decisión.

Estado: `🔴 bloqueante` · `🟡 importante` · `🟢 nice-to-have`
Marcá la decisión tomada con `✅` y movela al doc que corresponda.

---

## A. Arquitectura backend / frontend (lo más importante)

### A1. 🔴 ¿El MVP usa backend o es cliente puro?
El **MVP Spec** lista "no guardado en servidor" y "sin persistencia" como *bugs
aceptables* (§25), es decir, asume un prototipo cliente-only. Pero tu objetivo es
**backend-first** para tener fronts intercambiables. Hay tensión real acá.

- **Opción 1 — Backend desde el día 1 (recomendada):** el cliente nunca calcula
  reglas de juego; sólo render + input + predicción. Más lento de arrancar, pero
  el MVP ya valida el contrato API y evitás reescribir la lógica después.
- **Opción 2 — Cliente puro en MVP, backend en 0.2:** prototipás el *feel* rápido,
  pero arriesgás acoplar lógica al cliente y rehacerla.

> **Recomendación:** Opción 1, pero con backend **in-memory** (sin DB todavía) y
> el cliente prediciendo todo lo latency-sensitive. Así respetás backend-first sin
> pagar el costo de persistencia real en el primer slice.
Respuesta: Opcion 1, con sqlite. Mas adelande migramos a postgres.

### A2. 🔴 ¿Qué es autoritativo y qué predice el cliente?
Movimiento, "primer click = observar", radio de visión y preview del menú
contextual son **latency-sensitive**: si cada uno hace round-trip, el juego se
siente roto.

> **Recomendación a discutir:** el backend es autoritativo del **estado** (mundo,
> inventario, conocimiento, resultado de acciones y combinaciones) y de las
> **reglas**. El cliente predice **movimiento y observación local** porque ya tiene
> los datos de los tiles/objetos visibles. Detalle en
> [separacion-backend-frontend.md](3-backend-api/separacion-backend-frontend.md).
Respuesta: De acuerdo.

### A3. 🟡 ¿Dónde se calculan las acciones contextuales?
`target + distancia + manos + conocimiento + estado → acciones`. ¿El cliente las
calcula para mostrar el menú al instante, o las pide al backend?

> **Recomendación:** las reglas viven en el backend (autoritativo, anti-cheat).
> El cliente recibe del backend la **lista de acciones del target visible** junto
> con el estado, y puede recalcular el *preview* localmente con una copia de las
> reglas. La **ejecución** y las **combinaciones ocultas** siempre las valida el
> backend.
Respuesta: De acuerdo.

### A4. 🟡 ¿Protocolo y estilo de API?
El multiplayer es asincrónico y "las acciones quedan registradas" (GDD §23.5).
Eso huele a **comandos + eventos** (event log).

- ¿REST para lectura de estado + WebSocket para acciones/eventos?
- ¿Vamos a un modelo **command → event** (event sourcing ligero) para soportar el
  registro de visitas y acciones offline?

> **Recomendación:** comandos (`POST /commands`) que devuelven eventos, estado por
> snapshot al cargar zona. WebSocket recién cuando haya presencia/tiempo real
> (no en MVP). Definir en backend-api antes de codear.
Respuesta: De acuerdo. Pero tené en cuenta que post MVP usariamos real time para interacciones de jugadores en la misma zona.

### A5. 🟡 ¿Modelo de mundo: por jugador o compartido?
El MVP es de una sola zona local. El diseño completo tiene zonas personales,
compartidas, *wild* y de gremio (`Zone.type`). ¿El backend modela desde ya
N zonas con dueño, aunque el MVP use una sola?

> **Recomendación:** sí, modelar `Zone` con `ownerPlayerId?` y `type` desde el
> principio (costo bajo, evita migración dolorosa). El MVP instancia una única
> zona `personal`.
Respuesta: De acuerdo.

### A6. 🟢 ¿Multiplataforma de front confirmada?
El contrato debe ser agnóstico de tecnología (JSON sobre HTTP/WS). ¿Targets
previstos? (web canvas/WebGL seguro; ¿nativo, móvil?). Afecta sólo a que el
contrato no filtre detalles de una UI concreta.

Respuesta: Targets previstos: web, móvil y alguna plataforma cerrada que maneja webview. El contrato debe ser agnóstico de tecnología (JSON sobre HTTP/WS).
---

## B. Modelo de datos

### B1. 🟡 GDD vs MVP: ¿modelo completo o simplificado primero?
El GDD define el sistema rico (`ItemType` + `ItemInstance` + `ItemLocation`,
`ResearchProject`/`ResearchNode`, `PlayerTechnique` con niveles, `MachineProject`).
El MVP lo aplana (items con `properties` sueltas, `Knowledge` como flags
`idea|technique|discovery`).

- ¿El backend nace con el modelo rico y el MVP usa un subconjunto, o nace plano y
  evoluciona?

> **Recomendación:** nacer con el modelo rico **pero** sólo implementar los campos
> que el MVP usa. Evita reescribir el dominio en 0.3 cuando entre investigación.
Respuesta: De acuerdo.

### B2. 🟡 `ItemType` vs `ItemInstance`: ¿catálogo data-driven?
Para el pilar "mirar/probar/fallar" con **propiedades** (no recetas exactas),
conviene que `ItemType`, `WorldObjectType`, recetas y nodos de research sean
**data-driven** (JSON/DB), no hardcode.

> **Recomendación:** catálogo data-driven expuesto por el backend. El cliente lo
> consume para nombres/sprites/descripciones. Pendiente: ¿formato y versionado del
> catálogo?
Respuesta: De acuerdo.

### B3. 🟡 Inventario: regla de "manos" y formas
La fila superior es `x--x`: slots `(0,0)` y `(3,0)` son manos; `(1,0)` y `(2,0)`
son espacios para objetos largos sostenidos con ambas manos. MVP: "objeto activo
si ocupa `(0,0)` o `(3,0)`".

- ¿Cómo se marca activo un objeto largo que ocupa los slots centrales? (futuro:
  "toca cualquier slot de mano").
- Rotación: MVP recomienda 90° sólo para `1x2` y `1x3`. ¿Se implementa o se deja?
Respuesta: De acuerdo. Se implementa rotación para objetos largos, pero no para objetos de 1x1. La regla de "manos" se mantiene como está en el MVP.

### B4. 🟢 Pilas: ¿entidad o sólo visual?
El MVP define `type Pile { itemInstanceIds: string[] }`. ¿Una pila es una entidad
persistente o un agrupamiento visual de instancias en el mismo tile? Afecta a
"tomar una" vs "tomar varias".
Respuesta: Solo visual por ahora.

### B5. 🟢 IDs y coordenadas
- ¿Quién genera IDs? (recomendado: backend; cliente usa temp-ids en predicción).
- Movimiento del personaje: ¿snap por tile o continuo en píxeles? "Caminar hasta
  ese tile" sugiere por tile. Afecta pathfinding, predicción y *feel*. **Confirmar.**
Respuesta: Por ahora por tile.

---

## C. Diseño / UX

### C1. 🟡 Vida y energía en MVP
La vida "existe sólo como indicador" y no se usa todavía. La energía sí (costos
por acción). Al llegar a 0 energía: ¿sólo muestra "estoy demasiado cansado" y
**bloquea** la acción, o hay algo más? ¿Hay muerte/daño en MVP? (Parece que no.)
Respuesta: Cuando se va quedando sin energia por distintos umbrales puede que las cosas tarden mas en hacerse o puedan fallar si esta muy baja. No hay muerte/daño en MVP.

### C2. 🟡 Interacción en tiles `explored` (fuera de visión)
Regla MVP: tiles explorados se pueden clickear para **moverse** si son caminables;
los objetos fuera de visión **no** se interactúan. Confirmar que alcanza para el
slice (sin línea de visión real con obstáculos).
Respuesta: De acuerdo.

### C3. 🟢 Pathfinding sin camino
Segundo click lejos = caminar. ¿Qué pasa si no hay path válido (rodeado de jungla
/ agua)? Mensaje en primera persona. ¿Pathfinding simple A* sobre `walkable`?
Respuesta: De acuerdo. Si no hay path válido, mostrar mensaje en primera persona: "No puedo llegar allí desde aquí."

### C4. 🟡 Combinaciones ocultas: ¿dónde y cómo se detectan?
En MVP están "hardcodeadas". Se detectan por contexto (items en manos / cerca en
mesa o suelo). ¿El `CraftingDiscoverySystem` escanea proximidad cada acción?
¿Radio? ¿La combinación primero desbloquea *conocimiento* y recién después permite
crear el item (como sugiere "Atadura simple")?
Respuesta: De acuerdo.

### C5. 🟢 Técnicas vs conocimiento
GDD: `PlayerTechnique` con niveles I/II/III y enseñanza entre jugadores.
MVP: flags planas. ¿La transición de flags → técnicas con nivel está planificada
para 0.3/0.7? (Relacionado con [B1](#b1--gdd-vs-mvp-modelo-completo-o-simplificado-primero).)
Respuesta: De acuerdo. La transición de flags → técnicas con nivel está planificada para mas adelante.

---

## D. Producto / alcance

### D1. 🟢 Arte y assets
Pixel art top-down "perspectiva ligeramente inclinada, tipo granja/RPG 2D".
¿Arte propio, tilesets existentes, generado? Fuera de lo técnico, pero condiciona
el frontend (tamaño de tile, atlas de sprites).
Respuesta: Arte propio, pero se pueden usar tilesets existentes como referencia o inspiración.


### D2. 🟢 Tamaño de tile y mapa
MVP recomienda mapa `32x24 tiles`, radio de visión `5`. ¿Tamaño de tile en px?
Define cámara, zoom y assets.
Respuesta: Tile base: 16x16 px. Escalado en juego: x3 o x4. Objetos chicos: 16x16. Objetos medianos: 16x32 / 32x32. Personaje: 16x24 o 24x32. UI icons: 16x16 o 24x24.

### D3. 🟢 Tiempo offline (post-MVP)
Las máquinas son "procesos temporizados" que corren offline (Fase 8 / MVP 0.4).
¿Se resuelven *lazy* al cargar la zona (calcular delta de tiempo) o con un
scheduler/tick en backend? No aplica al MVP, pero el modelo de `Machine` debería
preverlo.
Respuesta: Se resuelven lazy al cargar la zona (calcular delta de tiempo).

---

## Decisiones ya tomadas (resumen)

Todas las preguntas A–D fueron respondidas inline (arriba). Consolidado:

| # | Decisión | Vive en |
|---|---|---|
| Doc | Documentación por capas / dominio | este repo `docs/` |
| A1 | Backend-first desde MVP, **SQLite** → Postgres después | [backend-api](3-backend-api/separacion-backend-frontend.md#implicancias-para-el-mvp) |
| A2/A3 | Backend autoritativo de estado+reglas; cliente predice mov./observación; reglas data-driven | [backend-api](3-backend-api/separacion-backend-frontend.md), [interacción](2-dominio/interaccion-contextual.md) |
| A4 | Comando→evento; **real-time post-MVP** misma zona (WebSocket) | [backend-api](3-backend-api/separacion-backend-frontend.md#forma-del-contrato-propuesta) |
| A5 | `Zone` con `ownerPlayerId?`+`type` desde ya; MVP usa una `personal` | [modelo de datos](2-dominio/modelo-de-datos.md#mundo) |
| A6 | Targets web / móvil / webview cerrada; contrato agnóstico | [frontend](4-frontend/responsabilidades-frontend.md#targets-y-especificaciones-decidido) |
| B1/B2 | Modelo rico, implementar sólo campos del MVP; catálogo data-driven | [modelo de datos](2-dominio/modelo-de-datos.md) |
| B3 | Rotación para objetos largos (no 1x1); regla de manos del MVP | [modelo de datos](2-dominio/modelo-de-datos.md#inventario), [inventario MVP](5-mvp/inventario-dragdrop-pilas.md) |
| B4 | Pilas **solo visual** por ahora | [modelo de datos](2-dominio/modelo-de-datos.md#inventario) |
| B5 | Movimiento **snap por tile**; IDs los genera el backend | [frontend](4-frontend/responsabilidades-frontend.md#targets-y-especificaciones-decidido) |
| C1 | Energía por **umbrales** (lentitud / chance de fallo); sin muerte en MVP | [energía y durabilidad MVP](5-mvp/energia-durabilidad.md) |
| C2 | Interacción en `explored` sólo movimiento (alcanza para el slice) | [mapa y visión MVP](5-mvp/mapa-y-vision.md) |
| C3 | Sin path → "No puedo llegar allí desde aquí." (A* sobre `walkable`) | [control y HUD MVP](5-mvp/control-hud.md) |
| C4 | `CraftingDiscoverySystem` por contexto; combinación desbloquea conocimiento primero | [construcciones y combinaciones MVP](5-mvp/construcciones-combinaciones.md) |
| C5 | Flags → técnicas con nivel, planificado para más adelante | [técnicas y herramientas](1-diseno/tecnicas-herramientas.md) |
| D1/D2 | Arte propio; tile 16x16, escalado x3/x4 (tabla de tamaños) | [frontend](4-frontend/responsabilidades-frontend.md#targets-y-especificaciones-decidido) |
| D3 | Tiempo offline **lazy** al cargar zona (delta) | [máquinas y base](1-diseno/maquinas-base.md) |

### Pendientes menores (no bloquean el MVP)

- **B2:** formato y versionado del catálogo data-driven.
- **C4:** radio exacto de detección de proximidad para combinaciones.
