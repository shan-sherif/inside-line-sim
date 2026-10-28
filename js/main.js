import { BOATS } from './boats.js';
import { DIRECTIONS, SCENARIOS, PASSERS, COURSES, WASH_MODES, BANK_TYPES, BANK_CLEARANCE, passerClearance, buildWorld, stepWorld, benchmark, washSources } from './scenarios.js';
import { RIVER, RIVER_SHAPES, BANK_EDGE, setRiver, clamp, froude, powerWash } from './physics.js';
import { createRenderer, boatColor, waterColour, waveMapColour, WAVE_MAP_RANGE } from './render.js';
import { buildBoatEditor, loadSavedBoats } from './boatEditor.js';
import { createRiverEditor } from './riverEditor.js';

const DT = 1 / 120;
const TIME_LIMIT = 3600;
const $ = (id) => document.getElementById(id);

const canvas = $('river');
const renderer = createRenderer(canvas);
const choices = ['direction', 'view', 'scenario', 'wash', 'yourBoat', 'pilot', 'neighbourBoat', 'passerBoat', 'pace'];
const sliders = ['power', 'lane', 'otherPower', 'frontGap', 'gap', 'headStart', 'theirLine', 'motorSpeed', 'washScale', 'current', 'reboundLeft', 'reboundRight', 'riverWidth', 'riverDepth'];

// Dragging the bed reshapes the river live and marks the shape as custom;
// letting go restarts the run on the new river.
const riverEditor = createRiverEditor($('riverEditor'), {
  getCurrent: () => Number($('current').value),
  onInput: () => {
    $('riverShape').value = 'custom';
    applyRiver();
  },
  onChange: () => reset(),
});

// Slider readouts that need more than value + unit.
const line = (v) => (v === 0 ? 'middle' : `${Math.abs(v)} m ${v < 0 ? 'left' : 'right'}`);
const FORMAT = { lane: line, theirLine: line };

let world;
let solo;
let running = true;
let clock = 0;

// The viewer's inputs when they paddle. steer is +1 for left, -1 for right.
const player = { power: 180, steer: 0 };
const held = { left: false, right: false };

function settings() {
  const s = {};
  for (const id of choices) s[id] = $(id).value;
  for (const id of sliders) s[id] = Number($(id).value);
  s.course = Number($('course').value);
  s.reboundLeft /= 100;
  s.reboundRight /= 100;
  // The line slider is measured from mid-river; the physics from the left bank.
  s.lane += RIVER.width / 2;
  // Speeds are shown in km/h; the physics works in m/s.
  s.current /= 3.6;
  s.motorSpeed /= 3.6;
  return s;
}

// The river's shape is shared by the physics and drawing, so it's set here,
// at the start of a run (or live while the bed is being dragged), and the
// line slider is fitted to the width.
function applyRiver() {
  setRiver(Number($('riverWidth').value), Number($('riverDepth').value), riverEditor.profile);
  // Your line reaches right up to either bank.
  fitLine('lane', RIVER.width / 2 - BANK_EDGE);
}

// Fits a line slider (measured from mid-river) to reach `room` metres either side.
function fitLine(id, room) {
  const input = $(id);
  const half = Math.max(0, Math.floor(room * 2) / 2);
  input.min = -half;
  input.max = half;
  input.value = clamp(Number(input.value), -half, half);
  input.dispatchEvent(new Event('input'));
}

// Fits the side-boat and their-line sliders to the room between mid-river
// and the bank, so they can't be set to put a boat past the bank. A wide
// passing boat has less room to move.
function fitDistances() {
  const sc = SCENARIOS[$('scenario').value];
  if (sc.passer) fitLine('theirLine', RIVER.width / 2 - passerClearance($('passerBoat').value));
  if (sc.beside) fitLine('theirLine', RIVER.width / 2 - BANK_CLEARANCE);
  if (sc.sides.length) {
    // Even the narrowest river leaves room for the smallest gap.
    const gap = $('gap');
    gap.dataset.fullMax ??= gap.max;
    gap.max = Math.min(Number(gap.dataset.fullMax), Math.floor((RIVER.width / 2 - BANK_CLEARANCE) * 2) / 2);
    gap.value = clamp(Number(gap.value), Number(gap.min), Number(gap.max));
    gap.dispatchEvent(new Event('input'));
  }
}

