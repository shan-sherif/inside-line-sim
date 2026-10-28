import { BOATS, POWER_BOATS } from './boats.js';
import { RIVER, BANK_EDGE, powerWash, makeBoat, makeMotorBoat, stepBoat, stepMotorBoat, washSource, clamp } from './physics.js';

// Your boat always races up the screen (+y). Going upstream, the river
// flows down the screen; going downstream, it flows up.
const UP = Math.PI / 2;
const DOWN = -Math.PI / 2;
export const START_Y = 5;

export const DIRECTIONS = {
  upstream: { label: 'Upstream', flowDir: -1 },
  downstream: { label: 'Downstream', flowDir: 1 },
  still: { label: 'Still water (regatta)', flowDir: 0 },
};

// sides: racing neighbours set s.gap either side of mid-river (-1 left, +1 right).
// beside: one racing neighbour on its own line (s.theirLine).
// front: a racing boat directly ahead of you.
// passer: a boat goes by on its own line (s.theirLine). It comes towards you
// from ahead, or with overtake set, catches you up from behind going your way.
export const SCENARIOS = {
  alone: { label: 'Solo: on your own', sides: [] },
  front: { label: 'Stern wash: 1 boat in front', sides: [], front: true },
  beside: { label: 'Side wash: 1 boat beside you', sides: [], beside: true },
  both: { label: 'Sandwich: 1 boat each side', sides: [-1, 1] },
  frontSides: { label: 'Diamond: 1 in front, 1 each side', sides: [-1, 1], front: true },
  pass: { label: 'Oncoming boat: passing the other way', sides: [], passer: true },
  overtake: { label: 'Overtaking boat: passing you from behind', sides: [], passer: true, overtake: true },
};

// Boats that can pass you: paddlers race at their power, powered boats hold a set speed.
export const PASSERS = {
  K1: { label: 'K1', spec: BOATS.K1 },
  C1: { label: 'C1', spec: BOATS.C1 },
  speedBoat: { label: 'Speed boat', spec: POWER_BOATS.speedBoat, powered: true },
  cruise: { label: 'Cruise boat', spec: POWER_BOATS.cruise, powered: true },
};

// How far behind you an overtaking boat's bow starts (m): a powered boat
// closes fast; a paddler is only a little quicker than you, so starts close.
const OVERTAKE_START = { powered: 40, paddler: 12 };

// How close a passing boat's centre can get to a bank (m): a paddler keeps
// the usual clearance, a wide powered boat keeps its hull 0.5 m off it.
export function passerClearance(key) {
  return Math.max(BANK_CLEARANCE, PASSERS[key].spec.beam / 2 + BANK_EDGE);
}

export const COURSES = [100, 200, 500, 1000];

// Other boats sit no closer than this to a bank (m).
export const BANK_CLEARANCE = 1.5;
const laneX = (x) => clamp(x, BANK_CLEARANCE, RIVER.width - BANK_CLEARANCE);

function paddler(spec, x, y, psi, power, role) {
  return Object.assign(makeBoat(spec, x, y, psi), { power, lane: x, role });
}

// s: settings read from the controls. Your line can go right up to a bank;
// the other boats are placed from mid-river, so they stay put when you move.
export function buildWorld(s) {
  const sc = SCENARIOS[s.scenario];
  const course = s.course;
  const mid = RIVER.width / 2;
  const yourX = clamp(s.lane, BANK_EDGE, RIVER.width - BANK_EDGE);
  const you = paddler(BOATS[s.yourBoat], yourX, START_Y, UP, s.power, 'You');
  const boats = [you];
  const front = sc.front
    ? paddler(BOATS[s.neighbourBoat], mid, START_Y + s.frontGap, UP, s.otherPower, 'Front')
    : null;
  if (front) boats.push(front);
  for (const side of sc.sides) {
    const role = side < 0 ? 'Left' : 'Right';
    const b = paddler(BOATS[s.neighbourBoat], laneX(mid + side * s.gap), START_Y + s.headStart, UP, s.otherPower, role);
    // Holding the formation: keep the same distance behind the front boat as at the start.
    if (front && s.pace === 'formation') Object.assign(b, { follow: front, spacing: front.y - b.y });
    boats.push(b);
  }
  // theirLine, like your line, is the hull's centre left (-) or right (+) of mid-river.
  if (sc.beside) {
    const x = laneX(mid + s.theirLine);
    boats.push(paddler(BOATS[s.neighbourBoat], x, START_Y + s.headStart, UP, s.otherPower, 'Beside'));
  }
  if (sc.passer) {
    const p = PASSERS[s.passerBoat];
    const clearance = passerClearance(s.passerBoat);
    const x = clamp(mid + s.theirLine, clearance, RIVER.width - clearance);
    const behind = OVERTAKE_START[p.powered ? 'powered' : 'paddler'] + p.spec.length / 2;
    const y = sc.overtake ? START_Y - behind : course + 20 + p.spec.length / 2;
    const psi = sc.overtake ? UP : DOWN;
    boats.push(p.powered
      ? Object.assign(makeMotorBoat(p.spec, x, y, psi, s.motorSpeed, powerWash(p.spec, s.motorSpeed) * s.washScale), { role: 'Passing' })
      : paddler(p.spec, x, y, psi, s.otherPower, 'Passing'));
  }
  return { you, boats, course, flowDir: DIRECTIONS[s.direction].flowDir };
}

