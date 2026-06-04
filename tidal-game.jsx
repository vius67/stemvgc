import React, { useState, useCallback } from "react";

// ============================================================================
// TIDES OF BALANCE — Puzzle Edition
// A real puzzle game: hand-crafted levels, a fixed budget of drones, place them
// on a GRID (position + adjacency matter), then COMMIT and run the cascade once.
// The puzzle is reading the food-web chain backwards and placing drones in the
// right cells in the right combination. Solve it, don't tune it.
// ============================================================================

const C = {
  abyss: "#03101a", deep: "#062130", panel: "#0c3142", edge: "#15506a",
  foam: "#eaf6f1", mist: "#9fc4ce", teal: "#3fd0bc", kelp: "#74c96e",
  coral: "#ff7e6b", amber: "#f4b860", danger: "#ff5d78", ink: "#cfe6ec",
  hot: "#e85d4a", cool: "#5fb8d9",
};
const clamp = (x) => Math.max(0, Math.min(1, x));

// ---- Drone types -----------------------------------------------------------
// Each drone modifies its OWN cell and (some) its 4-neighbours. This is what
// makes placement a spatial puzzle.
const DRONES = {
  shade:   { name: "Shade",    icon: "▦", color: "#7fb4ff", self: { temp: -0.45 }, neighbour: { temp: -0.25 }, desc: "Cools its cell + neighbours" },
  coral:   { name: "Outplant", icon: "❋", color: C.coral,   self: { _plant: 1 },   neighbour: {},               desc: "Plants coral — DIES if cell is hot" },
  protect: { name: "Protect",  icon: "⬡", color: C.teal,    self: { _predator: 0.5 }, neighbour: { _predator: 0.3 }, desc: "Predators return → eat urchins" },
  filter:  { name: "Filter",   icon: "⊛", color: C.amber,   self: { nutrients: -0.5 }, neighbour: { nutrients: -0.3 }, desc: "Cuts nutrients (algae food)" },
  grass:   { name: "Seagrass", icon: "♣", color: C.kelp,    self: { _grass: 1, oxygen: 0.4 }, neighbour: { oxygen: 0.2 }, desc: "Adds oxygen, stores carbon" },
};

// ---- Cell kinds (what lives in each grid cell) -----------------------------
// kind drives both the visual and what the cascade evaluates per cell.
//  H = hot water, C = bleached coral, A = algae, U = urchin, K = kelp(barren),
//  P = open water (predator habitat), N = nutrient source, D = dead zone(low O2),
//  G = bare seabed (seagrass site), . = open water
const LEVELS = [
  {
    id: 1, name: "First Bleach", biome: "Coral Reef", budget: 3,
    hint: "Coral outplants die in hot water. Cool the hot cells first, then plant.",
    grid: [
      [".", "H", "H", "."],
      ["H", "C", "C", "H"],
      ["H", "C", "C", "H"],
      [".", "H", "H", "."],
    ],
    targets: [{ t: "coral", label: "Coral cells alive", need: 4 }],
    note: "Coral can't survive heat stress. Real reef restoration cools and shades before outplanting — you fixed the condition before the symptom.",
  },
  {
    id: 2, name: "Algae Bloom", biome: "Coral Reef", budget: 4,
    hint: "Algae is fed by nutrients. Cut the nutrient sources AND cool the coral. Filters hit neighbours too — place them centrally.",
    grid: [
      ["N", "A", "A", "N"],
      ["A", "C", "C", "A"],
      ["H", "C", "C", "H"],
      ["N", "A", "A", "N"],
    ],
    targets: [
      { t: "coral", label: "Coral alive", need: 4 },
      { t: "algae_dead", label: "Algae cleared", need: 8 },
    ],
    note: "Algae overgrows coral when nutrients are high. Killing the nutrient supply starves the algae — a chain, not a direct attack on the algae itself.",
  },
  {
    id: 3, name: "Urchin Barren", biome: "Kelp Forest", budget: 3,
    hint: "Don't touch the urchins. Bring back PREDATORS — they eat urchins, then kelp regrows on its own. Protect drones spread to neighbours.",
    grid: [
      ["P", "U", "U", "P"],
      ["U", "K", "K", "U"],
      ["U", "K", "K", "U"],
      ["P", "U", "U", "P"],
    ],
    targets: [
      { t: "urchin_gone", label: "Urchins removed", need: 8 },
      { t: "kelp", label: "Kelp regrown", need: 4 },
    ],
    note: "A trophic cascade: predators control urchins, urchins control kelp. Restore the predator and the whole chain rights itself. You never touched the kelp.",
  },
  {
    id: 4, name: "Dead Zone Delta", biome: "Estuary", budget: 5,
    hint: "The dead zone (D) needs oxygen. Seagrass adds oxygen + spreads it. But nutrients (N) keep feeding algae that steals oxygen — cut them too.",
    grid: [
      ["N", "A", "A", "N", "."],
      ["D", "D", "G", "A", "N"],
      ["D", "G", "G", "D", "A"],
      ["N", "A", "G", "D", "."],
      [".", "N", "A", "A", "N"],
    ],
    targets: [
      { t: "grass", label: "Seagrass meadow", need: 4 },
      { t: "oxygen", label: "Dead zones revived", need: 4 },
    ],
    note: "Eutrophication: nutrients feed blooms that crash oxygen. Seagrass re-oxygenates while filters choke the nutrient supply — two coordinated levers fix the system.",
  },
];