function reset() {
  applyRiver();
  fitDistances();
  riverEditor.draw();
  const s = settings();
  world = buildWorld(s);
  player.power = s.power;
  if (s.pilot === 'me') world.you.manual = player;
  solo = benchmark(s, DT, TIME_LIMIT);
  renderer.resize();
  clock = 0;
  setRunning(true);
  updateResults();
  updatePlayerInfo();
}

function setRunning(on) {
  running = on;
  $('play').textContent = on ? 'Pause' : 'Play';
  if (!on && world) updateResults();
}

function step(dt) {
  const s = settings();
  stepWorld(world, s, dt);
  renderer.stepParticles(world, s.current, dt);
  clock += dt;
  if (world.you.done || clock > TIME_LIMIT) setRunning(false);
}

function statusOf(b) {
  if (b.maxRoll >= 1) return 'Capsize risk';
  if (b.offCourse) return 'Pushed back';
  if (b.role === 'Passing') {
    // Oncoming boats pass once they're behind you; overtaking ones once they're ahead.
    const passed = b.travel > 0 ? b.y > world.you.y : b.y < world.you.y;
    return passed ? 'Passed you' : 'Coming through';
  }
  return b.done ? 'Finished' : 'Paddling';
}

// Turn rate the boat is asking for, as °/s and a share of its max turn rate.
function steeringText(b) {
  if (b.motor || b.done) return '—';
  const deg = (b.steerInput * 180) / Math.PI;
  if (Math.abs(deg) < 0.05) return 'Straight';
  const pct = Math.round((Math.abs(deg) / b.spec.maxTurn) * 100);
  return `${deg > 0 ? '◀' : '▶'} ${Math.abs(deg).toFixed(1)}°/s (${pct}%)`;
}

// Marks where your boat is now on the line slider, which shows where it started.
function updateLaneNow() {
  const you = world.you;
  const lane = $('lane');
  const min = Number(lane.min);
  const max = Number(lane.max);
  const offset = Math.round((you.x - RIVER.width / 2) * 10) / 10;
  const marker = $('laneNow');
  marker.style.setProperty('--at', (clamp(offset, min, max) - min) / (max - min));
  marker.style.setProperty('--marker', you.spec.color);
  $('laneNowText').innerHTML =
    `<span class="key" style="--marker:${you.spec.color}"></span>Your boat now: ${FORMAT.lane(offset)}`;
}

function updateResults() {
  updateLaneNow();
  $('clock').textContent = `${clock.toFixed(1)} s`;
  $('resultRows').innerHTML = world.boats.map((b) => {
    const risky = b.maxRoll >= 1;
    const name = b.role === 'You' ? `You (${b.spec.name})` : `${b.role}: ${b.spec.name}`;
    return `<tr>
      <td><span class="swatch" style="background:${boatColor(b)}"></span> ${name}</td>
      <td>${b.time.toFixed(1)} s</td>
      <td>${(Math.hypot(b.vx, b.vy) * 3.6).toFixed(1)} km/h</td>
      <td>${b.motor ? '—' : `${Math.round(b.manual ? b.manual.power : b.power)} W`}</td>
      <td>${steeringText(b)}</td>
      <td class="${risky ? 'risk' : ''}">${b.motor ? '—' : `${Math.round(b.maxRoll * 100)}%`}</td>
      <td class="${risky ? 'risk' : ''}">${statusOf(b)}</td>
    </tr>`;
  }).join('');

  const you = world.you;
  let text = solo == null
    ? 'On your own at this power, the computer doesn\'t finish this course.'
    : `On your own at this power and line, the computer takes ${solo.toFixed(1)} s.`;
  if (you.done && !you.offCourse && solo != null) {
    const diff = you.time - solo;
    text = Math.abs(diff) < 0.1
      ? `You finished in ${you.time.toFixed(1)} s, the same as on your own.`
      : `You finished in ${you.time.toFixed(1)} s: ${Math.abs(diff).toFixed(1)} s ${diff < 0 ? 'faster' : 'slower'} than on your own (${solo.toFixed(1)} s).`;
  }
  $('verdict').textContent = text;
}

