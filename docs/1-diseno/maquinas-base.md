# Máquinas y base del jugador

> Fuente: GDD v2 §21 y §22. Estructuras en
> [modelo de datos](../2-dominio/modelo-de-datos.md#máquinas).

## 21. Máquinas

### 21.1. Principio

Las máquinas automatizan dolores. No deben ser sólo upgrades numéricos: deben
cambiar **cómo** el jugador organiza su base.

### 21.2. Descubrimiento de máquinas

```
Repetición manual:  machacar muchas veces desbloquea idea de molino.
Cuello de botella:  mucha demanda de harina desbloquea idea de molienda.
Observación:        ver máquina ajena desbloquea idea.
Investigación:      completar nodos técnicos desbloquea proyecto.
Material nuevo:     descubrir metal desbloquea ideas mecánicas.
```

### 21.3. Proyectos de máquina

Una máquina empieza como **proyecto funcional**.

```
Molino rudimentario necesita resolver:
- superficie dura;
- movimiento repetido;
- eje;
- recipiente de salida.
```

No dice `3 piedra + 2 madera + 1 cuerda`.

### 21.4. Slots funcionales

```
Slot: Superficie dura  → acepta hardness
Slot: Movimiento       → acepta rotation, leverage, manual_force
Slot: Estructura       → acepta structure, wood, binding
```

### 21.5. Prototipos

La primera versión casi siempre es imperfecta: molino rudimentario (lento, manual,
pierde material) → molino básico (más eficiente, acepta más inputs) → molino
automático (usa agua, viento o motor).

### 21.6. Máquinas tempranas (MVP)

```
Fogata · Mesa rústica · Horno primitivo · Molino manual ·
Triturador rudimentario · Contenedor/caja
```

> ✅ **Decidido (D3):** los procesos temporizados que corren offline se resuelven
> **lazy** al cargar la zona (calculando el delta de tiempo), no con un scheduler
> permanente. El modelo de máquina debe prever el timestamp del último proceso.

## 22. Base del jugador

### 22.1. Qué es la base

La base es el campamento personal. Contiene: objetos en el suelo, pilas,
contenedores, estaciones, máquinas, caminos, construcciones, zonas despejadas.

### 22.2. Colocación

Las construcciones y objetos se colocan en tiles. Reglas: no sobre agua, no sobre
jungla espesa, no bloquear al personaje completamente, algunos objetos requieren
suelo específico.

### 22.3. Radio de trabajo

Cada estación o máquina puede detectar materiales cercanos.

```
Fogata: detecta combustible adyacente, piedras alrededor, objetos colocados cerca
        para experimentos.
Mesa:   usa objetos sobre su superficie; puede usar contenedores adyacentes (futuro).
Horno:  usa input + combustible + output; puede tomar de contenedor cercano (avanzado).
```

## Relacionado

- [Inventario físico y contenedores](inventario-fisico.md#12-suelo-pilas-y-contenedores)
- [Crafting e investigación](crafting-investigacion.md)
- [Construcciones (MVP)](../5-mvp/construcciones-combinaciones.md)
- [Roadmap — Fase 8: Automatización](../6-roadmap/roadmap-modular.md)