// A boat holding the formation paddles harder when it drops behind its place
// relative to the boat it's following, and eases off when it creeps ahead.
// drift builds up any lasting gap, so the boat settles exactly on its place.
function holdFormation(b, s, dt) {
  const behind = b.follow.y - b.spacing - b.y;      // metres short of its place
  const falling = b.follow.vy - b.vy;               // m/s it's dropping back
  b.drift = clamp((b.drift ?? 0) + behind * dt, -20, 20);
  b.power = clamp(s.otherPower * (1 + 0.2 * behind + 0.6 * falling + 0.05 * b.drift), 0, 3 * s.otherPower);
}

// Computer paddlers hold their lane along their direction of travel.
function steer(b) {
  const dir = Math.sign(Math.sin(b.travel));
  b.targetPsi = b.travel - dir * Math.atan(0.15 * (b.lane - b.x));
}

export const WASH_MODES = {
  boats: 'Boats only',
  rebound: 'Boats + bank rebound',
  off: 'No wash',
};

// Typical share of a wave's height each kind of bank reflects, from coastal
// engineering rules of thumb. Starting points, not measurements of any river.
export const BANK_TYPES = {
  wall: { label: 'Wall, quay or lock', rebound: 95 },
  piling: { label: 'Sheet piling', rebound: 90 },
  smooth: { label: 'Steep smooth slope', rebound: 60 },
  rock: { label: 'Rock or rip-rap', rebound: 40 },
  earth: { label: 'Steep natural earth', rebound: 30 },
  gravel: { label: 'Gentle gravel or sand', rebound: 10 },
  reeds: { label: 'Reeds or soft mud', rebound: 5 },
};

// Every wake on the water. With rebound on, each wake also reflects off each
// bank; s.reboundLeft and s.reboundRight are the shares those banks send back.
export function washSources(w, s) {
  if (s.wash === 'off') return [];
  const sources = [];
  for (const b of w.boats) {
    if (b.done) continue;
    sources.push(washSource(b));
    if (s.wash === 'rebound') {
      sources.push(washSource(b, s.reboundLeft, 0), washSource(b, s.reboundRight, RIVER.width));
    }
  }
  return sources;
}

export function stepWorld(w, s, dt) {
  const env = { current: s.current, flowDir: w.flowDir, sources: washSources(w, s) };
  w.you.power = s.power;
  for (const b of w.boats) {
    if (b.done) continue;
    if (b.motor) {
      stepMotorBoat(b, env, dt);
    } else {
      if (!b.manual) steer(b);
      if (b.follow && !b.follow.done) holdFormation(b, s, dt);
      stepBoat(b, env, dt);
    }
    const up = b.travel > 0;
    // A passing boat carries on well past the end of the course so its wake
    // doesn't vanish, and an overtaking one starts behind the start line.
    const passing = b.role === 'Passing';
    const beyond = passing ? 150 + b.spec.length / 2 : 0;
    if (up ? b.y >= w.course + beyond : b.y <= -beyond) b.done = true;
    // Couldn't beat the current and got pushed back past the start.
    if (up && !passing && b.y < -15) b.done = b.offCourse = true;
  }
}

// The same run with you on your own and the computer paddling, for comparison.
// Gives up if the boat stalls, e.g. no power and no current to carry it.
export function benchmark(s, dt, limit) {
  const w = buildWorld({ ...s, scenario: 'alone' });
  let checkAt = 30;
  let lastY = w.you.y;
  for (let t = 0; t < limit && !w.you.done; t += dt) {
    stepWorld(w, s, dt);
    if (t >= checkAt) {
      if (w.you.y - lastY < 1) return null;
      checkAt += 30;
      lastY = w.you.y;
    }
  }
  return w.you.done && !w.you.offCourse ? w.you.time : null;
}
