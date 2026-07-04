# Futboledos ⚽ — Quiniela del Mundial 2026

> ### ▶️ Clasificación en vivo: **<https://marcusmcfly.github.io/futboledos_wc26/index.html?view=all>**
>
> 24 participantes, 104 partidos, cero backend. Todo lo que ves —ranking, pools,
> rachas, flechas de movimiento, estadísticas— se calcula **en tu navegador** a
> partir de unos ficheros de texto en este repo. Ábrela y curiosea; abajo te
> contamos qué estás mirando y cómo está hecho.

**Sitio 100 % estático** (GitHub Pages), sin base de datos, sin build, sin
dependencias: HTML + módulos ES nativos. Un `fetch` a cuatro ficheros y funciones
puras. Si te gustan los sistemas deterministas, pequeños y sin magia, sigue leyendo.

---

## Por qué existe este proyecto

Este proyecto es una aplicación web social de predicciones que convierte una
dinámica sencilla entre amigos en un producto digital usable: sin login, fácil de
compartir, con pools, rankings, reglas de puntuación, visualizaciones y métricas
de engagement.

La finalidad principal es aprender construyendo un producto real, pasándolo bien
en el proceso y explorando conceptos de UX, gamificación, puntuación, rankings,
pools, visualizaciones y analítica ligera.

A nivel técnico, el proyecto demuestra cómo una idea social puede transformarse en
una aplicación completa con baja fricción para el usuario, arquitectura simple,
modelado de datos en JSON y despliegue estático de bajo coste.

---

## La idea en 30 segundos

```
 Parte 1 — Predicción                Admin                  Parte 2 — Visualizador
 ────────────────────                ─────                  ──────────────────────
 predicciones.html                                          index.html
 · pronostica los 104 partidos       guarda el .txt en      · ranking individual
 · genera un bloque de texto  ─env─▶  data/submissions/  ─▶ · ranking de pools
   FUTBOLEDOS_PRED_V1                 y lo añade a            · estadísticas + rachas
 · todo en el navegador              registry.json           · score = predicción ∩ oficial
```

El concepto clave: **nada se guarda "calculado".** El resultado oficial y cada
predicción son el *mismo* formato de texto (`FUTBOLEDOS_PRED_V1`). Puntuar es
literalmente **intersecar tu predicción con el oficial** con funciones puras. Cambia
un marcador en `official/results.txt` y todo el sitio —ranking, pools, bonus,
banners— se recalcula solo al recargar. No hay estado que pueda quedar
desincronizado porque no hay estado: hay *derivación*.

Tres decisiones que lo hacen interesante para un perfil técnico:

- **Determinismo total.** `leaderboard = f(predicciones, oficial, reglas)`. Las
  reglas viven en `data/scoring_rules.json`; la UI de «Cómo se puntúa» se *genera*
  leyéndolas, así que nunca miente respecto al motor.
- **Snapshots como log de eventos.** El "movimiento" del ranking (▲/▼) y las
  "rachas" no se almacenan: se derivan comparando el tablero vivo contra una serie
  de cortes (`data/snapshots/NNN.json`). Cada corte es una jornada en una línea
  temporal reconstruible.
- **Tests sin navegador.** El motor son módulos ES que Node ejecuta tal cual
  (`npm test`): parser, puntuación, estadísticas, historia y hasta el render del
  visualizador, con `document`/`fetch` stubbeados. Sin framework, sin transpilar.

---

## Qué vas a ver si navegas

Emulaciones de las vistas reales, con **nicks reales** de esta clasificación. La web
las pinta bonitas; aquí van en monoespaciado para que se entienda el concepto.

### 1) Un adelantamiento por un marcador exacto

El marcador **exacto** es la jugada que más puntúa de un solo golpe (**+6** en
eliminatorias, **+5** en fase de grupos), y por eso es la que más adelantamientos
provoca. Imagina un futuro cruce de octavos: **Txauri** clava el marcador exacto
(+6), **Benjamin** solo acierta que ganaba (+2) y **Blazquez_96** falla el cruce
(+0). El visualizador toma un *snapshot* antes de registrar el resultado, así que en
esa misma actualización aparecen las flechas:

