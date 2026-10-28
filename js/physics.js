// Simplified top-down river model. y runs along the river, x across it
// from the left bank (0) to the right bank (RIVER.width). The current flows
// along y; env.flowDir is -1 when it flows towards -y and +1 towards +y.
// The river's shape is set from the page at the start of each run (setRiver):
// depth is the deepest the bed can go, and profile is the bed's depth as a
// share of that at evenly spaced points from the left bank to the right.
export const RIVER = { width: 20, depth: 3, profile: [], deepest: 3 };
export const BANK_EDGE = 0.5;        // metres: closest a hull's centre gets to a bank

const G = 9.81;
const DEG = Math.PI / 180;
const KELVIN = 19.47 * DEG;          // half-angle of a boat's wake
const CUSP = 35.26 * DEG;            // direction the cusp waves travel, from the track
const COS_K = Math.cos(KELVIN);
const SIN_K = Math.sin(KELVIN);
const COS_C = Math.cos(CUSP);
const SIN_C = Math.sin(CUSP);

const WAKE_STEP = 2;                 // metres through the water between recorded wake points
const WAKE_LEN = 250;                // metres of wake kept behind each boat
const STRIDE = 6;                    // coarse search step along a wake track

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const PROFILE_POINTS = 9;
const MIN_DEPTH = 0.2;               // metres: the shallowest the bed is allowed to be
const BANK_DRAG = 1;                 // metres over which a bank slows the current next to it

const smooth = (t) => t * t * (3 - 2 * t);
const shelving = (f) => 0.1 + 0.9 * smooth(clamp(f / 0.85, 0, 1));

// Bed shapes across the river, as a share of the deepest depth at f = 0
// (left bank) to f = 1 (right bank).
export const RIVER_SHAPES = {
  natural: { label: 'Natural, gently shelving banks', shape: (f) => 0.1 + 0.9 * smooth(clamp(Math.min(f, 1 - f) / 0.35, 0, 1)) },
  canal: { label: 'Canal, steep sides', shape: (f) => (Math.min(f, 1 - f) < 0.05 ? 0.7 : 1) },
  channel: { label: 'Deep middle channel', shape: (f) => 0.1 + 0.9 * (1 - (2 * f - 1) ** 2) },
  shelfLeft: { label: 'Shelving left bank, deep on the right', shape: (f) => (f >= 1 ? 0.6 : shelving(f)) },
  shelfRight: { label: 'Shelving right bank, deep on the left', shape: (f) => (f <= 0 ? 0.6 : shelving(1 - f)) },
};

export function riverProfile(key) {
  return Array.from({ length: PROFILE_POINTS }, (_, i) => RIVER_SHAPES[key].shape(i / (PROFILE_POINTS - 1)));
}

export function setRiver(width, depth, profile) {
  RIVER.width = width;
  RIVER.depth = depth;
  RIVER.profile = profile.slice();
  RIVER.deepest = Math.max(MIN_DEPTH, Math.max(...profile) * depth);
}

// Depth of the bed, read off the profile between its points.
export function depthAt(x) {
  const f = clamp(x / RIVER.width, 0, 1) * (PROFILE_POINTS - 1);
  const i = Math.min(PROFILE_POINTS - 2, Math.floor(f));
  const p = RIVER.profile;
  return Math.max(MIN_DEPTH, (p[i] + (p[i + 1] - p[i]) * (f - i)) * RIVER.depth);
}

// Speed of the current: fastest over the deepest water, going with
// depth^(2/3) (Manning's rule of thumb), and slowed by friction right
// against each bank. maxCurrent is the speed over the deepest point.
export function currentAt(x, maxCurrent) {
  const edge = Math.max(0, Math.min(x, RIVER.width - x));
  const bank = 1 - Math.exp(-edge / BANK_DRAG);
  return maxCurrent * (depthAt(x) / RIVER.deepest) ** (2 / 3) * bank;
}

setRiver(RIVER.width, RIVER.depth, riverProfile('natural'));

// Boats sink into a "hole" in shallow water and slow down.
function shallowFactor(depth) {
  return 1 + 1.5 * Math.exp(-(depth - 0.3) / 0.4);
}