// ---- The cascade: evaluate the whole grid after drones are committed -------
// Each cell gets a local state from drone effects (self + neighbour), then we
// resolve survival/growth rules and count target conditions.
function runCascade(level, placed) {
  const rows = level.grid.length, cols = level.grid[0].length;
  // accumulate parameter modifiers per cell
  const mod = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ temp: 0, nutrients: 0, oxygen: 0, _plant: 0, _predator: 0, _grass: 0 }))
  );
  const apply = (r, c, eff) => {
    if (r < 0 || c < 0 || r >= rows || c >= cols) return;
    for (const [k, v] of Object.entries(eff)) mod[r][c][k] += v;
  };
  for (const p of placed) {
    const d = DRONES[p.type];
    apply(p.r, p.c, d.self);
    apply(p.r - 1, p.c, d.neighbour); apply(p.r + 1, p.c, d.neighbour);
    apply(p.r, p.c - 1, d.neighbour); apply(p.r, p.c + 1, d.neighbour);
  }

  // baseline params by cell kind
  const result = Array.from({ length: rows }, () => Array(cols).fill(null));
  const counts = {};
  const bump = (k) => (counts[k] = (counts[k] || 0) + 1);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const kind = level.grid[r][c];
      const m = mod[r][c];
      const temp = (kind === "H" ? 0.85 : 0.45) + m.temp;       // hot cells start hot
      const nutrients = (kind === "N" || kind === "A" ? 0.8 : 0.3) + m.nutrients;
      const oxygen = (kind === "D" ? 0.2 : 0.6) + m.oxygen;
      let outcome = kind;

      if (kind === "C") { // bleached coral cell — needs plant + cool
        if (m._plant > 0 && temp <= 0.6) { outcome = "coral_live"; bump("coral"); }
        else if (m._plant > 0) outcome = "coral_dead"; // planted but cooked
        else outcome = "C";
      }
      else if (kind === "A") { // algae — dies if nutrients cut low
        if (nutrients <= 0.45) { outcome = "clear"; bump("algae_dead"); }
        else outcome = "A";
      }
      else if (kind === "U") { // urchin — removed if predators present
        if (m._predator > 0) { outcome = "clear"; bump("urchin_gone"); }
        else outcome = "U";
      }
      else if (kind === "K") { // barren kelp site — regrows if neighbour urchins handled
        const urchinNeighbourGone = neighboursHandled(level, mod, r, c);
        if (urchinNeighbourGone) { outcome = "kelp_live"; bump("kelp"); }
        else outcome = "K";
      }
      else if (kind === "G") { // seabed → seagrass if planted
        if (m._grass > 0) { outcome = "grass_live"; bump("grass"); }
        else outcome = "G";
      }
      else if (kind === "D") { // dead zone → revived if oxygen raised
        if (oxygen >= 0.55) { outcome = "revived"; bump("oxygen"); }
        else outcome = "D";
      }
      result[r][c] = { kind, outcome, temp, nutrients, oxygen };
    }
  }
  const targets = level.targets.map((t) => ({ ...t, have: counts[t.t] || 0, met: (counts[t.t] || 0) >= t.need }));
  return { result, targets, win: targets.every((t) => t.met) };
}