```
Antes del resultado                    Después (snapshot → tablero vivo)
─────────────────────                  ─────────────────────────────────
 #  Participante   Total  Exa           #  Mov  Participante   Total  Exa
 3  Blazquez_96     495    9            3  ▲2   Txauri          496   14
 4  Benjamin        491   10            4  ▼1   Blazquez_96     495    9
 5  Txauri          490   13            5  ▼1   Benjamin        493   10
```

```
Movimiento · desde el último corte
  ▲2  Txauri
  👀  La línea de JesusGG: 🟢 Txauri adelantó a JesusGG
```

Un único +6 catapulta a Txauri de **#5 a #3**. La columna **Exa** (marcadores
exactos) es también el primer criterio de desempate, de modo que clavar resultados
no solo suma: te protege en los empates a puntos. El panel **«Movimiento»** resume
quién sube y marca los cruces con el participante de referencia (*«la línea de
JesusGG»*: quién lo adelantó o cayó por detrás de él en esta jornada).

> En la web real la tabla trae además columnas por bloque (Gru · Rnk · 3º · KO ·
> Bon) y cada nombre enlaza a su ficha con el desglose completo.

### 2) Rachas · tendencias acumuladas

Las **rachas** no miran una jornada: recorren **toda la serie de snapshots** y
detectan tendencias sostenidas. Se reparte un logro por persona (el más vistoso,
por peso) para que el protagonismo no se concentre siempre en el líder:

```
Rachas · tendencias acumuladas
──────────────────────────────
 👑  Alberto_Soria   10 actualizaciones como líder
 ⭐  Benjamin        20 actualizaciones en el top 5
 🥉  Marcus           8 actualizaciones en el podio
 🥉  Blazquez_96      7 actualizaciones en el podio

⚠️  Zona de descenso · 3 últimos puestos
 🔻  Julio           18 actualizaciones en descenso
 🔻  Verde            8 actualizaciones en descenso
 🔻  Jacobo           2 actualizaciones en descenso
```

Cómo se leen: 👑 **líder** sostenido (rank 1 en ≥2 cortes), 🔥 **escalada** (varias
subidas seguidas; un empate la corta), 🥉 **podio** (top 3, ≥3 cortes), ⭐ **top 5**
(≥4 cortes) y 📈 **récord personal** (su mejor puesto histórico). La **zona de
descenso** es la racha negativa simétrica: varias actualizaciones en los 3 últimos puestos.
Todo sale de `computeStreaks(tablero, snapshots)` en `js/history.js`; el mismo
cálculo lo imprime por consola `node scripts/streaks.mjs` cuando el admin registra
resultados.

### 3) Fase de grupos: un grupo que se cierra

Cuando un grupo completa sus 6 partidos, se consolida su clasificación y se cruza
con lo que pronosticaron los participantes (`groupCrossStats` en `js/stats.js`). Así
quedó el **Grupo A**:

> 🏁 **Grupo A cerrado · clasificación definitiva**

| # | Equipo | Pts | PJ | G | E | P | GF | GC | DG | Predicho aquí |
|---|--------|----:|---:|--:|--:|--:|---:|---:|---:|--------------:|
| 1 | México            | 9 | 3 | 3 | 0 | 0 | 6 | 0 | +6 | 66.7 % |
| 2 | Sudáfrica         | 4 | 3 | 1 | 1 | 1 | 2 | 3 | −1 | 20.8 % |
| 3 | Corea del Sur     | 3 | 3 | 1 | 0 | 2 | 2 | 3 | −1 | 20.8 % |
| 4 | República Checa   | 1 | 3 | 0 | 1 | 2 | 2 | 6 | −4 | 25 %   |

```
Acertaron: 1.º 66.7% · 2 clasificados 16.7% · orden completo 8.3% · media 8.8 pts (24 pred.)
😮 Sorpresa del grupo: República Checa (pronosticada 2.6.º → terminó 4.º)
🎯 Orden completo (4/4): Kike · Vic
```

