// Carga de las fuentes de verdad estáticas desde /data (rutas relativas, sin
// caché). Cada fetch puede fallar → la UI muestra estado de error.
// @ts-check

async function loadJson(file) {
  const res = await fetch(`./data/${file}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar ${file} (HTTP ${res.status}).`);
  return res.json();
}

async function loadText(file) {
  const res = await fetch(`./data/${file}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar ${file} (HTTP ${res.status}).`);
  return res.text();
}

export const loadRegistry = () => loadJson("registry.json");
export const loadRules = () => loadJson("scoring_rules.json");
export const loadTeams = () => loadJson("teams.json");
export const loadSubmission = (file) => loadText(`submissions/${file}`);

// El oficial puede no existir aún (torneo sin empezar) → texto vacío = todo pendiente.
export async function loadOfficial() {
  try {
    return await loadText("official/results.txt");
  } catch {
    return "";
  }
}