function neighboursHandled(level, mod, r, c) {
  // kelp regrows if all adjacent urchin cells have predators
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  let anyUrchin = false, allHandled = true;
  for (const [dr, dc] of dirs) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nc < 0 || nr >= level.grid.length || nc >= level.grid[0].length) continue;
    if (level.grid[nr][nc] === "U") {
      anyUrchin = true;
      if (mod[nr][nc]._predator <= 0) allHandled = false;
    }
  }
  return anyUrchin ? allHandled : true;
}

// ---- Cell visuals ----------------------------------------------------------
function CellVisual({ cell, committed }) {
  const k = committed ? cell.outcome : cell.kind;
  const map = {
    ".": { bg: "#0a3344", body: null },
    H: { bg: "#7a2a28", body: "🔥" },
    C: { bg: "#5a6b6e", body: "🪸", dim: true },
    coral_live: { bg: "#0a3a44", body: "🪸" },
    coral_dead: { bg: "#5a2a2a", body: "💀" },
    A: { bg: "#3f5a25", body: "🟢" },
    clear: { bg: "#0a3a44", body: null },
    N: { bg: "#5a4a1f", body: "☣" },
    U: { bg: "#3a2a4a", body: "🟣" },
    urchin_gone: { bg: "#0a3a44", body: null },
    K: { bg: "#243a2a", body: "🟫" },
    kelp_live: { bg: "#0c3a2a", body: "🌿" },
    P: { bg: "#0a3344", body: null },
    G: { bg: "#2e2a1f", body: "·" },
    grass_live: { bg: "#0c3a2a", body: "🌾" },
    D: { bg: "#2a1a2a", body: "☠" },
    revived: { bg: "#0a3a44", body: "💧" },
  };
  const v = map[k] || { bg: "#0a3344", body: null };
  return (
    <div style={{ position: "absolute", inset: 0, background: v.bg, display: "flex", alignItems: "center",
      justifyContent: "center", fontSize: 22, opacity: v.dim ? 0.5 : 1, transition: "all .4s",
      filter: k === "C" ? "grayscale(1) brightness(1.6)" : "none" }}>
      {v.body}
    </div>
  );
}