function updatePlayerInfo() {
  const me = $('pilot').value === 'me';
  $('you').textContent = me ? `${player.power} W per paddler` : '';
  $('keysHint').hidden = !me;
  $('pad').hidden = !me;
  // Touches on the river steer instead of scrolling the page while you paddle.
  canvas.style.touchAction = me ? 'none' : '';
  if (!me) canvas.style.cursor = '';
}

// The passing boat's wash at its set speed, and which speed regime it's in.
function updateWashNow() {
  const p = PASSERS[$('passerBoat').value];
  if (!p.powered) return;
  const speed = Number($('motorSpeed').value) / 3.6;
  const fr = froude(p.spec, speed);
  const height = powerWash(p.spec, speed) * Number($('washScale').value);
  const regime = fr < 0.4 ? 'displacement: small wash'
    : fr < 0.85 ? 'near hull speed, half-planing: biggest wash'
      : 'planing: wash drops';
  $('washNow').textContent = `Wash ≈ ${height.toFixed(2)} m · ${regime}`;
}

function showControls() {
  const sc = SCENARIOS[$('scenario').value];
  const passerMotor = !!PASSERS[$('passerBoat').value].powered;
  const racers = sc.sides.length > 0 || !!sc.front || !!sc.beside;
  const show = {
    others: racers || !!sc.passer,
    neighbour: racers,
    front: !!sc.front,
    formation: !!sc.front && sc.sides.length > 0,
    sides: sc.sides.length > 0,
    headStart: sc.sides.length > 0 || !!sc.beside,
    theirLine: !!sc.beside || !!sc.passer,
    passer: !!sc.passer,
    motor: !!sc.passer && passerMotor,
    otherPower: racers || (!!sc.passer && !passerMotor),
    rebound: $('wash').value === 'rebound',
    washKey: $('wash').value !== 'off',
    sciRebound: $('sciColours').checked && $('wash').value === 'rebound',
  };
  for (const el of document.querySelectorAll('[data-control]')) el.hidden = !show[el.dataset.control];

  // Still water has no current: keep the slider in view but switched off.
  const still = $('direction').value === 'still';
  $('current').disabled = still;
  $('current').closest('label').querySelector('output').textContent = still ? 'none in still water' : `${$('current').value} km/h`;
}

function press(dir, down) {
  if (dir === 'left' || dir === 'right') {
    held[dir] = down;
    player.steer = (held.left ? 1 : 0) - (held.right ? 1 : 0);
  } else if (down) {
    player.power = clamp(player.power + (dir === 'up' ? 10 : -10), 0, 400);
    updatePlayerInfo();
  }
}

const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

function bindPlayerInput() {
  window.addEventListener('keydown', (e) => {
    const dir = ARROWS[e.key];
    const t = e.target;
    // Leave arrows alone while a slider or dropdown has focus.
    if (!dir || !world.you.manual || t.tagName === 'SELECT' || t.tagName === 'INPUT') return;
    e.preventDefault();
    press(dir, true);
  });
  window.addEventListener('keyup', (e) => {
    if (ARROWS[e.key]) press(ARROWS[e.key], false);
  });
  window.addEventListener('blur', () => {
    press('left', false);
    press('right', false);
  });

  for (const btn of $('pad').querySelectorAll('button')) {
    const dir = btn.dataset.dir;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      press(dir, true);
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
      btn.addEventListener(type, () => press(dir, false));
    }
  }

  // Drag the steering gauge like a tiller: the further from the centre, the
  // harder the turn. Letting go straightens up.
  let dragging = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!world.you.manual) return;
    const share = renderer.steeringAt(e.clientX, e.clientY);
    if (share == null) return;
    e.preventDefault();
    dragging = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    player.steer = share;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === dragging) {
      player.steer = renderer.steeringAt(e.clientX, e.clientY, true);
    } else if (world.you.manual) {
      canvas.style.cursor = renderer.steeringAt(e.clientX, e.clientY) == null ? '' : 'grab';
    }
  });
  for (const type of ['pointerup', 'pointercancel']) {
    canvas.addEventListener(type, (e) => {
      if (e.pointerId !== dragging) return;
      dragging = null;
      player.steer = (held.left ? 1 : 0) - (held.right ? 1 : 0);
    });
  }
}

