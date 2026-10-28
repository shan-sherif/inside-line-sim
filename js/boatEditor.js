import { BOATS, DEFAULT_BOATS } from './boats.js';

const STORE_KEY = 'inside-line-sim.boat-edits';
const OLD_STORE_KEY = 'inside-line-sim.boats';

// scale converts the stored value to what's shown (e.g. fractions as %);
// min and max are in stored units.
const PARAMS = [
  { key: 'length', label: 'Length', unit: 'm', step: 0.1, min: 2, max: 12,
    help: 'Hull length. The current is faster in mid-river than near the banks, so a boat at an angle has its bow and stern in different speeds of water; the longer the hull, the more that twists it. Also sets the size drawn.' },
  { key: 'mass', label: 'Mass with crew', unit: 'kg', step: 1, min: 20, max: 400,
    help: 'Boat plus paddlers. Heavier boats take longer to speed up and slow down. Wash pushes in proportion to mass, so it moves heavy and light boats equally.' },
  { key: 'dragK', label: 'Drag', unit: 'N/(m/s)²', step: 0.1, min: 0.5, max: 20,
    help: 'The hull\'s water resistance: drag force = this × speed². More drag means a lower top speed for the same power. Shallow water near the banks adds up to 2.5× more.' },
  { key: 'efficiency', label: 'Stroke efficiency', unit: '% of power', step: 1, scale: 100, min: 0.2, max: 1,
    help: 'Share of the paddler\'s power that drives the boat forward. A kayak\'s alternating double blade drives straight. A canoe\'s single blade on one side also yaws the boat and needs correcting every stroke, so less of its power goes forward.' },
  { key: 'maxTurn', label: 'Max turn rate', unit: '°/s', step: 1, min: 1, max: 90,
    help: 'How fast the boat turns at full steering. Holding ← or → turns at exactly this rate. The computer steers more gently, in proportion to how far off its line it is, up to this rate.' },
  { key: 'pivot', label: 'Pivot point', unit: '% from bow', step: 5, scale: 100, min: 0, max: 1,
    help: 'The point the hull turns about: 0% is the bow, 50% the middle, 100% the stern. With a rudder the stern swings out and the pivot sits towards the bow.' },
  { key: 'steerCost', label: 'Steering cost', unit: '% power', step: 1, scale: 100, min: 0, max: 0.95,
    help: 'Power lost while steering at full lock, in proportion to how hard you steer: steering at half the max turn rate costs half this. Rudders cost little; canoe correction strokes cost a lot.' },
  { key: 'twist', label: 'Twist response', unit: '× the water', step: 0.1, min: 0, max: 2,
    help: 'How strongly the hull follows the water turning it, when current or wash moves the bow sideways differently from the stern. 0 ignores it; 1 turns the hull as fast as the water does. Higher means the river and wash knock you off line more.' },
  { key: 'rollLimit', label: 'Roll limit', unit: '°', step: 0.5, min: 1, max: 45,
    help: 'Roll angle treated as the capsize point. Wash tilting the water under the boat sideways drives the roll. Worst roll in the results is the biggest roll as a % of this; 100% or more shows Capsize risk.' },
  { key: 'wake', label: 'Wash height', unit: 'm at 14.4 km/h', step: 0.01, min: 0, max: 0.5,
    help: 'Height of the wash this boat makes at 14.4 km/h through the water. It grows with speed squared and fades with distance, and decides how much this boat pushes and rolls the boats around it.' },
];

const changed = (k, p) => Math.abs(BOATS[k][p.key] - DEFAULT_BOATS[k][p.key]) > 1e-9;

// Saves only the values that differ from the defaults, so any default you
// haven't touched picks up updates to the code.
function save() {
  const edits = {};
  for (const k of Object.keys(BOATS)) {
    const values = Object.fromEntries(PARAMS.filter((p) => changed(k, p)).map((p) => [p.key, BOATS[k][p.key]]));
    if (Object.keys(values).length) edits[k] = values;
  }
  try {
    if (Object.keys(edits).length) localStorage.setItem(STORE_KEY, JSON.stringify(edits));
    else localStorage.removeItem(STORE_KEY);
  } catch { /* storage unavailable */ }
}

// Apply settings saved in this browser, if any.
export function loadSavedBoats() {
  let edits = null;
  try {
    // Older versions saved every value, which would hide newer defaults.
    localStorage.removeItem(OLD_STORE_KEY);
    edits = JSON.parse(localStorage.getItem(STORE_KEY));
  } catch { /* storage unavailable */ }
  if (!edits) return;
  for (const [k, values] of Object.entries(edits)) {
    if (!BOATS[k]) continue;
    for (const p of PARAMS) {
      const v = values[p.key];
      if (Number.isFinite(v) && v >= p.min && v <= p.max) BOATS[k][p.key] = v;
    }
  }
}

const shown = (p, v) => Number((v * (p.scale ?? 1)).toFixed(4));

// Builds the settings table; onChange runs after any edit or reset.
export function buildBoatEditor(table, resetButton, onChange) {
  const keys = Object.keys(BOATS);
  table.innerHTML = `
    <thead><tr><th>Setting</th>${keys.map((k) => `<th>${k}</th>`).join('')}</tr></thead>
    <tbody>${PARAMS.map((p) => `
      <tr>
        <th scope="row">${p.label} <span class="unit">${p.unit}</span><small>${p.help}</small></th>
        ${keys.map((k) => `<td><input type="number" step="${p.step}" min="${shown(p, p.min)}" max="${shown(p, p.max)}" data-boat="${k}" data-key="${p.key}" aria-label="${k} ${p.label}"></td>`).join('')}
      </tr>`).join('')}
    </tbody>`;

  const fill = () => {
    for (const input of table.querySelectorAll('input')) {
      const p = PARAMS.find((q) => q.key === input.dataset.key);
      input.value = shown(p, BOATS[input.dataset.boat][p.key]);
    }
  };

  table.addEventListener('change', (e) => {
    const input = e.target;
    const p = PARAMS.find((q) => q.key === input.dataset.key);
    const value = Number(input.value) / (p.scale ?? 1);
    // Out-of-range or blank entries snap back to the current value.
    if (input.value === '' || !Number.isFinite(value) || value < p.min || value > p.max) {
      input.value = shown(p, BOATS[input.dataset.boat][p.key]);
      return;
    }
    BOATS[input.dataset.boat][p.key] = value;
    save();
    onChange();
  });

  resetButton.addEventListener('click', () => {
    for (const k of keys) {
      for (const p of PARAMS) BOATS[k][p.key] = DEFAULT_BOATS[k][p.key];
    }
    try { localStorage.removeItem(STORE_KEY); } catch { /* storage unavailable */ }
    fill();
    onChange();
  });

  fill();
}
