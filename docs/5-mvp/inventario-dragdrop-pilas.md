# MVP — Inventario físico, drag & drop y pilas

> Fuente: MVP Systems Spec §9, §10 y §11. Diseño general en
> [inventario físico](../1-diseno/inventario-fisico.md).

## 9. Inventario físico

### Tamaño inicial

```
4x4 slots

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

### Regla de manos

Un objeto está activo si ocupa o toca un slot de mano.

```
Para MVP: un objeto está activo si ocupa el slot (0,0) o el slot (3,0).
Para futuro: un objeto largo está activo si toca cualquiera de los slots de mano.
```

### Objetos no apilables

Cada objeto ocupa espacio. No hay stacks automáticos dentro de la mochila.

### Formas MVP

```
1x1 · 1x2 · 1x3 · 1x4 · 2x2
```

> ✅ **Decidido (B3):** se implementa **rotación 90° para objetos largos**
> (`1x2`/`1x3`/`1x4`); **no** para `1x1`.

### Items iniciales y tamaños

```
Piedra pequeña: 1x1      Fibra vegetal: 1x1      Semilla silvestre: 1x1
Restos de tela: 1x1      Rama seca: 1x2          Madera pobre: 1x2
Corteza: 1x2             Herramienta rudimentaria: 1x2
Hacha simple: 1x2        Tronco liviano: 1x4
```

### Acciones de inventario

mover item dentro del inventario · poner item en mano · sacar item de mano ·
arrastrar item al mundo · arrastrar a otro inventario/contenedor (futuro) ·
combinar indirectamente al poner items en manos o cerca de estaciones.

## 10. Drag & drop

- **Inventario → mundo:** verificar tile visible y libre, colocar instancia,
  remover de inventario, generar pensamiento. *"Lo dejé en el suelo."*
- **Mundo → inventario:** verificar distancia y espacio. Si entra: *"Lo guardé."*
  Si no: *"No tengo espacio para acomodarlo."*
- **Inventario → manos:** cambia inmediatamente las acciones contextuales.
  *"Tengo la piedra lista en la mano."*
- **Mundo → pila:** al soltar un item cerca de otros similares puede crear pila o
  sólo colocarlo visualmente cerca.

```
Para MVP: agrupar visualmente objetos iguales en el mismo tile como pila simple.
```

## 11. Pilas simples

### Objetivo

Permitir que el suelo sea parte del inventario sin saturar visualmente el mapa.

### Regla MVP

```ts
type Pile = {
  id: string
  itemTypeId: string
  zoneId: string
  position: Position
  itemInstanceIds: string[]
}
```

> ✅ **Decidido (B4):** la pila es **sólo visual** por ahora (agrupa instancias del
> mismo tipo); no tiene lógica persistente propia.

### Visual

```
1 item:      objeto individual
2-4 items:   pila pequeña
5-9 items:   pila mediana
10+ items:   pila grande
```

### Interacciones con pila

> "Una pequeña pila de piedras."

Acciones: Tomar una · Tomar varias · Examinar. **Para MVP, sólo implementar "Tomar una".**

## Relacionado

- [Inventario físico (GDD)](../1-diseno/inventario-fisico.md)
- [InventorySystem](../2-dominio/sistemas.md)
- [Modelo de datos (inventario)](../2-dominio/modelo-de-datos.md#inventario)
