# Pipeline de arte

> Especificación para producir y consumir el arte del mundo de Isla Misteriosa.
> Los emojis actuales son placeholders; este documento define cómo reemplazarlos por
> sprites sin tocar el resto del cliente, apoyándose en la costura `AssetResolver`
> (`frontend/src/render/assets.ts`) introducida en `frontend-seams`.
> Dirección visual: ver [`../1-diseno/direccion-ux-ui.md`](../1-diseno/direccion-ux-ui.md).

---

## 1. Estilo

- **Pixel art top-down con perspectiva ligeramente inclinada** (`presentacion-visual.md`
  §6.1), estilo RPG/granja 2D. Base 16×16, escalado ×3–×4 en juego (48–64 px por tile).
- Mood: **isla tropical cálida pero misteriosa** bajo la tesis "Luz de fuego": color pleno
  en lo visible, atenuado en lo explorado, oscuro en lo no visto.
- Referencias (inspiración, no copia): Stardew Valley, point-and-click, mods técnicos.
  No hay un estilo pixel único clavado — se define al producir el primer set y se congela
  como guía.

---

## 2. Tamaños de asset

De `PREGUNTAS.md` D2. Base en px; el escalado lo hace el render (`PX = TILE * SCALE`).

| Asset | Base | Notas |
|-------|------|-------|
| Tile de terreno | 16×16 | Escala ×3 (48) o ×4 (64). |
| Objeto chico | 16×16 | piedra, fibra, semilla. |
| Objeto mediano | 16×32 / 32×32 | árbol, mesa, roca grande. |
| Personaje | 16×24 / 24×32 | con espacio para animación. |
| Iconos de UI | 16×16 / 24×24 | manos, acciones, contadores. |

Mapa MVP: 32×24 tiles, radio de visión 5. Canvas actual: 768×576 (16×12 a ×3).
`image-rendering: pixelated` obligatorio.

---

## 3. Paleta

- **Tokens de UI** (chrome): ver `direccion-ux-ui.md` §2.
- **Terrenos** (fuente única, ya en `assets.ts`): sand `#d9c089`, grass `#6a9a4f`,
  shallow_water `#4a90c2`, dense_jungle `#1f5c3a`, dirt `#8a6b4a`, rocky_ground `#8a8a8a`.
- Al producir sprites, derivar sombras/luces de estos base para que mundo y UI compartan
  temperatura. La brasa (`#f0a24e`) queda reservada para estados (glow), no para arte de
  mundo neutro.

---

## 4. Contrato de datos: `VisualDescriptor`

El `AssetResolver` mapea `(kind, typeId, state)` → descriptor. Hoy resuelve emoji/color;
mañana, sprites/animación. **El resto del cliente no cambia** al migrar.

```ts
// frontend/src/render/assets.ts (ya existe la interfaz)
export type VisualKind = "object" | "item" | "pile" | "player" | "terrain";

export interface VisualDescriptor {
  // capa placeholder (hoy)
  glyph?: string;    // emoji stand-in
  color?: string;    // color de terreno
  // capa sprite (futuro)
  sprite?: string;   // id/ruta en el atlas
  frames?: number;   // nº de cuadros de animación (1 = estático)
  scale?: number;    // factor de dibujo (0.72, 0.58...) — ya usado hoy
}

export interface AssetResolver {
  resolve(kind: VisualKind, typeId: string, state?: Record<string, unknown>): VisualDescriptor;
}
```

Migración: `createEmojiAssets()` → `createSpriteAssets(atlas)`, misma interfaz. El
`state` permite variantes (ej: `campfire` con `lit: true|false`).

---

## 5. Estados visuales que el arte debe soportar

Cada entidad renderizable puede requerir variantes o efectos (ver `direccion-ux-ui.md` §2):

| Estado | Origen | Tratamiento de arte |
|--------|--------|---------------------|
| Visible | `visibilityOf` (autoritativo) | Color pleno. |
| Explorado | idem | Atenuado (recuerdo) — lo aplica el render, no requiere sprite aparte. |
| No visto | idem | Oscuro — sin sprite. |
| Equipado | manos | Glow de brasa (efecto de render, no sprite). |
| Seleccionado | selección | Anillo de brasa (render). |
| Trabajando | acción con duración (§7 del doc de dirección) | Frames de "trabajo" o overlay de progreso. |
| Descubrimiento | evento | Destello de `descubrimiento` (FX de render). |
| Variantes de objeto | `state` (ej: `lit`) | Sprite/variante por estado. |

**Importante (costura):** la visibilidad se computa en `ViewState` y viaja en el `Frame`;
el renderer NO calcula `visibilityOf`. Los FX de estado (glow, anillo, progreso, destello)
son responsabilidad del render/`ViewState`, no del atlas de sprites.

---

## 6. Animación

Alineado con el game loop de `frontend-seams` (`update(dt)` + draw variable) y respetando
`prefers-reduced-motion`:

| Animación | Dónde vive | Notas |
|-----------|-----------|-------|
| Deslizamiento al moverse | `ViewState` (tween ~120ms, ya implementado) | Interpolación cosmética; el modelo sigue siendo snap por tile. |
| Idle del personaje | sprite (`frames`) | Sutil (respiración / halo de fuego ya existe). |
| Caminar | sprite (`frames`) | Opcional para MVP. |
| Beat de "trabajando" | `ViewState` + sprite | Sincroniza con la duración de la acción. |
| Destello de descubrimiento | FX de render | Puntual, `descubrimiento`. |

Menos es más: animación que sirva a la ficción (fuego, trabajo, descubrimiento). Evitar
movimiento decorativo constante.

---

## 7. Convenciones de organización

- **Atlas por capa/kind**: `terrain`, `object`, `item`, `player`, `fx`.
- **Nombres = `typeId` del catálogo** (fuente única): `tree`, `small_stone`, `dry_branch`,
  `campfire`, etc. El `AssetResolver` resuelve por ese `typeId`, así el arte queda
  desacoplado del código.
- **Variantes por estado**: sufijo (`campfire__lit`, `campfire__unlit`).
- **Formato**: PNG con transparencia; un JSON de atlas (mapa `sprite → {x,y,w,h,frames}`).

---

## 8. Estrategia de producción

- **Hoy**: emojis vía `createEmojiAssets()`. Jugable, sin bloquear el resto del diseño.
- **Orden sugerido de reemplazo** (mayor impacto primero): terrenos → personaje →
  objetos-nodo (árbol, roca, mesa, fogata) → ítems.
- **Fuente de arte**: a definir (custom / generado / tileset con licencia). El pipeline es
  agnóstico: mientras cumpla §2 (tamaños) y §7 (nombres), entra por el `AssetResolver`.
- **Congelar el estilo** con el primer set completo (terrenos + personaje) y documentarlo
  como guía antes de producir en volumen.

---

## 9. Definition of done (migración a sprites)

- [ ] Atlas + JSON que cubran el catálogo actual (6 terrenos, 6 objetos, 9 ítems).
- [ ] `createSpriteAssets()` implementa `AssetResolver` sin cambios en renderer/ViewState.
- [ ] Estados `lit`/variantes resueltos por `state`.
- [ ] Visibilidad y FX de estado siguen en render/`ViewState` (no en el atlas).
- [ ] `prefers-reduced-motion` respetado.
- [ ] Emojis quedan como fallback para `typeId` sin arte (`glyph` en el descriptor).
