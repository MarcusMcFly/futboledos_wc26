// Formulario de prediccion. Genera el bloque POOL_SUBMISSION_V1 para envio por
// email manual. (Spec 5.2 / 5.3 / 5.4 / 9)
// @ts-check
import { loadCatalog, loadGroups } from "./data.js";
import {
  validateSubmission,
  generateSubmissionBlock,
  isClosed,
} from "./submission.js";
import { renderGroupStage } from "./groupstage.js";

// Direccion y asunto exactos. (Spec 5.3)
const SUBMISSION_EMAIL = "pools@futboledos.example.com";
const SUBJECT = "POOL_SUBMISSION_V1";

const $app = /** @type {HTMLElement} */ (document.getElementById("app"));

/** @param {string} s */
function escapeHtml(s) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
}

async function main() {
  $app.innerHTML = `<div class="error-state muted">Cargando…</div>`;
  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (e) {
    $app.innerHTML = `<div class="error-state"><p>⚠️ No se pudo cargar el catálogo.</p><p class="muted">${escapeHtml(
      e instanceof Error ? e.message : String(e),
    )}</p></div>`;
    return;
  }

  const closed = isClosed(catalog);
  const when = new Date(catalog.closes_at).toLocaleString("es-ES", {
    dateStyle: "long",
    timeStyle: "short",
  });

  if (closed) {
    $app.innerHTML = `
      <h1>Hacer predicción</h1>
      <div class="banner danger">⏱️ Las predicciones están cerradas (cierre: ${when}). El formulario está deshabilitado. (Spec 5.4)</div>`;
    return;
  }

  const optionsHtml = catalog.options
    .map(
      (o) =>
        `<label class="option"><input type="checkbox" value="${escapeHtml(
          o.id,
        )}"> ${escapeHtml(o.label)} <span class="muted">(${escapeHtml(
          o.category,
        )})</span></label>`,
    )
    .join("");

  $app.innerHTML = `
    <h1>Hacer predicción</h1>
    <div class="banner warn">⏱️ Cierre de predicciones: ${when}</div>
    <div class="banner warn">🔓 El nombre del pool es <strong>público</strong>. Cualquiera que lo conozca puede unirse. Si quieres privacidad, usa un nombre único y no lo compartas. No hay invitaciones ni contraseñas: es una decisión de diseño intencional.</div>

    <label for="nick">Nickname (2–30, [a-zA-Z0-9_-])</label>
    <input id="nick" type="text" autocomplete="off">

    <label for="pool">Pool name (opcional, máx 40)</label>
    <input id="pool" type="text" autocomplete="off">

    <h3>Predicciones</h3>
    ${optionsHtml}

    <h3>Fase de grupos</h3>
    <p class="muted">Introduce los marcadores; la clasificación se recalcula sola. No puedes editar la tabla a mano.</p>
    <div id="groupstage"></div>

    <p style="margin-top:1rem"><button id="gen">Generar submission</button></p>
    <div id="out"></div>
  `;

  // Fase de grupos (aditiva): si groups.json falla, el resto del form sigue.
  const $groupstage = /** @type {HTMLElement} */ (
    document.getElementById("groupstage")
  );
  loadGroups()
    .then((groupsFile) => renderGroupStage($groupstage, groupsFile))
    .catch((e) => {
      $groupstage.innerHTML = `<p class="muted">No se pudo cargar la fase de grupos (${escapeHtml(
        e instanceof Error ? e.message : String(e),
      )}).</p>`;
    });

  const $nick = /** @type {HTMLInputElement} */ (document.getElementById("nick"));
  const $pool = /** @type {HTMLInputElement} */ (document.getElementById("pool"));
  const $out = /** @type {HTMLElement} */ (document.getElementById("out"));

  document.getElementById("gen")?.addEventListener("click", () => {
    const predictions = [
      .../** @type {NodeListOf<HTMLInputElement>} */ (
        document.querySelectorAll('.option input[type="checkbox"]:checked')
      ),
    ].map((c) => c.value);

    const draft = {
      nickname: $nick.value,
      pool_name: $pool.value,
      predictions,
    };
    const { ok, errors } = validateSubmission(draft, catalog);

    if (!ok) {
      $out.innerHTML = `<ul class="errors">${errors
        .map((e) => `<li>${escapeHtml(e)}</li>`)
        .join("")}</ul>`;
      return;
    }

    const block = generateSubmissionBlock(draft);
    const mailto = `mailto:${SUBMISSION_EMAIL}?subject=${encodeURIComponent(
      SUBJECT,
    )}&body=${encodeURIComponent(block)}`;
    $out.innerHTML = `
      <div class="panel">
        <p>Copia el bloque <strong>íntegro</strong> y envíalo por email a <code>${SUBMISSION_EMAIL}</code> con el asunto exacto <code>${SUBJECT}</code>. (Spec 5.3)</p>
        <pre class="block" id="block">${escapeHtml(block)}</pre>
        <p><button id="copy">Copiar al portapapeles</button> <a href="${mailto}">Abrir en cliente de correo</a></p>
      </div>`;
    document.getElementById("copy")?.addEventListener("click", () => {
      navigator.clipboard?.writeText(block);
    });
  });
}

main();
