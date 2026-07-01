# MVP — Construcciones y combinaciones ocultas

> Fuente: MVP Systems Spec §15 y §16.

## 15. Construcciones MVP

### Fogata

Propósito: primer centro del campamento, habilitar experimentos con calor, futuro
puente hacia contención de calor y horno.

> Necesita combustible y un lugar seguro donde mantenerlo. (No mostrar receta exacta.)

Para MVP se puede construir con: ramas/madera pobre, piedras cerca, fibra/tela
opcional para encendido.

**Fogata apagada** — primer click: *"Una fogata improvisada. Todavía no arde."*
Acciones: Añadir combustible · Intentar encender · Examinar.

**Fogata encendida** — primer click: *"El fuego me hace sentir menos perdido."*
Acciones: Añadir combustible · Probar material con calor · Examinar.

### Mesa rústica

Propósito: superficie para combinar, ordenar objetos, desbloquear herramientas más
confiables.

> Necesito una superficie estable para trabajar mejor.

Para MVP la mesa puede ser simple o incluso reemplazada por "superficie de trabajo"
inicial. Idealmente construir con madera pobre, ramas, fibra.

**Mesa** — primer click: *"Con una superficie estable puedo probar mejor las piezas."*
Acciones: Usar materiales cercanos · Ensamblar · Examinar.

## 16. Combinaciones ocultas MVP

El jugador no ve estas recetas como lista. Internamente existen reglas.

> ✅ **Decidido (C4):** el `CraftingDiscoverySystem` detecta combinaciones por
> contexto (items en manos / cerca en mesa o suelo). La combinación primero
> desbloquea **conocimiento** y recién después permite crear el item. Radio exacto
> de proximidad: pendiente menor.

### Atadura simple

- **Condición:** fibra vegetal o restos de tela en mano; rama seca en otra mano o cerca.
- **Resultado:** desbloquea idea "atar".
- **Pensamiento:** *"Puedo unir piezas si las ato bien."*
- Puede no crear item todavía, sólo conocimiento.

### Herramienta rudimentaria

- **Condición:** piedra pequeña; rama seca; fibra vegetal o restos de tela; acción
  "improvisar herramienta" en mesa/suelo.
- **Resultado:** consume materiales; crea herramienta rudimentaria; desbloquea técnica
  "Atadura básica" si no existe.
- **Pensamiento:** *"No es una gran herramienta, pero es mejor que mis manos."*

### Fogata

- **Condición:** ramas secas o madera pobre; piedras pequeñas cerca o en inventario;
  acción "armar fogata" en tile válido.
- **Resultado:** crea fogata apagada.
- **Pensamiento:** *"Si logro encenderla, este lugar puede empezar a ser un campamento."*

### Encender fogata

- **Condición MVP simplificada:** fogata apagada; rama seca o madera pobre como
  combustible; herramienta rudimentaria o piedra en mano.
- **Resultado:** fogata encendida.
- **Éxito:** *"El fuego prendió. Por primera vez desde que desperté, tengo un punto al
  que volver."*
- **Fallo:** *"Casi prende, pero todavía no entiendo bien cómo mantenerlo."*

### Hacha simple

- **Condición:** herramienta rudimentaria o piedra; madera pobre; fibra vegetal; mesa
  rústica o superficie de trabajo.
- **Resultado:** crea hacha simple.
- **Pensamiento:** *"Esta sí podría abrirme paso entre la vegetación."*

### Despejar jungla

- **Condición:** hacha simple activa en mano; jungla espesa seleccionada; energía
  suficiente; distancia correcta.
- **Resultado:** cambia tile de jungla a suelo transitable; revela zona detrás;
  reduce durabilidad del hacha.
- **Pensamiento:** *"Abrí un pequeño paso. La isla no termina acá."*

## Relacionado

- [Crafting e investigación (GDD)](../1-diseno/crafting-investigacion.md)
- [Conocimiento e investigación (MVP)](conocimiento-investigacion.md)
- [CraftingDiscoverySystem](../2-dominio/sistemas.md)
- [Matriz de interacciones](interaccion-matriz.md)