La columna **«Predicho aquí»** es el % de participantes que colocó a ese equipo en
esa posición; la **sorpresa** es el equipo con mayor desfase entre su posición media
pronosticada y la real; y los **héroes** son quienes clavaron el orden 4/4 (aquí,
Kike y Vic).

### 4) Fase eliminatoria: ¿quién pasa?

En eliminatorias cada uno rellena **su propio cuadro**, así que no comparten rival:
lo que se agrega por cruce es *a quién pronostican que pasa*. Cuando el partido se
juega, salen los aciertos. Así quedó un cruce de dieciseisavos:

> **Resultado oficial: 3–0 · pasa Francia**

```
Acertaron quién pasa ............. 23 / 24
Acertaron el cruce (ambos) ....... 12 / 24
Acertaron el marcador exacto ......  5 / 24
```

```
✅ Acertaron quién pasa: Carlos-Seco · ivancalle10 · Ales · Mata · Txauri · DCJ · JBC ·
   Julio · Fuentes · Jacobo · JesusGG · Marcus · Morses · Alberto_Soria · Asturfutbol ·
   Benjamin · Blazquez_96 · Borja · CMC · Kike · Pollico · VBJ · Vic
🤝 Acertaron el cruce: ivancalle10 · Ales · DCJ · Julio · Jacobo · Marcus · Alberto_Soria ·
   Benjamin · Borja · CMC · Kike · Vic
🎯 Marcador exacto: Ales · DCJ · Marcus · Kike · Vic
```

Fíjate en el embudo: casi todos vieron pasar a Francia (23/24), la mitad acertó el
**cruce** exacto (los dos equipos) y solo 5 clavaron el **3–0**. Cada nivel puntúa
distinto, y ese último grupo es el que se lleva el +6. Debajo de cada ronda, la web
añade un **«Top acertantes por fase»** con quién lleva más clasificados acertados.

