import { PROFILE_POINTS, RIVER, riverProfile, currentAt, clamp } from './physics.js';

const BED = '#8a6d3b';
const WATER = '#2a6f8f';
const FLOW = '#ffd166';

// Drawn to fixed scales so rivers can be compared: the box is always this
// wide and this deep, and depth is stretched by a fixed amount so slopes stay
// visible. A narrow river looks narrow; a steep bank looks steep.
const VIEW_WIDTH = 60;               // metres across the box, the widest river
const VIEW_DEPTH = 6;                // metres down the box, the deepest river
const STRETCH = 4;                   // depth drawn this many times its true scale

// A cross-section of the river you can drag to shape the bed. The yellow
// line above it shows the current that shape gives, from slow to fast.
// onInput runs while dragging; onChange when a drag ends.
export function createRiverEditor(canvas, { getCurrent, onInput, onChange }) {
  const ctx = canvas.getContext('2d');
  let profile = riverProfile('natural');
  let dragging = null;

  const dpr = () => window.devicePixelRatio || 1;
  const MARGIN = { left: 34, right: 8, top: 34, bottom: 18 };   // CSS pixels

  // Layout in canvas pixels for the river as it's currently set.
  function box() {
    const d = dpr();
    const left = MARGIN.left * d;
    const right = canvas.width - MARGIN.right * d;
    const perMetre = (right - left) / VIEW_WIDTH;
    const riverLeft = left + ((right - left) - RIVER.width * perMetre) / 2;
    return {
      d,
      left,
      right,
      top: MARGIN.top * d,
      flowTop: 6 * d,
      perMetre,
      depthScale: perMetre * STRETCH,
      riverLeft,
      riverRight: riverLeft + RIVER.width * perMetre,
    };
  }
  const xAt = (b, f) => b.riverLeft + f * (b.riverRight - b.riverLeft);
  const yAt = (b, metres) => b.top + metres * b.depthScale;

  function resize() {
    const d = dpr();
    canvas.width = Math.round(canvas.clientWidth * d);
    // Tall enough for the deepest river at the fixed stretch.
    const perMetre = (canvas.clientWidth - MARGIN.left - MARGIN.right) / VIEW_WIDTH;
    const height = MARGIN.top + VIEW_DEPTH * perMetre * STRETCH + MARGIN.bottom;
    canvas.style.height = `${height}px`;
    canvas.height = Math.round(height * d);
    draw();
  }

  function draw() {
    const b = box();
    const text = getComputedStyle(canvas).color;
    const bottom = yAt(b, VIEW_DEPTH);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Ground everywhere, with the river cut into it.
    ctx.fillStyle = BED;
    ctx.fillRect(b.left, b.top, b.right - b.left, bottom - b.top);
    const points = profile.map((share, i) => [xAt(b, i / (PROFILE_POINTS - 1)), yAt(b, share * RIVER.depth)]);
    ctx.fillStyle = WATER;
    ctx.beginPath();
    ctx.moveTo(b.riverLeft, b.top);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.lineTo(b.riverRight, b.top);
    ctx.closePath();
    ctx.fill();

    // The current across the river, in the band above the water.
    const max = getCurrent();
    const band = b.top - b.flowTop - 6 * b.d;
    ctx.strokeStyle = FLOW;
    ctx.lineWidth = 2 * b.d;
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const f = i / 60;
      const share = max > 0 ? currentAt(f * RIVER.width, max) / max : 0;
      const y = b.top - 4 * b.d - share * band;
      if (i === 0) ctx.moveTo(xAt(b, f), y);
      else ctx.lineTo(xAt(b, f), y);
    }
    ctx.stroke();

    // Drag handles on the bed, shrunk to fit side by side on narrow rivers.
    const step = (b.riverRight - b.riverLeft) / (PROFILE_POINTS - 1);
    const radius = clamp(step * 0.4, 2.5 * b.d, 4.5 * b.d);
    for (const [x, y] of points) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = BED;
      ctx.lineWidth = 2 * b.d;
      ctx.stroke();
    }

    // Depth scale on the left, width and stretch underneath.
    ctx.fillStyle = text;
    ctx.strokeStyle = text;
    ctx.lineWidth = b.d;
    ctx.font = `${10 * b.d}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = FLOW;
    ctx.fillText('current', b.left, b.top - 4 * b.d - band / 2);
    ctx.fillStyle = text;
    ctx.textAlign = 'right';
    for (let m = 0; m <= VIEW_DEPTH; m += 2) {
      ctx.fillText(`${m} m`, b.left - 6 * b.d, yAt(b, m));
      ctx.beginPath();
      ctx.moveTo(b.left - 3 * b.d, yAt(b, m));
      ctx.lineTo(b.left, yAt(b, m));
      ctx.stroke();
    }
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.fillText(`${RIVER.width} m wide`, (b.riverLeft + b.riverRight) / 2, bottom + 4 * b.d);
    ctx.textAlign = 'right';
    ctx.fillText(`depth ×${STRETCH}`, b.right, bottom + 4 * b.d);
  }

  function pointerAt(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height,
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    const b = box();
    const p = pointerAt(e);
    // Grab the handle in the nearest column across the river.
    const step = (b.riverRight - b.riverLeft) / (PROFILE_POINTS - 1);
    const i = Math.round((p.x - b.riverLeft) / step);
    if (i < 0 || i >= PROFILE_POINTS || Math.abs(xAt(b, i / (PROFILE_POINTS - 1)) - p.x) > Math.max(step / 2, 8 * b.d)) return;
    e.preventDefault();
    dragging = i;
    canvas.setPointerCapture(e.pointerId);
    move(p);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging != null) move(pointerAt(e));
  });
  for (const type of ['pointerup', 'pointercancel']) {
    canvas.addEventListener(type, () => {
      if (dragging == null) return;
      dragging = null;
      onChange();
    });
  }

  // The bed can go down to the deepest point set on the page.
  function move(p) {
    const b = box();
    profile[dragging] = clamp((p.y - b.top) / (RIVER.depth * b.depthScale), 0.05, 1);
    onInput();
    draw();
  }

  window.addEventListener('resize', resize);
  resize();

  return {
    get profile() { return profile; },
    setShape(key) { profile = riverProfile(key); },
    draw,
  };
}