// Colour key for the water, built from the same colour functions as the
// drawing so the two always match. Wash is shown over deep mid-river water.
function buildLegend() {
  const rgb = (c) => `rgb(${c.join(',')})`;
  const steps = (from, to, n, colour) =>
    Array.from({ length: n + 1 }, (_, i) => rgb(colour(from + ((to - from) * i) / n)));
  const DEEP = 0.8;
  const cm = WAVE_MAP_RANGE * 100;
  const split = $('sciRebound').checked;
  const items = $('sciColours').checked ? [
    { label: split ? 'Wave height (boats\' wash)' : 'Wave height (all waves)', control: 'washKey',
      colours: steps(-WAVE_MAP_RANGE, WAVE_MAP_RANGE, 24, (h) => waveMapColour(0, h)), ticks: [`−${cm} cm`, '0', `+${cm} cm`] },
    ...(split ? [{ label: 'Bank rebound (grey, exaggerated)', control: 'rebound',
      colours: steps(-0.015, 0.015, 30, (h) => waveMapColour(0, 0, h)), ticks: ['−1 cm', '0', '+1 cm'] }] : []),
    { label: 'Depth (darker = deeper)', colours: steps(0, 1, 8, (t) => waveMapColour(t, 0)), ticks: ['shallow', 'deep'] },
  ] : [
    { label: 'Depth', colours: steps(0, 1, 8, (t) => waterColour(t)), ticks: ['shallow', 'deep'] },
    { label: 'Wash height (trough to crest)', control: 'washKey', colours: steps(-0.2, 0.2, 16, (h) => waterColour(DEEP, h)),
      ticks: ['−20 cm', '0', '+20 cm'] },
    { label: 'Bank rebound (exaggerated)', control: 'rebound', colours: steps(-0.015, 0.015, 30, (h) => waterColour(DEEP, 0, h)),
      ticks: ['−1 cm', '0', '+1 cm'] },
  ];
  $('legend').innerHTML = items.map((it) => `
    <div class="legend-item"${it.control ? ` data-control="${it.control}"` : ''}>
      <span>${it.label}</span>
      <span class="legend-bar" style="background: linear-gradient(to right, ${it.colours.join(', ')})"></span>
      <span class="legend-ticks">${it.ticks.map((t) => `<span>${t}</span>`).join('')}</span>
    </div>`).join('');
}

