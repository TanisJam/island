# Inventario físico, drag & drop y contenedores

> Fuente: GDD v2 §10, §11 y §12. Detalle MVP en
> [inventario, drag & drop y pilas (MVP)](../5-mvp/inventario-dragdrop-pilas.md).

## 10. Inventario físico

### Inventario inicial

Grilla `4x4`. La fila superior representa las manos.

```
x--x
xxxx
xxxx
xxxx
```

```
[Mano I] [espacio] [espacio] [Mano D]
[bolsa ] [bolsa ] [bolsa ] [bolsa ]
[bolsa ] [bolsa ] [bolsa ] [bolsa ]
[bolsa ] [bolsa ] [bolsa ] [bolsa ]
```

Los espacios centrales de la fila superior permiten objetos largos sostenidos con
ambas manos.

### Objetos no apilables

Los objetos no se apilan mágicamente en la mochila. Cada objeto físico existe como
instancia.

```
Piedra pequeña: 1x1
Fibra: 1x1
Rama: 1x2
Herramienta rudimentaria: 1x2
Tronco: 1x4
Cuenco: 2x2
```

### Activación por manos

Un objeto se considera activo si ocupa o toca un slot de mano.

```
[Piedra] [ ] [ ] [Fibra]      → piedra y fibra activas
[Tronco][Tronco][Tronco][Tronco] → carga un tronco con ambas manos
[Hacha][Hacha][ ] [ ]          → hacha equipada
```

> ✅ **Decidido (B3):** rotación 90° para objetos largos (`1x2`/`1x3`/`1x4`), no para
> `1x1`. Regla de "activo" como en el MVP: ocupa `(0,0)` o `(3,0)`.

### Expansión futura

mochila, cinturón, canasto, carreta, bolsas laterales, animales de carga,
herramientas de transporte. Pero el inventario inicial debe sentirse limitado.

## 11. Drag & drop

- **Inventario → mundo:** arrastrar un objeto al mundo lo coloca en el tile elegido
  si hay espacio. *"Dejé la piedra en el suelo."*
- **Mundo → inventario:** intenta acomodarlo; si no entra, *"No tengo espacio para
  acomodarlo."*
- **Inventario → contenedor:** mover a una caja/canasta/depósito si entra.
- **Inventario → máquina:** arrastrar combustible a una fogata, barro al horno, etc.
- **Mundo → máquina:** un objeto en el suelo cerca de una máquina puede arrastrarse
  directamente a ella (refuerza la idea de campamento físico).

## 12. Suelo, pilas y contenedores

### El campamento como inventario expandido

El inventario del jugador no debe ser el lugar donde vive todo. El campamento es el
inventario grande: dejar piedras junto a la fogata, apilar ramas cerca de la mesa,
guardar fibras en una canasta, colocar mineral al lado del horno.

### Pilas

Cuando varios objetos similares están cerca, pueden formar una pila (pila de
piedras, pila de ramas, montón de fibra, troncos apilados). Las pilas existen en el
mundo, ocupan tiles y pueden crecer visualmente.

> ✅ **Decidido (B4):** en el MVP la pila es **sólo visual** (no entidad persistente).

### Contenedores

```
Canasta: pequeña, hecha con fibras, buena para semillas/fibras/comida.
Caja rústica: hecha con madera, más capacidad.
Depósito: estructura de base, capacidad grande.
```

Cada contenedor tiene su propia grilla física.

## Relacionado

- [UI / HUD (manos)](ui-hud.md)
- [Modelo de datos (inventario)](../2-dominio/modelo-de-datos.md#inventario)
- [Inventario, drag & drop y pilas (MVP)](../5-mvp/inventario-dragdrop-pilas.md)
- [Base del jugador](maquinas-base.md#22-base-del-jugador)