// Height (m) of a Kelvin wake at `behind` metres back along the path the
// boat took and `side` metres out from it, for waves made at `speed` (m/s)
// with height `wake`.
function kelvin(behind, side, speed, wake) {
  if (behind <= 0 || behind > WAKE_LEN) return 0;
  const fromArm = side * COS_K - behind * SIN_K;
  const width = 3 + behind * 0.05;
  if (fromArm > 3 * width) return 0;
  const g = Math.exp(-((fromArm / width) ** 2));
  const env = fromArm > 0 ? g : 0.25 + 0.75 * g;
  const amp = (wake / Math.sqrt(1 + behind / 40)) * Math.exp(-behind / 250) * (1 - Math.exp(-behind / 3));
  const lambda = (2 * Math.PI * (Math.max(speed, 1.5) * COS_C) ** 2) / G;
  const phase = (2 * Math.PI * (behind * COS_C + side * SIN_C)) / lambda;
  return amp * env * Math.cos(phase);
}

// Wave height (m) at (x, y) from one wash source. The wake follows the path
// the boat took through the water, so waves stay where they were made
// (drifting with the current) instead of swinging round when the boat turns.
// Each point on the water takes its wave from the nearest part of that path.
function washHeight(src, x, y) {
  // A reflection off a bank is the direct wake seen from the mirror point.
  if (src.bankX != null) x = 2 * src.bankX - x;
  const pts = src.pts;
  const n = pts.length;
  if (n < 2) return 0;

  // Coarse pass over every few points, then refine the segments around the best.
  let best = n - 1;
  let bestD = Infinity;
  for (let i = n - 1; i >= 0; i -= STRIDE) {
    const d = (pts[i].x - x) ** 2 + (pts[i].y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  let nearI = 0;
  let nearT = 0;
  let nearD = Infinity;
  for (let i = Math.max(0, best - STRIDE); i <= Math.min(n - 2, best + STRIDE); i++) {
    const a = pts[i];
    const ex = pts[i + 1].x - a.x;
    const ey = pts[i + 1].y - a.y;
    const len2 = ex * ex + ey * ey;
    const t = len2 > 0 ? clamp(((x - a.x) * ex + (y - a.y) * ey) / len2, 0, 1) : 0;
    const d = (a.x + t * ex - x) ** 2 + (a.y + t * ey - y) ** 2;
    if (d < nearD) {
      nearD = d;
      nearI = i;
      nearT = t;
    }
  }

  const a = pts[nearI];
  const b = pts[nearI + 1];
  const behind = pts[n - 1].dist - (a.dist + nearT * (b.dist - a.dist));
  const speed = a.speed + nearT * (b.speed - a.speed);
  const wake = (a.wake + nearT * (b.wake - a.wake)) * src.gain;
  return kelvin(behind, Math.sqrt(nearD), speed, wake);
}

// A boat's wake as a wash source: its recorded path plus where it is now.
// With bankX set, it's the wake reflected off that bank, scaled by gain.
// owner is set only for the direct wake, so a boat isn't pushed by its own
// wake but does feel its reflection coming back.
export function washSource(b, gain = 1, bankX = null) {
  const o = wakeOrigin(b);
  return {
    owner: bankX == null ? b : null,
    bankX,
    gain,
    pts: [...b.wakeTrack, { x: o.x, y: o.y, dist: b.waterDist, speed: b.speed, wake: b.wake }],
  };
}

// Where a boat's wake starts. A powered boat's comes off its bow, which
// matters for a long hull; paddle boats' wakes are measured from mid-hull.
function wakeOrigin(b) {
  if (!b.motor) return b;
  const ahead = 0.4 * b.spec.length;
  return { x: b.x + ahead * Math.cos(b.psi), y: b.y + ahead * Math.sin(b.psi) };
}

export function totalWash(sources, x, y, except) {
  let h = 0;
  for (const src of sources) if (src.owner !== except) h += washHeight(src, x, y);
  return h;
}

function washSlope(sources, x, y, except) {
  const h = 0.25;
  return {
    gx: (totalWash(sources, x + h, y, except) - totalWash(sources, x - h, y, except)) / (2 * h),
    gy: (totalWash(sources, x, y + h, except) - totalWash(sources, x, y - h, except)) / (2 * h),
  };
}

const HULL_SAMPLES = 5;

// Wash pushes each part of the hull down the local wave face, with this
// acceleration per unit of slope.
const WASH_PUSH = 0.3 * G;
// Typical speed of wash waves (m/s): about 3 for a K1's, 4 for a motor
// boat's. Water in a wave moves at about this speed times the slope of the
// wave, which is what shoves the hull sideways.
const WAVE_SPEED = 3.5;

// What the wash does to the whole hull, sampled from bow to stern.
// gx, gy: wave slope averaged over the hull. A wave shorter than the boat has
// the bow and stern on opposite faces, so their pushes largely cancel; a long
// wave tilts the whole hull the same way and pushes it hard.
// twist: turn rate (rad/s, + is left) from the water in the waves moving the
// bow sideways differently from the stern, e.g. when a wave reaches the bow first.
function hullWash(sources, b, cos, sin) {
  if (!sources.length) return { gx: 0, gy: 0, twist: 0 };
  let gx = 0;
  let gy = 0;
  let moment = 0;
  let spread = 0;
  for (let i = 0; i < HULL_SAMPLES; i++) {
    const u = (i / (HULL_SAMPLES - 1) - 0.5) * b.spec.length;
    const g = washSlope(sources, b.x + u * cos, b.y + u * sin, b);
    gx += g.gx;
    gy += g.gy;
    // Leftward water movement at this point, weighted by its distance from the middle.
    moment += u * -WAVE_SPEED * (-g.gx * sin + g.gy * cos);
    spread += u * u;
  }
  return { gx: gx / HULL_SAMPLES, gy: gy / HULL_SAMPLES, twist: moment / spread };
}

function track(b, env, dt) {
  b.time += dt;
  b.trailClock += dt;
  if (b.trailClock >= 0.25) {
    b.trailClock = 0;
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 600) b.trail.shift();
  }

  // The wake's path: waves already made drift with the current, and a new
  // point is added every WAKE_STEP metres the boat moves through the water.
  b.waterDist += b.speed * dt;
  const wake = b.wakeTrack;
  if (env.flowDir) {
    for (const p of wake) p.y += env.flowDir * currentAt(p.x, env.current) * dt;
  }
  const last = wake[wake.length - 1];
  if (!last || b.waterDist - last.dist >= WAKE_STEP) {
    const o = wakeOrigin(b);
    wake.push({ x: o.x, y: o.y, dist: b.waterDist, speed: b.speed, wake: b.wake });
    while (wake.length > 2 && b.waterDist - wake[1].dist > WAKE_LEN) wake.shift();
  }
}

// travel is the heading the boat is racing along; computer paddlers hold it.
export function makeBoat(spec, x, y, psi) {
  return {
    spec, x, y, psi, targetPsi: psi, travel: psi,
    vx: 0, vy: 0, r: 0, steerInput: 0, speed: 0, wake: 0, power: 0,
    roll: 0, rollRate: 0, maxRoll: 0,
    time: 0, done: false,
    trail: [{ x, y }], trailClock: 0,
    wakeTrack: [], waterDist: 0,
  };
}

// How a boat's wash grows and falls with speed, against the length Froude
// number Fr = speed / sqrt(g * waterline length). Below hull speed it grows
// with speed²; it peaks around Fr 0.6, where the hull climbs its own bow wave
// (half-planing); and once planing, it drops to about half the peak.
const HUMP_FR = 0.6;
export const froude = (spec, speed) => speed / Math.sqrt(G * spec.length);
function washCurve(fr) {
  if (fr <= HUMP_FR) return (fr / HUMP_FR) ** 2;
  return 0.45 + 0.55 * Math.exp(-(((fr - HUMP_FR) / 0.35) ** 2));
}

// A powered boat's wash height (m) at a speed (m/s), scaled so it matches
// spec.wash at the boat's starting speed (spec.speed, km/h).
export function powerWash(spec, speed) {
  return spec.wash * washCurve(froude(spec, speed)) / washCurve(froude(spec, spec.speed / 3.6));
}

// A powered boat holds a fixed speed through the water and is carried by the current.
export function makeMotorBoat(spec, x, y, psi, speed, wake) {
  return {
    ...makeBoat(spec, x, y, psi),
    motor: true, speed, wake,
  };
}

// env: { current, flowDir, sources }
export function stepMotorBoat(m, env, dt) {
  m.vx = Math.cos(m.psi) * m.speed;
  m.vy = Math.sin(m.psi) * m.speed + env.flowDir * currentAt(m.x, env.current);
  m.x += m.vx * dt;
  m.y += m.vy * dt;
  track(m, env, dt);
}

export function stepBoat(b, env, dt) {
  const s = b.spec;
  const cos = Math.cos(b.psi);
  const sin = Math.sin(b.psi);
  const water = (x) => env.flowDir * currentAt(x, env.current);

  // Velocity through the water, split into surge (forwards) and sway (sideways).
  const rvx = b.vx;
  const rvy = b.vy - water(b.x);
  const vs = rvx * cos + rvy * sin;
  const vw = -rvx * sin + rvy * cos;

  // Steering towards the target heading (or the player's input), plus the
  // twist from the current being faster at one end of the boat than the other.
  const rMax = s.maxTurn * DEG;
  const rCmd = b.manual
    ? b.manual.steer * rMax
    : clamp(2 * wrap(b.targetPsi - b.psi), -rMax, rMax);
  b.steerInput = rCmd;               // rad/s, + is left; shown on screen
  const half = s.length / 2;
  const shear = (water(b.x + half * cos) - water(b.x - half * cos)) * cos;
  const rShear = (s.twist * shear) / s.length;
  // Wash moving the bow and stern differently twists the boat too, the same
  // way the current does.
  const wash = hullWash(env.sources, b, cos, sin);
  const rWash = s.twist * wash.twist;
  b.r += (rCmd + rShear + rWash - b.r) * Math.min(1, dt * 4);
  const oldPsi = b.psi;
  b.psi = wrap(b.psi + b.r * dt);
  // Turn about the pivot point rather than the middle of the hull: the
  // pivot stays put and the rest of the boat swings around it.
  const d = (0.5 - s.pivot) * s.length;
  b.x += d * (Math.cos(oldPsi) - Math.cos(b.psi));
  b.y += d * (Math.sin(oldPsi) - Math.sin(b.psi));

  // Constant paddler power, less whatever goes into steering.
  const steerLoad = Math.abs(rCmd) / rMax;
  const perPaddler = b.manual ? b.manual.power : b.power;
  const power = perPaddler * s.paddlers * s.efficiency * (1 - s.steerCost * steerLoad);
  const thrust = Math.min(power / Math.max(vs, 1), 250 * s.paddlers);
  const surge = thrust - s.dragK * shallowFactor(depthAt(b.x)) * vs * Math.abs(vs);
  const sway = -s.swayK * vw * Math.abs(vw) - 20 * vw;

  // Other boats' wash pushes this one down the wave face and rolls it.
  const { gx, gy } = wash;
  const fx = -WASH_PUSH * s.mass * gx;
  const fy = -WASH_PUSH * s.mass * gy;
  const latSlope = -gx * sin + gy * cos;

  b.vx += ((surge * cos - sway * sin + fx) / s.mass) * dt;
  b.vy += ((surge * sin + sway * cos + fy) / s.mass) * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.x < BANK_EDGE || b.x > RIVER.width - BANK_EDGE) {
    b.x = clamp(b.x, BANK_EDGE, RIVER.width - BANK_EDGE);
    b.vx = 0;
  }

  // Roll follows the sideways slope of the water, with a ~1 s natural period.
  // The paddler sits high above the hull, which amplifies it.
  const w0 = 2 * Math.PI;
  b.rollRate += (w0 * w0 * (1.6 * Math.atan(latSlope) - b.roll) - 0.5 * w0 * b.rollRate) * dt;
  b.roll += b.rollRate * dt;
  b.maxRoll = Math.max(b.maxRoll, Math.abs(b.roll) / (s.rollLimit * DEG));

  // This boat's own wash, for everyone else.
  b.speed = Math.max(0, vs);
  b.wake = s.wake * (b.speed / 4) ** 2;
  track(b, env, dt);
}
