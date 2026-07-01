# Crafting, combinación e investigación

> Fuente: GDD v2 §17 y §18. Estructuras en
> [modelo de datos](../2-dominio/modelo-de-datos.md#conocimiento-investigación-y-técnicas).

## 17. Crafting y combinación

### 17.1. No hay libro de recetas

El juego no debe dar una lista completa de recetas. Debe dar: observaciones, ideas,
hipótesis, proyectos, necesidades funcionales.

### 17.2. Combinación manual

Al principio, el jugador puede intentar combinar objetos usando las manos o una
superficie simple.

```
Piedra + rama:       "La piedra podría servir como cabeza, pero no se sostiene."
Rama + fibra:        "Puedo atarlas."
Piedra + rama + fibra: "No es bonita, pero hice una herramienta."
```

### 17.3. Métodos

El resultado depende del método. Métodos tempranos: manos, suelo, mesa rústica,
fogata, horno primitivo, mortero, molino, prensa.

```
Tierra + agua en mano = barro.
Tierra + agua en molde = adobe.
Barro + fuego = cerámica.
Barro + horno = ladrillo.
```

## 18. Investigación

### 18.1. Cuaderno de investigación

El cuaderno registra hipótesis, no recetas.

```
Hipótesis: Horno primitivo
Creo que necesito:
- contener calor;
- mantener combustible;
- usar algo moldeable;
- practicar con fuego.
```

### 18.2. Nodos de investigación

Cada investigación tiene nodos. Ej. *Fundición básica*: contención de calor,
combustión sostenida, comprensión del mineral, práctica con fuego, control de aire,
separación de impurezas.

### 18.3. Requisitos conceptuales

Los nodos piden **propiedades**, no objetos exactos. Ej. *Contención de calor*
acepta piedra, barro, ladrillo, cerámica — pero cada uno aporta distinto.

### 18.4. Progreso ramificado

Cuando un nodo se completa, puede revelar otros.

```
Contención de calor completa
↓
Se revela: Control de aire · Cámara estable
```

### 18.5. Fallos útiles

Un fallo puede avanzar investigación.

> "La piedra se agrietó. No soporta bien ciclos largos de calor."

Eso puede aportar poco a *Comprensión térmica*.

## Relacionado

- [Técnicas y herramientas](tecnicas-herramientas.md)
- [Reglas de diseño para expansión](../2-dominio/reglas-de-expansion.md)
- [Combinaciones ocultas (MVP)](../5-mvp/construcciones-combinaciones.md)
- [Conocimiento e investigación (MVP)](../5-mvp/conocimiento-investigacion.md)