**Enlaces para curiosear la web real:**
[clasificación](https://marcusmcfly.github.io/futboledos_wc26/index.html?view=all) ·
[partidos de grupo](https://marcusmcfly.github.io/futboledos_wc26/index.html?view=matches) ·
[fase eliminatoria](https://marcusmcfly.github.io/futboledos_wc26/index.html?view=ko-matches) ·
[cómo se puntúa](https://marcusmcfly.github.io/futboledos_wc26/index.html?view=scoring) ·
[una ficha de participante](https://marcusmcfly.github.io/futboledos_wc26/index.html?nick=Marcus)

---

## Cómo funciona por dentro

### Estructura

```
predicciones.html          Parte 1: formulario de pronóstico (autocontenido, funciona con file://)
index.html                 Parte 2: visualizador (carga js/visualizer.js como módulo)
css/styles.css             Estilos (tema oscuro, compartido)
js/
  visualizer.js            Router (?view=/?nick=/?pool=/?match=…) + render de las vistas
  data.js                  Carga de los ficheros de /data
  parse_prediction.js      Texto FUTBOLEDOS_PRED_V1 → objeto estructurado
  scoring.js               Motor de puntuación (partido, ranking, terceros, KO, progresión)
  leaderboard.js           Ranking individual + desempates
  pools.js                 Ranking de pools (media por participante activo)
  stats.js                 Distribución, exact-score heroes, contrarian, precisión, top-por-fase
  history.js               Movimiento de ranking + rachas (líder/escalada/podio/top5) vs snapshots
  projection.js            "Techo" y escenarios de cada ficha (máximo alcanzable + rivales)
data/
  registry.json            ÍNDICE (admin, a mano): participantes + pools
  scoring_rules.json       Reglas de puntos + meta (evento, fecha límite)
  teams.json               id de equipo → nombre
  official/results.txt     Resultados oficiales (admin) en formato FUTBOLEDOS_PRED_V1
  submissions/<nick>.txt   Predicciones recibidas
  snapshots/               Cortes de la clasificación (movimiento de ranking + rachas)
scripts/
  snapshot.mjs             Genera un corte de la clasificación (admin)
  streaks.mjs              Reporta las rachas actuales (solo lectura)
  standings.mjs            Regenera el orden oficial de un grupo al cerrarse
  test_*.mjs               Tests (Node, sin navegador)
```

### Modelo de datos

| Fichero | Quién lo edita | Contiene |
|---|---|---|
| `data/submissions/<nick>.txt` | Admin (pega lo recibido) | La predicción tal cual la exporta `predicciones.html` |
| `data/registry.json` | Admin (a mano) | Qué predicciones existen y cómo se agrupan en pools |
| `data/official/results.txt` | Admin (según se juega) | Resultados oficiales, en el mismo formato de predicción |
| `data/scoring_rules.json` | Admin | Valores de puntos, desempates, fecha límite |

**Identidad y pools.** Cada predicción se identifica por **nick** (un fichero). Los
pools solo referencian nicks; un mismo nick puede estar en varios pools con su misma
predicción. Un pool necesita ≥3 participantes activos para entrar en el ranking
oficial de pools (media de puntos por activo, para que un grupo pequeño compita con
uno grande).

> La web estática no puede listar `data/submissions/` sola, por eso el
> `registry.json` declara los ficheros. Pensado para <50 participantes; se mantiene
> a mano.

### Puntuación (resumen)

El total es la suma de cinco bloques: **partidos de grupo**, **ranking de grupo**,
**mejores terceros**, **eliminatorias** y **bonus de progresión** (puntos que suben
según tus equipos avanzan de ronda, por cualquier vía). Los valores están en
`data/scoring_rules.json` y la página **«Cómo se puntúa»** (`?view=scoring`) los
explica leyéndolos de ahí, así que documentación y motor nunca divergen.

---

## Flujo del admin

**Nueva predicción recibida:**
1. Guarda el texto en `data/submissions/<nick>.txt`.
2. Añade el participante (y su pool, si tiene) a `data/registry.json`.

**Cargar un resultado (según se juega):** el patrón es siempre *snapshot → editar →
recalcular contadores*, para que el corte capture el estado **anterior** y salgan las
flechas de movimiento en esa misma actualización:

```bash
node scripts/snapshot.mjs "Antes de D_01 (Estados Unidos-Paraguay)"
# → congela la clasificación en data/snapshots/NNN.json y la añade a index.json
```

Luego se rellena el marcador en `data/official/results.txt` (fase de grupos en el
bloque `[PARTIDOS]`; eliminatorias en los bloques `[DIECISEISAVOS]`…`[FINAL]`, donde
además se propaga el ganador al cruce siguiente) y se recalculan los contadores de
cabecera. El resto (leaderboard, banners, bonus, rachas) se deriva solo. Se
commitean juntos `results.txt`, el `snapshots/NNN.json` nuevo y `snapshots/index.json`.

**Agentes.** El subagente `.claude/agents/actualizar-resultado.md` automatiza ese
flujo: le das el resultado en cualquier forma —`"Estados Unidos 4 - Paraguay 1"`,
`"D_01 4 1"`, `"ZA 0 1 CA"`— y resuelve el partido vía `data/teams.json`, genera el
snapshot baseline, escribe el marcador, propaga el bracket y recalcula contadores,
dejando los cambios sin commitear para que los revises.

---

## Desarrollo

Los módulos ES + `fetch` necesitan servirse por HTTP (no con `file://`):

```bash
python -m http.server 8000   # desde la raíz del repo → http://localhost:8000/
```

`predicciones.html` sí funciona con `file://` (es autocontenido).

**Tests** (Node, sin navegador):

```bash
npm test    # parser + motor + estadísticas + historia + proyección + render del visualizador
```

## Despliegue (GitHub Pages)

Sin CI ni build: **Settings → Pages → Deploy from a branch**, rama principal, carpeta
raíz `/`. El `.nojekyll` evita el procesado Jekyll.

## Licencia

Código bajo **Apache License 2.0** — ver [`LICENSE`](LICENSE). Licencia permisiva
(uso comercial, modificación y distribución) que exige conservar los avisos de
copyright/licencia y marcar los ficheros modificados, e incluye concesión expresa de
patentes.
