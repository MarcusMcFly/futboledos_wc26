# Futboledos ⚽

Quiniela de predicciones del Mundial. **Sitio 100% estático** (GitHub Pages),
sin backend ni base de datos. El estado vive en tres ficheros JSON publicados en
el repositorio; el scoring se calcula en el cliente.

## Ciclo de vida del dato

```
 Usuario (UI)                Admin                       Visualizador
 ───────────                 ─────                       ────────────
 1. Rellena el form
 2. UI genera bloque  ──email manual──▶  3. merge_submissions.py
    POOL_SUBMISSION_V1                      valida · dedup · deadline
                                            genera participants.json
                                         4. commit  ──▶ GitHub Pages  ──▶ 5. score = predictions ∩ results
```

El producto es el **ciclo completo**: creación → email → merge → score → visualización.

## Estructura

**Sin build, sin dependencias.** HTML + módulos ES nativos que el navegador
ejecuta directamente; GitHub Pages sirve los archivos tal cual.

```
index.html                Visualizador / clasificación
submit.html               Formulario de predicción
.nojekyll                 Evita el procesado Jekyll de GitHub Pages
css/styles.css            Estilos
js/
  types.js                Modelo de datos (JSDoc, solo documentación)
  scoring.js              score = count(predictions ∩ confirmed_outcomes) + contradicciones
  submission.js           Validación cliente + generación del bloque + deadline
  standings.js            Clasificación de grupo (pura): puntos, GF/GC/DG, J/G/E/P, orden
  groupstage.js           Render + recálculo inmediato de las tablas de grupo
  data.js                 Carga de JSON (rutas relativas) con estados de error
  home.js                 Render del visualizador
  submit.js               Render del formulario (predicciones + fase de grupos)
data/
  catalog.json            Opciones oficiales + closes_at (deadline)
  groups.json             Fixtures de fase de grupos (schema_version 1)
  participants.json       GENERADO por el merge — nunca editar a mano
  results.json            Resultados oficiales (confirmed_outcomes)
scripts/
  merge_submissions.py    Merge flow del administrador (Spec 8) — requiere Python
```

## Las tres fuentes de verdad

| Fichero | Quién lo edita | Contiene |
|---|---|---|
| `catalog.json` | Admin (manual) | Opciones válidas, categorías exclusivas, `closes_at` |
| `participants.json` | **Script de merge** | Submissions validadas y deduplicadas |
| `results.json` | Admin (manual, tras el evento) | `confirmed_outcomes` para el scoring |

## Formato de submission (POOL_SUBMISSION_V1)

```
POOL_SUBMISSION_V1
nickname: marcos
pool_name: champions_friends
submitted_at: 2026-05-28T10:12:00+02:00
predictions:
  - winner_real_madrid
  - top_scorer_mbappe
  - finalist_city
END_POOL_SUBMISSION
```

**Envío:** email a `pools@futboledos.example.com` con asunto exacto
`POOL_SUBMISSION_V1`. Cualquier otro asunto/formato se ignora en el merge.

> `submitted_at` lo genera el dispositivo del usuario: es **informativo**, no
> prueba de envío a tiempo. El rechazo definitivo por deadline lo decide el
> admin según la recepción real del email.

## Reglas de negocio clave

- **Deadline** (`closes_at`): la UI deshabilita el form; el merge rechaza lo posterior.
- **Duplicados**: `(nickname, pool_name)` → gana la primera submission válida. Mismo nickname en pools distintos = permitido.
- **Pool names públicos**: sin contraseña ni invitación. Decisión de diseño intencional.
- **Contradicciones**: dos predicciones de la misma categoría `exclusive: true` se resaltan en el visualizador.
- **Malformadas**: se mueven a `scripts/emails/rejected/` con motivo en `rejected.log`.

## Clasificación dinámica de grupo

En la página de predicción, cada grupo muestra una tabla que se recalcula **al
instante** desde los marcadores que introduce el usuario (no se edita a mano):

- Victoria 3 pts · empate 1 · derrota 0.
- `GF`/`GC` goles a favor/contra · `DG = GF − GC` · `J` jugados · `G`/`E`/`P` victorias/empates/derrotas.
- Un partido con cualquiera de los dos goles vacío **no** afecta a la tabla.
- Orden: 1) Pts · 2) DG · 3) GF · 4) nombre alfabético.

Los equipos de cada grupo se **derivan** de los partidos (el esquema no los lista
aparte). Datos en `data/groups.json`.

## Desarrollo

No hay nada que instalar. Los módulos ES + `fetch` necesitan servirse por HTTP
(no funcionan abriendo el HTML con `file://`), así que para previsualizar en
local levanta cualquier servidor estático. Con Python (que ya necesitas para el
merge) basta:

```bash
python -m http.server 8000   # desde la raíz del repo
# abrir http://localhost:8000/
```

## Despliegue (GitHub Pages)

Sin CI ni build: en GitHub → **Settings → Pages → Deploy from a branch**, rama
principal, carpeta raíz `/`. El `.nojekyll` evita que Pages procese los archivos.

## Merge (admin)

```bash
cd scripts
python merge_submissions.py --inbox ./emails/
# revisar diff de ../data/participants.json y commitear
```
