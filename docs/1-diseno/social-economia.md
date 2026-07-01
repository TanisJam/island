# Multiplayer asincrónico, gremios y economía

> Fuente: GDD v2 §23, §24 y §25. Fuera del MVP; ver
> [post-MVP](../6-roadmap/post-mvp.md). El modelo de `Zone` ya prevé estos casos
> ([A5](../PREGUNTAS.md#a5--modelo-de-mundo-por-jugador-o-compartido)).

## 23. Multiplayer asincrónico

### 23.1. Bases visitables

Cada jugador tiene su campamento persistido. Otros pueden visitarlo si el permiso lo
permite.

```
Privado · Amigos · Gremio · Público
```

### 23.2. Qué puede hacer un visitante

Según permisos: mirar base, usar máquinas, dejar objetos, tomar objetos permitidos,
aprender técnicas, pagar tarifas, comprar/intercambiar.

### 23.3. Uso de máquinas ajenas

Una máquina pública puede tener reglas: gratis, traer combustible propio, cobro
fijo, cobro porcentual, sólo gremio, sólo enseñanza.

```
Horno de Mauricio:
Permiso: Gremio
Tarifa: 1 carbón cada 5 usos
Enseña: Fundición I
```

### 23.4. Enseñanza

Un jugador avanzado puede configurar una estación como lugar de enseñanza (la mesa
de carpintería enseña Carpintería I y Atadura básica; el horno enseña Fundición I y
Cerámica básica).

### 23.5. No tiempo real

Los jugadores no necesitan verse en vivo. Cuando se visita una base, se carga su
estado persistido y las acciones quedan registradas.

> "Carla usó tu horno y dejó 2 carbones como pago."

> ✅ **Decidido (A4):** este registro encaja con el modelo **comando→evento**.
> Post-MVP se agrega **tiempo real** sólo para jugadores en la **misma zona**.

## 24. Gremios y progreso global

### 24.1. Gremios

Permiten colaboración estructurada: base comunitaria, proyectos globales,
tecnologías compartidas, ranking interno, roles.

### 24.2. Proyectos de gremio

```
Herrería comunitaria requiere:
- 500 ladrillos · 200 lingotes · 30 jugadores con Fundición I · 10 hornos activos.
Desbloquea:
- recetas de herrería · mejora de hornos · nuevo tipo de herramienta · acceso a zona rocosa.
```

### 24.3. Progreso por eras

```
Era Náufrago · Era Manual · Era Artesanal · Era Mecánica · Era Industrial · Era Eléctrica
```

Cada era desbloquea nuevos tipos de problemas, no sólo más objetos.

## 25. Economía

### 25.1. Economía física

Como los objetos no son stacks abstractos, la economía debe sentirse tangible. Los
jugadores comercian: objetos, herramientas, materiales procesados, acceso a
máquinas, enseñanza de técnicas, uso de espacio, transporte futuro.

### 25.2. Especialización

El diseño debe permitir que no todos hagan lo mismo: recolector, carpintero,
herrero, molinero, constructor, explorador, maquinista, investigador, comerciante,
maestro.

## Relacionado

- [Pilar 4.7 — La cooperación acelera, pero no reemplaza](../0-vision/02-pilares.md#47-la-cooperación-acelera-pero-no-reemplaza)
- [Roadmap — Fases 6 y 7](../6-roadmap/roadmap-modular.md)
- [Post-MVP](../6-roadmap/post-mvp.md)