function buildControls() {
  buildLegend();
  for (const id of ['sciColours', 'sciRebound']) {
    $(id).addEventListener('change', () => {
      buildLegend();
      showControls();
    });
  }
  $('direction').innerHTML = Object.entries(DIRECTIONS)
    .map(([k, d]) => `<option value="${k}">${d.label}</option>`).join('');
  $('scenario').innerHTML = Object.entries(SCENARIOS)
    .map(([k, sc]) => `<option value="${k}">${sc.label}</option>`).join('');
  const boatOptions = Object.keys(BOATS).map((k) => `<option value="${k}">${k}</option>`).join('');
  $('yourBoat').innerHTML = boatOptions;
  $('neighbourBoat').innerHTML = boatOptions;
  $('passerBoat').innerHTML = Object.entries(PASSERS)
    .map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
  $('passerBoat').value = 'speedBoat';
  // Each powered boat has its own speed range and starts at its typical speed.
  const fitPasserSpeed = () => {
    const p = PASSERS[$('passerBoat').value];
    if (!p.powered) return;
    const speed = $('motorSpeed');
    speed.min = p.spec.minSpeed;
    speed.max = p.spec.maxSpeed;
    speed.value = p.spec.speed;
    speed.dispatchEvent(new Event('input'));
  };
  $('passerBoat').addEventListener('change', fitPasserSpeed);
  fitPasserSpeed();
  for (const id of ['motorSpeed', 'washScale', 'passerBoat']) $(id).addEventListener('input', updateWashNow);
  updateWashNow();
  $('course').innerHTML = COURSES.map((m) => `<option value="${m}">${m} m</option>`).join('');
  $('course').value = '200';
  $('wash').innerHTML = Object.entries(WASH_MODES).map(([k, label]) => `<option value="${k}">${label}</option>`).join('');
  // Opening demo: a K1 racing alongside a K2, in its side wash.
  $('scenario').value = 'beside';
  $('wash').value = 'boats';
  $('yourBoat').value = 'K1';
  $('neighbourBoat').value = 'K2';

  // Picking a bed shape loads it into the cross-section before the run restarts.
  $('riverShape').innerHTML = Object.entries(RIVER_SHAPES)
    .map(([k, shape]) => `<option value="${k}">${shape.label}</option>`).join('')
    + '<option value="custom">Custom (drag the bed)</option>';
  $('riverShape').addEventListener('change', () => {
    if ($('riverShape').value !== 'custom') riverEditor.setShape($('riverShape').value);
  });

  // Each bank's type sets how much it reflects; moving the slider to a value
  // no type uses shows Custom. Registered before the restart handlers below,
  // so the slider is updated before the run restarts.
  const bankOptions = Object.entries(BANK_TYPES)
    .map(([k, t]) => `<option value="${k}">${t.label} (${t.rebound}%)</option>`).join('')
    + '<option value="custom">Custom</option>';
  for (const [select, slider] of [['bankLeft', 'reboundLeft'], ['bankRight', 'reboundRight']]) {
    $(select).innerHTML = bankOptions;
    $(select).value = 'earth';
    $(slider).value = BANK_TYPES.earth.rebound;
    $(select).addEventListener('change', () => {
      const type = BANK_TYPES[$(select).value];
      if (!type) return;
      $(slider).value = type.rebound;
      $(slider).dispatchEvent(new Event('input'));
    });
    $(slider).addEventListener('input', () => {
      const match = Object.entries(BANK_TYPES).find(([, t]) => t.rebound === Number($(slider).value));
      $(select).value = match ? match[0] : 'custom';
    });
  }

  for (const id of sliders) {
    const input = $(id);
    const out = input.closest('label').querySelector('output');
    const show = () => { out.textContent = (FORMAT[id] ?? ((v) => v + input.dataset.unit))(Number(input.value)); };
    input.addEventListener('input', show);
    show();
  }

  // Anything that changes the starting line-up restarts the run.
  for (const el of document.querySelectorAll('[data-restart]')) {
    el.addEventListener('change', () => {
      showControls();
      if (el.tagName === 'SELECT') {
        // Hand the arrow keys back to the page rather than the dropdown.
        el.blur();
      }
      reset();
    });
  }
  // Power and current apply live; the solo benchmark needs redoing though.
  for (const id of ['power', 'current']) {
    $(id).addEventListener('change', () => {
      solo = benchmark(settings(), DT, TIME_LIMIT);
      updateResults();
    });
  }

  $('play').addEventListener('click', () => {
    if (!running && world.you.done) reset();
    else setRunning(!running);
  });
  $('reset').addEventListener('click', reset);
  window.addEventListener('resize', renderer.resize);
}

let last = performance.now();
let resultsClock = 0;
function frame(now) {
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (running) {
    let t = elapsed * Number($('simSpeed').value);
    while (t > 1e-9 && running) {
      const dt = Math.min(DT, t);
      step(dt);
      t -= dt;
    }
  }
  resultsClock += elapsed;
  if (resultsClock > 0.2) {
    resultsClock = 0;
    updateResults();
  }
  const s = settings();
  const flow = $('showFlow').checked ? s.current : null;
  renderer.draw(world, s.view, washSources(world, s), flow, $('sciColours').checked, $('sciRebound').checked);
  requestAnimationFrame(frame);
}

loadSavedBoats();
buildControls();
buildBoatEditor($('boatTable'), $('resetBoats'), () => reset());
bindPlayerInput();
showControls();
reset();
requestAnimationFrame(frame);
