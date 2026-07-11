// Test de funstats (curiosidades). node scripts/test_funstats.mjs
import {
  predMatches, teamGoals, teamTier, tierLabel, goalProfiles, teamTotals,
  teamAffinity, contrarianIndex, similarity, sharpshooters, finalistDistribution, buildFunStats,
} from "../js/funstats.js";

let pass = 0, fail = 0;
const eq = (a, e, m) => (JSON.stringify(a) === JSON.stringify(e) ? pass++ :
  (fail++, console.error(`  ✗ ${m}\n      esperado ${JSON.stringify(e)}, obtenido ${JSON.stringify(a)}`)));
const ok = (c, m) => (c ? pass++ : (fail++, console.error(`  ✗ ${m}`)));

const gm = (home, away, hg, ag) => ({ home, away, hg, ag });
const ko = (round, home, away, hg, ag, qualified) =>
  ({ round, home_slot: "?", away_slot: "?", home, away, hg, ag, qualified, pen: null });
const P = (nick, g, k, champion) => ({ nick, champion, groupMatches: g, groupOrder: {}, thirdsQualified: [], knockout: k });

// A vs B, C vs D, A vs C ; KO: semi A-C, final A-B.
const mkKo = (semiQ, finalQ, chB) => ({
  M101: ko("SEMIS", "A", "C", semiQ === "A" ? 2 : 0, semiQ === "A" ? 1 : 1, semiQ),
  M104: ko("FINAL", finalQ, chB, 1, 0, finalQ),
});
const P1 = P("P1", { G1: gm("A", "B", 2, 0), G2: gm("C", "D", 1, 1), G3: gm("A", "C", 3, 1) }, mkKo("A", "A", "B"), "A");
const P2 = P("P2", { G1: gm("A", "B", 2, 0), G2: gm("C", "D", 1, 1), G3: gm("A", "C", 3, 1) }, mkKo("A", "A", "B"), "A");
const P3 = P("P3", { G1: gm("A", "B", 0, 1), G2: gm("C", "D", 0, 0), G3: gm("A", "C", 0, 2) }, mkKo("C", "C", "B"), "C");
const preds = [P1, P2, P3];

// predMatches / teamGoals
eq(predMatches(P1).length, 5, "predMatches: 3 grupo + 2 KO");
eq(teamGoals(P1, "A"), { gf: 8, ga: 2, matches: 4, dg: 6 }, "teamGoals A en P1");
eq(teamGoals(P1, "D"), { gf: 1, ga: 1, matches: 1, dg: 0 }, "teamGoals D en P1 (solo G2)");

// teamTier
eq(teamTier(P1, "A"), 6, "tier: A es campeón (6)");
eq(teamTier(P1, "C"), 4, "tier: C llega a semis (4)");
eq(teamTier(P1, "B"), 5, "tier: B es finalista (5)");
eq(teamTier(P1, "D"), 0, "tier: D se queda en grupos (0)");
eq(tierLabel(6), "Campeón", "tierLabel 6");

// goalProfiles
const prof = goalProfiles(preds).find((x) => x.nick === "P1");
eq([prof.total, prof.matches, prof.draws], [12, 5, 1], "goalProfiles P1: total/partidos/empates");
eq(prof.biggest.total, 4, "goalProfiles P1: mayor goleada = 4 (3-1)");

// teamTotals: A marca en 3 quinielas; GF agregado
const tt = teamTotals(preds);
const A = tt.find((t) => t.id === "A");
eq(A.champions, 2, "teamTotals A: campeón en 2 quinielas (P1,P2)");
ok(A.gf === teamGoals(P1, "A").gf + teamGoals(P2, "A").gf + teamGoals(P3, "A").gf, "teamTotals A gf = suma de las 3");

// teamAffinity C: P3 lo hace campeón
const affC = teamAffinity(preds, "C");
ok(affC.find((x) => x.nick === "P3").champion === true, "teamAffinity C: P3 lo hace campeón");

// contrarianIndex: P3 (signos minoritarios) más rebelde que P1
const ci = contrarianIndex(preds);
const rP1 = ci.find((x) => x.nick === "P1").rarity, rP3 = ci.find((x) => x.nick === "P3").rarity;
ok(rP3 > rP1, `contrarian: P3 (${rP3}) más rebelde que P1 (${rP1})`);
eq(rP1, 22.2, "contrarian: rareza P1 = 22.2%");

// similarity: P1 y P2 idénticas → 100%
const sim = similarity(preds);
ok(sim.mostSimilar[0].sim === 100 && [sim.mostSimilar[0].a, sim.mostSimilar[0].b].sort().join() === "P1,P2", "similarity: P1 y P2 gemelas al 100%");
eq(sim.loner.nick, "P3", "similarity: P3 es el lobo solitario");

// sharpshooters: oficial con G1 = A2-0B jugado → P1/P2 exacto, P3 no
const official = {
  groupMatches: { G1: { home: "A", away: "B", hg: 2, ag: 0 }, G2: { home: "C", away: "D", hg: null, ag: null } },
  knockout: {},
};
const sh = sharpshooters(preds, official);
eq(sh.find((x) => x.nick === "P1").exact, 1, "sharpshooters: P1 clava G1");
eq(sh.find((x) => x.nick === "P3").exact, 0, "sharpshooters: P3 falla G1");

// finalistDistribution: B en las 3, A en 2, C en 1
const fin = finalistDistribution(preds);
eq(fin[0], { id: "B", count: 3, pct: 100 }, "finalistas: B finalista en las 3");

// buildFunStats: cablea todo sin romper
const fs = buildFunStats(preds, official, "A");
eq(fs.n, 3, "buildFunStats: n=3");
ok(fs.goals.goleador.nicks.length >= 1 && fs.goals.tacano.value <= fs.goals.goleador.value, "buildFunStats: goleador ≥ tacaño");
ok(fs.character.rebelde.nicks.includes("P3"), "buildFunStats: rebelde = P3");
ok(fs.star.id === "A" && fs.star.reach.length === 7, "buildFunStats: termómetro del equipo estrella (A), 7 tramos");
ok(fs.sharp && fs.sharp.played === 1, "buildFunStats: pistolero con 1 partido jugado");

console.log(`\nfunstats: ${pass} OK, ${fail} fallos`);
process.exit(fail ? 1 : 0);
