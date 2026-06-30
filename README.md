# Futboledos ⚽ — Quiniela del Mundial 2026

**Sitio 100% estático** (GitHub Pages), sin backend ni base de datos. Toda la
puntuación se calcula en el navegador a partir de ficheros JSON/TXT publicados en
el repositorio. Sin build, sin dependencias: HTML + módulos ES nativos.

## Las dos partes

```
 Parte 1 — Predicción                Admin                  Parte 2 — Visualizador
 ────────────────────                ─────                  ──────────────────────
 predicciones.html                                          index.html
 · pronostica los 104 partidos       guarda el .txt en      · ranking individual
 · genera un bloque de texto  ─env─▶  data/submissions/  ─▶ · ranking de pools
   FUTBOLEDOS_PRED_V1                 y lo añade a            · estadísticas
 · todo en el navegador              registry.json           · score = pred ∩ oficial
```

El participante rellena `predicciones.html`, copia el bloque de texto que se
genera solo y te lo envía. Tú lo guardas como `data/submissions/<nick>.txt` y lo
declaras en `data/registry.json`. El visualizador puntúa en vivo contra los
resultados oficiales.

## Estructura

```
predicciones.html          Parte 1: formulario de pronóstico (autocontenido, funciona con file://)
index.html                 Parte 2: visualizador (carga js/visualizer.js como módulo)
css/styles.css             Estilos (tema oscuro, compartido)
js/
  visualizer.js            Router + render de las vistas
  data.js                  Carga de los ficheros de /data
  parse_prediction.js      Texto FUTBOLEDOS_PRED_V1 → objeto estructurado
  scoring.js               Motor de puntuación (partido, ranking, terceros, KO, progresión)
  leaderboard.js           Ranking individual + desempates
  pools.js                 Ranking de pools (media por participante activo)
  stats.js                 Estadísticas (distribución, exact-score heroes, contrarian, precisión)
  history.js               Movimiento de ranking + rachas (líder/escalada/top 5) vs snapshots
data/
  registry.json            ÍNDICE (admin, a mano): participantes + pools
  scoring_rules.json       Reglas de puntos + meta (evento, fecha límite)
  teams.json               id de equipo → nombre
  official/results.txt     Resultados oficiales (admin) en formato FUTBOLEDOS_PRED_V1
  submissions/<nick>.txt   Predicciones recibidas
  snapshots/               Cortes de la clasificación (movimiento de ranking + rachas)
  groups.json · round_of_32.json · knockout_rounds.json · third_place_assignment_table.json
                           Fixtures y bracket oficial (referencia)
scripts/
  snapshot.mjs             Genera un corte de la clasificación (admin)
  streaks.mjs              Reporta las rachas actuales (solo lectura)
  test_*.mjs               Tests (Node, sin navegador)
```

## Modelo de datos

| Fichero | Quién lo edita | Contiene |
|---|---|---|
| `data/submissions/<nick>.txt` | Admin (pega lo recibido) | La predicción tal cual la exporta `predicciones.html` |
| `data/registry.json` | Admin (a mano) | Qué predicciones existen y cómo se agrupan en pools |
| `data/official/results.txt` | Admin (según se juega) | Resultados oficiales, en el mismo formato de predicción |
| `data/scoring_rules.json` | Admin | Valores de puntos, desempates, fecha límite |

**Identidad y pools.** Cada predicción se identifica por **nick** (un fichero). Los
pools solo referencian nicks; un mismo nick puede estar en varios pools con su
misma predicción. Una persona que quiera otra predicción usa otro nick. Un pool
necesita ≥3 participantes activos para entrar en el ranking oficial de pools.

> La web estática no puede listar `data/submissions/` sola, por eso el
> `registry.json` declara los ficheros. Pensado para <50 participantes; se
> mantiene a mano.

## Puntuación (resumen)

El total es la suma de cinco bloques: partidos de grupo, ranking de grupo,
mejores terceros, eliminatorias y bonus de progresión. Los valores están en
`data/scoring_rules.json` y la página **«Cómo se puntúa»** (`?view=scoring`) los
explica leyéndolos de ahí. Definición completa en `docs/06_points_system.docx`;
pools en `docs/07_points_system_pools.docx`; estadísticas en
`docs/08_part_2_visualization.docx`.

## Flujo del admin

**Nueva predicción recibida:**
1. Guarda el texto en `data/submissions/<nick>.txt`.
2. Añade el participante (y su pool, si tiene) a `data/registry.json`.

**Cargar un resultado oficial (según se juega):**

Cada línea del bloque `[PARTIDOS]` de `data/official/results.txt` es
`<GRUPO>_<NN> <LOCAL> <gl> <gv> <VISITANTE>` (p. ej. `D_01 US - - PY`), con `-`
mientras no se ha jugado. Para registrar un partido jugado:

1. **Snapshot ANTES de editar** (para que salgan las flechas de movimiento en
   esta misma actualización):
   ```bash
   node scripts/snapshot.mjs "Antes de D_01 (Estados Unidos-Paraguay)"
   ```
   Congela la clasificación actual en `data/snapshots/NNN.json` y la añade a
   `index.json`. La web compara el tablero nuevo contra ese corte → flechas
   ▲/▼ + panel «Movimiento».
2. Rellena el marcador en la línea (`D_01 US 4 1 PY`) y **recalcula** los
   contadores de cabecera: `partidos: X/72` y `grupos_completos: Y/12`. El resto
   (leaderboard, banners) se recalcula solo.
3. Commitea y pushea los tres ficheros juntos: `results.txt`,
   `snapshots/NNN.json`, `snapshots/index.json`.

**Agente `actualizar-resultado` (recomendado para fase de grupos).** El subagente
`.claude/agents/actualizar-resultado.md` automatiza el flujo anterior: le das el
resultado en cualquier forma —`"Estados Unidos 4 - Paraguay 1"`, `"D_01 4 1"` o
`"US 4 1 PY"`— y él resuelve el partido vía `data/teams.json`, genera el snapshot
baseline, escribe el marcador y recalcula los contadores. Deja los cambios sin
commitear para que los revises. Solo cubre **fase de grupos** (las eliminatorias
se registran a mano por ahora). Aparece en `/agents` tras reiniciar Claude Code.

## Desarrollo

Los módulos ES + `fetch` necesitan servirse por HTTP (no con `file://`). Con
Python:

```bash
python -m http.server 8000   # desde la raíz del repo → http://localhost:8000/
```

`predicciones.html` sí funciona con `file://` (es autocontenido).

**Tests** (Node, sin navegador):

```bash
npm test    # parser + motor + estadísticas + historia + render del visualizador
```

## Despliegue (GitHub Pages)

Sin CI ni build: **Settings → Pages → Deploy from a branch**, rama principal,
carpeta raíz `/`. El `.nojekyll` evita el procesado Jekyll.

## Licencia

Código bajo **Apache License 2.0** — ver [`LICENSE`](LICENSE). Licencia permisiva
(uso comercial, modificación y distribución) que exige conservar los avisos de
copyright/licencia, marcar los ficheros modificados e incluye concesión expresa
de patentes.