// ============================================================================
export default function App() {
  const [screen, setScreen] = useState("intro");
  const [lvlIdx, setLvlIdx] = useState(0);
  const level = LEVELS[lvlIdx];

  const [placed, setPlaced] = useState([]); // {r,c,type}
  const [selected, setSelected] = useState("shade");
  const [committed, setCommitted] = useState(false);
  const [outcome, setOutcome] = useState(null);

  const reset = useCallback(() => { setPlaced([]); setCommitted(false); setOutcome(null); }, []);
  const startLevel = (i) => { setLvlIdx(i); reset(); setScreen("play"); setSelected(Object.keys(allowedDrones(LEVELS[i]))[0]); };

  const cellClick = (r, c) => {
    if (committed) return;
    const existing = placed.find((p) => p.r === r && p.c === c);
    if (existing) { setPlaced(placed.filter((p) => p !== existing)); return; }
    if (placed.length >= level.budget) return;
    setPlaced([...placed, { r, c, type: selected }]);
  };

  const commit = () => {
    const res = runCascade(level, placed);
    setOutcome(res);
    setCommitted(true);
  };

  const cols = level.grid[0].length;

  // ---- intro ---------------------------------------------------------------
  if (screen === "intro") {
    return (
      <Shell>
        <p style={{ color: C.teal, letterSpacing: 4, fontSize: 12, textTransform: "uppercase", margin: 0 }}>STEM Video Game Challenge · Ocean</p>
        <h1 style={title}>Tides of Balance</h1>
        <p style={{ color: C.ink, lineHeight: 1.7, maxWidth: 600 }}>
          A systems puzzle. Each level is a damaged ocean grid. You get a limited set of eco-drones —
          place them on the right cells, then <b style={{ color: C.foam }}>commit and run the cascade once</b>.
          You can't fix things directly: cool the water before coral will grow, bring back predators to clear urchins,
          starve the algae by cutting nutrients. Read the chain backwards and solve it in as few drones as possible.
        </p>
        <div style={{ display: "grid", gap: 10, marginTop: 22, maxWidth: 600 }}>
          {LEVELS.map((lv, i) => (
            <button key={lv.id} onClick={() => startLevel(i)} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: C.teal, fontSize: 11, letterSpacing: 2, textTransform: "uppercase" }}>Level {lv.id} · {lv.biome}</span>
                <span style={{ color: C.amber, fontSize: 12, fontWeight: 700 }}>{lv.budget} drones</span>
              </div>
              <div style={{ fontSize: 18, color: C.foam, fontWeight: 700, marginTop: 4 }}>{lv.name}</div>
            </button>
          ))}
        </div>
      </Shell>
    );
  }

  const allowed = allowedDrones(level);

  // ---- play ----------------------------------------------------------------
  return (
    <Shell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 11, color: C.teal, letterSpacing: 2, textTransform: "uppercase" }}>Level {level.id} · {level.biome}</div>
          <div style={{ fontSize: 22, color: C.foam, fontWeight: 700 }}>{level.name}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: C.mist, letterSpacing: 1.5, textTransform: "uppercase" }}>Drones</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: placed.length > level.budget ? C.danger : C.foam }}>{placed.length}/{level.budget}</div>
        </div>
      </div>

      <div style={{ background: "rgba(63,208,188,0.08)", border: `1px solid ${C.edge}`, borderRadius: 10, padding: "9px 12px", fontSize: 13, color: C.ink, marginBottom: 12 }}>
        💡 {level.hint}
      </div>

      {/* GRID */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 5, aspectRatio: `${cols} / ${level.grid.length}`, marginBottom: 14 }}>
        {level.grid.map((row, r) =>
          row.map((_, c) => {
            const p = placed.find((x) => x.r === r && x.c === c);
            const cellData = committed && outcome ? outcome.result[r][c] : { kind: level.grid[r][c] };
            return (
              <div key={`${r}-${c}`} onClick={() => cellClick(r, c)}
                style={{ position: "relative", borderRadius: 10, overflow: "hidden", cursor: committed ? "default" : "pointer",
                  border: `1px solid ${p ? DRONES[p.type].color : C.edge}`, boxShadow: p ? `0 0 12px ${DRONES[p.type].color}66` : "none" }}>
                <CellVisual cell={cellData} committed={committed} />
                {p && (
                  <div style={{ position: "absolute", top: 3, right: 3, width: 22, height: 22, borderRadius: "50%",
                    background: DRONES[p.type].color, color: C.abyss, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                    {DRONES[p.type].icon}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* targets */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        {(committed ? outcome.targets : level.targets.map((t) => ({ ...t, have: 0, met: false }))).map((t) => (
          <div key={t.label} style={{ flex: 1, minWidth: 130, background: C.panel, border: `1px solid ${t.met ? C.teal : C.edge}`, borderRadius: 10, padding: "8px 12px" }}>
            <div style={{ fontSize: 12, color: t.met ? C.teal : C.mist }}>{t.met ? "✓ " : "○ "}{t.label}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: t.met ? C.teal : C.foam }}>{t.have}/{t.need}</div>
          </div>
        ))}
      </div>

      {/* drone palette */}
      {!committed && (
        <div style={{ background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.teal, letterSpacing: 2, textTransform: "uppercase", marginBottom: 9 }}>Pick a drone, then tap a cell</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(allowed).map(([id, d]) => (
              <button key={id} onClick={() => setSelected(id)}
                style={{ flex: "1 1 120px", textAlign: "left", padding: "9px 11px", borderRadius: 10, cursor: "pointer",
                  background: selected === id ? d.color + "22" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${selected === id ? d.color : C.edge}`, color: C.ink }}>
                <span style={{ fontSize: 16, color: d.color }}>{d.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.foam, marginLeft: 6 }}>{d.name}</span>
                <div style={{ fontSize: 10.5, color: C.mist, marginTop: 3 }}>{d.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* result banner */}
      {committed && (
        <div style={{ background: outcome.win ? "rgba(63,208,188,0.12)" : "rgba(255,93,120,0.12)",
          border: `1px solid ${outcome.win ? C.teal : C.danger}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: outcome.win ? C.teal : C.danger }}>
            {outcome.win ? "✓ Ecosystem Restored!" : "✕ Cascade incomplete — rethink the chain"}
          </div>
          {outcome.win && <p style={{ color: C.ink, fontSize: 13, lineHeight: 1.6, margin: "8px 0 0" }}>{level.note}</p>}
        </div>
      )}

      {/* controls */}
      <div style={{ display: "flex", gap: 10 }}>
        {!committed && <button onClick={commit} disabled={placed.length === 0} style={{ ...btn, opacity: placed.length === 0 ? 0.5 : 1 }}>▶ Run Cascade</button>}
        {committed && !outcome.win && <button onClick={reset} style={btn}>↺ Try Again</button>}
        {committed && outcome.win && lvlIdx < LEVELS.length - 1 && <button onClick={() => startLevel(lvlIdx + 1)} style={btn}>Next Level →</button>}
        {committed && outcome.win && lvlIdx === LEVELS.length - 1 && <button onClick={() => setScreen("intro")} style={btn}>🏆 Finish</button>}
        {!committed && placed.length > 0 && <button onClick={() => setPlaced([])} style={ghost}>Clear</button>}
        <button onClick={() => setScreen("intro")} style={ghost}>Levels</button>
      </div>
    </Shell>
  );
}

// only show drones relevant to a level's mechanics (keeps the puzzle focused)
function allowedDrones(level) {
  const flat = level.grid.flat().join("");
  const set = {};
  if (flat.includes("C") || flat.includes("H")) { set.shade = DRONES.shade; set.coral = DRONES.coral; }
  if (flat.includes("A") || flat.includes("N")) set.filter = DRONES.filter;
  if (flat.includes("U")) set.protect = DRONES.protect;
  if (flat.includes("G") || flat.includes("D")) set.grass = DRONES.grass;
  return set;
}

// ---- chrome ----------------------------------------------------------------
function Shell({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: `radial-gradient(1000px 500px at 70% -10%, ${C.deep}, ${C.abyss})`,
      fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "26px 18px 50px" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>{children}</div>
    </div>
  );
}
const title = { fontFamily: "Georgia, serif", fontSize: 44, color: C.foam, margin: "6px 0 14px", fontWeight: 700, letterSpacing: -1 };
const card = { background: `linear-gradient(160deg, ${C.panel}, ${C.deep})`, border: `1px solid ${C.edge}`, borderRadius: 14, padding: 14, textAlign: "left", cursor: "pointer", color: C.ink };
const btn = { background: C.teal, color: C.abyss, border: "none", padding: "12px 22px", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" };
const ghost = { background: "transparent", color: C.mist, border: `1px solid ${C.edge}`, padding: "11px 18px", borderRadius: 10, fontSize: 13, cursor: "pointer" };
