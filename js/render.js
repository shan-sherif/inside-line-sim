import { RIVER, depthAt, currentAt, totalWash, clamp } from './physics.js';
import { START_Y } from './scenarios.js';

const BANK = 4;                       // metres of land kept visible on each side
const RES = 2;                        // most water texture pixels per metre
const BUDGET = 9000;                  // most wave samples per frame, to keep drawing smooth
const REBOUND_FULL = 0.01;            // metres: a reflected wave this high shows in full colour
const REBOUND_CREST = [255, 80, 220]; // magenta
const REBOUND_TROUGH = [70, 10, 100]; // deep purple
const FOLLOW_LEN = 25;                // metres of river shown when following
const FOLLOW_AT = 0.45;               // your boat sits this far up the screen, leaving room for its wake
const GAUGE_SPACE = 84;               // CSS pixels the steering gauge takes at the bottom
const MIN_HULL_PX = 25;               // CSS pixels long, and
const MIN_BEAM_PX = 3;                // wide, below which hulls show as markers

// The water's colour, shared by the drawing and the colour key so they
// always match. depthShare: 0 at the shallowest, 1 at the deepest point.
// wash: height (m) of the boats' own waves, lightening crests and darkening
// troughs by WASH_SHADE per metre. rebound: height (m) of waves reflected off
// a bank, blended towards magenta (crests) or deep purple (troughs), boosted
// so even centimetre-high reflections show.
const WASH_SHADE = 500;
export function waterColour(depthShare, wash = 0, rebound = 0) {
  const t = depthShare;
  const s = wash * WASH_SHADE;
  let c = [125 - 110 * t + s, 195 - 140 * t + s, 185 - 75 * t + s];
  if (rebound) {
    const a = 0.85 * Math.sqrt(Math.min(1, Math.abs(rebound) / REBOUND_FULL));
    const target = rebound > 0 ? REBOUND_CREST : REBOUND_TROUGH;
    c = c.map((v, i) => v + (target[i] - v) * a);
  }
  return c.map((v) => clamp(Math.round(v), 0, 255));
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const water = document.createElement('canvas');
  const wctx = water.getContext('2d');
  let img = null;

  // f is how far across the river a marker is (0 to 1), so markers follow the width.
  const particles = Array.from({ length: 160 }, () => ({ f: Math.random(), y: NaN }));
  let cam = null;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const h = clamp(window.innerHeight * 0.7, 360, 760);
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(h * dpr);
  }

  function camera(world, view) {
    // The fixed view keeps the course clear of the steering gauge at the bottom.
    const reserve = view === 'fixed' ? GAUGE_SPACE * (window.devicePixelRatio || 1) : 0;
    const len = view === 'fixed' ? world.course + 12 : FOLLOW_LEN;
    const scale = Math.min((canvas.height - reserve) / len, canvas.width / (RIVER.width + 2 * BANK));
    const visible = canvas.height / scale;
    const bottom = view === 'fixed'
      ? -6 - reserve / scale
      : world.you.y - FOLLOW_AT * visible;
    return { scale, visible, bottom, ox: (canvas.width - RIVER.width * scale) / 2 };
  }

  const sx = (x) => cam.ox + x * cam.scale;
  const sy = (y) => canvas.height - (y - cam.bottom) * cam.scale;

  function paintWater(sources) {
    // Each sample searches every wake's path, so cap the samples per frame;
    // smoothing when the texture is scaled up hides the coarser grid.
    const res = Math.min(RES, cam.scale, Math.sqrt(BUDGET / (RIVER.width * cam.visible)));
    const cols = Math.max(1, Math.round(RIVER.width * res));
    const rows = Math.max(1, Math.ceil(cam.visible * res));
    if (water.width !== cols || water.height !== rows) {
      water.width = cols;
      water.height = rows;
      img = wctx.createImageData(cols, rows);
    }
    // Depth share per column, so the colour can be worked out per pixel.
    const depth = [];
    for (let i = 0; i < cols; i++) depth.push(depthAt(((i + 0.5) * RIVER.width) / cols) / RIVER.deepest);
    const direct = sources.filter((src) => src.bankX == null);
    const rebound = sources.filter((src) => src.bankX != null);
    const d = img.data;
    const top = cam.bottom + rows / res;
    for (let j = 0; j < rows; j++) {
      const y = top - (j + 0.5) / res;
      for (let i = 0; i < cols; i++) {
        const x = ((i + 0.5) * RIVER.width) / cols;
        const [r, g, b] = waterColour(
          depth[i],
          direct.length ? totalWash(direct, x, y) : 0,
          rebound.length ? totalWash(rebound, x, y) : 0,
        );
        const k = (j * cols + i) * 4;
        d[k] = r;
        d[k + 1] = g;
        d[k + 2] = b;
        d[k + 3] = 255;
      }
    }
    wctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(water, sx(0), sy(top), RIVER.width * cam.scale, (rows / res) * cam.scale);
  }

  // Current markers drift with the water and wrap around the visible stretch.
  function stepParticles(world, maxCurrent, dt) {
    if (!cam) return;
    for (const p of particles) {
      p.y += world.flowDir * currentAt(p.f * RIVER.width, maxCurrent) * dt;
    }
  }

  function drawFlow() {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const r = clamp(cam.scale * 0.2, 1.5, 4 * (window.devicePixelRatio || 1));
    // Fewer markers when zoomed in, so the water isn't crowded with them.
    const shown = Math.round(particles.length * Math.min(1, cam.visible / 40));
    for (const p of particles.slice(0, shown)) {
      if (!(p.y >= cam.bottom && p.y <= cam.bottom + cam.visible)) {
        p.y = cam.bottom + ((((p.y - cam.bottom) % cam.visible) + cam.visible) % cam.visible || Math.random() * cam.visible);
      }
      ctx.fillRect(sx(p.f * RIVER.width) - r / 2, sy(p.y) - r / 2, r, r);
    }
  }

  function drawBanks() {
    ctx.fillStyle = '#c9b68a';
    const edge = Math.max(2, cam.scale * 0.5);
    ctx.fillRect(sx(0) - edge, 0, edge, canvas.height);
    ctx.fillRect(sx(RIVER.width), 0, edge, canvas.height);

    // Distance posts, so movement shows when following. Spaced wider on long
    // courses so they don't crowd together; every fifth one is labelled.
    const step = [10, 50, 100].find((m) => m * cam.scale >= 14) ?? 200;
    const font = Math.max(11, Math.min(16, cam.scale * 1.6));
    ctx.font = `${font}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (let d = Math.ceil(cam.bottom / step) * step; d <= cam.bottom + cam.visible; d += step) {
      if (d < 0) continue;
      const y = sy(d);
      ctx.fillStyle = '#e8e2cf';
      ctx.fillRect(sx(0) - edge - 8, y - 1.5, 8, 3);
      ctx.fillRect(sx(RIVER.width) + edge, y - 1.5, 8, 3);
      if (d % (step * 5) === 0) {
        ctx.textAlign = 'right';
        ctx.fillText(`${d} m`, sx(0) - edge - 12, y);
      }
    }
    ctx.textAlign = 'start';
  }

  function drawLine(y, label) {
    if (y < cam.bottom || y > cam.bottom + cam.visible) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.setLineDash([cam.scale * 1.2, cam.scale * 1.2]);
    ctx.lineWidth = Math.max(1.5, cam.scale * 0.2);
    ctx.beginPath();
    ctx.moveTo(sx(0), sy(y));
    ctx.lineTo(sx(RIVER.width), sy(y));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${Math.max(11, Math.min(15, cam.scale * 1.5))}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, sx(RIVER.width) + 12, sy(y) - 2);
    ctx.textBaseline = 'middle';
  }

  function drawHud(world) {
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${Math.max(12, Math.min(16, canvas.width / 50))}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const pad = 10 * (window.devicePixelRatio || 1);
    const flow = world.flowDir === 0 ? 'Still water' : `Current ${world.flowDir < 0 ? '↓' : '↑'}`;
    ctx.fillText(flow, pad, pad);
    ctx.textAlign = 'right';
    const toGo = Math.max(0, world.course - world.you.y);
    ctx.fillText(`${toGo.toFixed(0)} m to go`, canvas.width - pad, pad);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'middle';
    drawSteering(world.you, pad);
    drawSpeedometer(world.you, pad);
  }

  // Dial of your speed over the ground, with speed through the water as a
  // second, thinner needle: the gap between them is what the current is doing.
  function drawSpeedometer(b, pad) {
    const dpr = window.devicePixelRatio || 1;
    const MAX = 24;                              // km/h at the end of the dial
    const TICK = 4;
    const r = 50 * dpr;
    const pw = 2 * r + 34 * dpr;
    const ph = 2 * r + 62 * dpr;
    const px = canvas.width - pad - pw;
    const py = pad + 26 * dpr;
    const cx = px + pw / 2;
    const cy = py + r + 10 * dpr;
    const start = Math.PI * 0.75;                // dial runs clockwise over 270°
    const sweep = Math.PI * 1.5;
    const angle = (v) => start + sweep * clamp(v / MAX, 0, 1);

    ctx.fillStyle = 'rgba(10, 20, 30, 0.72)';
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 10 * dpr);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 4 * dpr;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 6 * dpr, start, start + sweep);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `${9 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= MAX; v += TICK) {
      const a = angle(v);
      const c = Math.cos(a);
      const s = Math.sin(a);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(cx + c * (r - 11 * dpr), cy + s * (r - 11 * dpr));
      ctx.lineTo(cx + c * (r - 2 * dpr), cy + s * (r - 2 * dpr));
      ctx.stroke();
      ctx.fillText(String(v), cx + c * (r - 19 * dpr), cy + s * (r - 19 * dpr));
    }

    const needle = (v, color, width, length) => {
      const a = angle(v);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * length, cy + Math.sin(a) * length);
      ctx.stroke();
      ctx.lineCap = 'butt';
    };
    const ground = Math.hypot(b.vx, b.vy) * 3.6;
    const water = b.speed * 3.6;
    needle(water, b.spec.color, 2 * dpr, r - 14 * dpr);
    needle(ground, '#fff', 3 * dpr, r - 8 * dpr);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5 * dpr, 0, Math.PI * 2);
    ctx.fill();

    // Unit on the dial face, in the gap at the bottom.
    ctx.font = `600 ${9 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('km/h', cx, cy + r * 0.72);
    ctx.fillStyle = '#fff';

    // Readout and legend under the dial.
    const ty = cy + r + 4 * dpr;
    ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`;
    ctx.fillText(`${ground.toFixed(1)} km/h`, cx, ty);
    ctx.font = `${10 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('━ over ground', cx, ty + 16 * dpr);
    ctx.fillStyle = b.spec.color;
    ctx.fillText(`━ through water ${water.toFixed(1)}`, cx, ty + 29 * dpr);
    ctx.textAlign = 'start';
    drawHeading(b, px, py + ph + 6 * dpr, pw);
  }

  // Where the bow points, and the direction the boat is actually moving over
  // the ground, both measured from straight up the course. A gap between the
  // two means current or wash is pushing the boat sideways.
  function drawHeading(b, px, py, pw) {
    const dpr = window.devicePixelRatio || 1;
    const UP = Math.PI / 2;
    const angle = (a) => {
      const deg = (Math.atan2(Math.sin(a - UP), Math.cos(a - UP)) * 180) / Math.PI;
      return Math.abs(deg) < 0.05 ? '0.0° straight' : `${Math.abs(deg).toFixed(1)}° ${deg > 0 ? 'left' : 'right'}`;
    };
    const moving = Math.hypot(b.vx, b.vy) > 0.3 ? angle(Math.atan2(b.vy, b.vx)) : '—';
    ctx.fillStyle = 'rgba(10, 20, 30, 0.72)';
    ctx.beginPath();
    ctx.roundRect(px, py, pw, 40 * dpr, 10 * dpr);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const lx = px + 10 * dpr;
    const vx = px + pw - 10 * dpr;
    for (const [i, label, value] of [[0, 'Heading', angle(b.psi)], [1, 'Moving', moving]]) {
      const y = py + (13 + i * 15) * dpr;
      ctx.font = `${10 * dpr}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.textAlign = 'left';
      ctx.fillText(label, lx, y);
      ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'right';
      ctx.fillText(value, vx, y);
    }
    ctx.textAlign = 'start';
  }

  // Where the steering gauge is, in canvas pixels, for drag steering.
  let gauge = null;

  // Steering share (+1 full left, -1 full right) for a pointer at clientX/Y,
  // or null if it's not on the gauge. Pass anywhere to track a drag that has
  // wandered off the gauge.
  function steeringAt(clientX, clientY, anywhere = false) {
    if (!gauge) return null;
    const rect = canvas.getBoundingClientRect();
    const px = ((clientX - rect.left) * canvas.width) / rect.width;
    const py = ((clientY - rect.top) * canvas.height) / rect.height;
    const inside = px >= gauge.x0 && px <= gauge.x0 + gauge.w && py >= gauge.y0 && py <= gauge.y0 + gauge.h;
    if (!inside && !anywhere) return null;
    return fromGauge(clamp((gauge.mid - px) / (gauge.bw / 2), -1, 1));
  }

  // The gauge is stretched near the centre so small corrections show up:
  // distance from the centre goes with the square root of the steering share.
  const toGauge = (share) => Math.sign(share) * Math.sqrt(Math.abs(share));
  const fromGauge = (pos) => Math.sign(pos) * pos * pos;

  // Gauge of the turn rate your boat is asking for, whoever is steering.
  function drawSteering(b, pad) {
    const dpr = window.devicePixelRatio || 1;
    const max = b.spec.maxTurn;
    const input = (b.steerInput * 180) / Math.PI;
    const w = Math.min(420 * dpr, canvas.width - 2 * pad);
    const h = 64 * dpr;
    const x0 = (canvas.width - w) / 2;
    const y0 = canvas.height - h - pad;

    ctx.fillStyle = 'rgba(10, 20, 30, 0.72)';
    ctx.beginPath();
    ctx.roundRect(x0, y0, w, h, 8 * dpr);
    ctx.fill();

    const who = b.manual ? 'Your steering' : 'Computer steering';
    const side = Math.abs(input) < 0.05 ? 'straight' : `${Math.abs(input).toFixed(1)}°/s ${input > 0 ? 'left' : 'right'}`;
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${who}: ${side}${b.manual ? ' · drag to steer' : ''}`, x0 + w / 2, y0 + 7 * dpr);

    // Bar fills from the centre towards the side being steered; ends are max turn rate.
    const bx = x0 + 16 * dpr;
    const bw = w - 32 * dpr;
    const by = y0 + 28 * dpr;
    const bh = 8 * dpr;
    const mid = bx + bw / 2;
    const at = (deg) => mid - (toGauge(clamp(deg / max, -1, 1)) * bw) / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = b.spec.color;
    const fill = at(input) - mid;
    ctx.fillRect(Math.min(mid, mid + fill), by, Math.abs(fill), bh);

    // Ticks at round turn rates on both sides, labelled underneath.
    ctx.font = `${10 * dpr}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    for (const deg of [1, 2, 5, 10, 20].filter((d) => d < max).concat(max)) {
      for (const sign of [1, -1]) {
        const tx = at(sign * deg);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(tx - dpr / 2, by + bh, dpr, 4 * dpr);
        if (deg === 2) continue;
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.textAlign = 'center';
        ctx.fillText(String(deg), tx, by + bh + 6 * dpr);
      }
    }
    ctx.textAlign = 'left';
    ctx.fillText('◀ left', bx, y0 + 7 * dpr);
    ctx.textAlign = 'right';
    ctx.fillText('right ▶', bx + bw, y0 + 7 * dpr);
    ctx.textAlign = 'center';
    ctx.fillText('°/s', mid, by + bh + 6 * dpr);

    ctx.fillStyle = '#fff';
    ctx.fillRect(mid - dpr, by - 3 * dpr, 2 * dpr, bh + 6 * dpr);
    gauge = { x0, y0, w, h, bw, mid };
    if (b.manual) {
      // A handle to grab when steering by dragging.
      ctx.beginPath();
      ctx.arc(mid + fill, by + bh / 2, 8 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = b.spec.color;
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'middle';
  }

  // Plan shapes as a share of the widest point, with f running from bow (0)
  // to stern (1). The kayak is traced from a K1: a long needle bow, widest
  // just behind the cockpit, and a fine stern. The canoe is traced from a C1
  // and C2: a near-symmetrical spindle, widest mid-length.
  const KAYAK_WIDEST = 0.57;
  function kayakWidth(f) {
    if (f < KAYAK_WIDEST) return (1 - (1 - f / KAYAK_WIDEST) ** 2) ** 1.5;
    return (1 - (f - KAYAK_WIDEST) / (1 - KAYAK_WIDEST)) ** 0.9;
  }
  function canoeWidth(f) {
    return 1 - (1 - Math.min(f, 1 - f) / 0.5) ** 1.7;
  }

  // Kayak cockpits as fractions of length from the bow: [front, back].
  const COCKPITS = { 1: [[0.38, 0.56]], 2: [[0.29, 0.42], [0.53, 0.66]] };

  // Canoes are open: one long opening, rounded at the front and closing to a
  // point at the back, crossed by bulkheads. C2s have a light floor panel.
  const OPENINGS = {
    1: { from: 0.33, to: 0.87, bars: [0.52, 0.73] },
    2: { from: 0.26, to: 0.82, bars: [0.37, 0.56, 0.69], floor: [0.41, 0.74] },
  };

  // Hulls are drawn only slightly wider than their real beam, to keep the
  // slim racing shape; half-width in pixels.
  const BEAM_DRAWN = 1.2;
  const halfWidth = (beam) => ((beam * BEAM_DRAWN) / 2) * cam.scale;

  // Traces a shape along the boat: width(f) gives the half-width in pixels,
  // between from and to (fractions of length from the bow).
  function planPath(len, width, from = 0, to = 1) {
    const h = len / 2;
    const N = 64;
    const f = (i) => from + ((to - from) * i) / N;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) ctx.lineTo(h - f(i) * len, -width(f(i)));
    for (let i = N; i >= 0; i--) ctx.lineTo(h - f(i) * len, width(f(i)));
    ctx.closePath();
  }

  function paddleHull(s) {
    const w = halfWidth(s.beam);
    const shape = s.type === 'kayak' ? kayakWidth : canoeWidth;
    planPath(s.length * cam.scale, (f) => w * shape(f));
  }

  // Cockpit openings: rounded at the front, square at the back where the
  // seat is, plus the rudder fitting near the stern.
  function kayakDeck(s) {
    const len = s.length * cam.scale;
    const h = len / 2;
    const w = halfWidth(s.beam);
    const cw = w * 0.62;
    for (const [from, to] of COCKPITS[s.paddlers] ?? COCKPITS[1]) {
      const x1 = h - from * len;
      const x2 = h - to * len;
      const l = x1 - x2;
      ctx.fillStyle = '#1b1b1b';
      ctx.beginPath();
      ctx.moveTo(x2, -cw);
      ctx.bezierCurveTo(x2 + l * 0.6, -cw, x1, -cw * 0.6, x1, 0);
      ctx.bezierCurveTo(x1, cw * 0.6, x2 + l * 0.6, cw, x2, cw);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#4a4a4a';
      ctx.beginPath();
      ctx.ellipse(x2 + l * 0.18, 0, l * 0.12, cw * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#1b1b1b';
    ctx.beginPath();
    ctx.arc(h - 0.915 * len, 0, Math.max(0.75, w * 0.15), 0, Math.PI * 2);
    ctx.fill();
  }

  function canoeDeck(s) {
    const len = s.length * cam.scale;
    const h = len / 2;
    const w = halfWidth(s.beam);
    const { from, to, bars, floor } = OPENINGS[s.paddlers] ?? OPENINGS[1];
    const V = 0.13;                             // length over which the back closes to a point
    const open = (f) => w * 0.8 * canoeWidth(f)
      * Math.sqrt(1 - (1 - clamp((f - from) / 0.05, 0, 1)) ** 2)
      * clamp((to - f) / V, 0, 1);
    ctx.fillStyle = '#1b1b1b';
    planPath(len, open, from, to);
    ctx.fill();
    if (floor) {
      ctx.fillStyle = '#d9d9d9';
      planPath(len, (f) => open(f) * 0.6, floor[0], floor[1]);
      ctx.fill();
    }
    ctx.strokeStyle = '#9a9a9a';
    ctx.lineWidth = Math.max(0.5, w * 0.08);
    for (const f of bars) {
      ctx.beginPath();
      ctx.moveTo(h - f * len, -open(f));
      ctx.lineTo(h - f * len, open(f));
      ctx.stroke();
    }
  }

  // Rounded rectangle path, centred on (x, y).
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, Math.min(r, w / 2, h / 2));
  }

  // Open speed boat, traced from a runabout: pointed bow, square transom
  // with an outboard, windscreen amidships and two red seats behind it.
  function drawSpeedBoat(s) {
    const k = cam.scale;
    const h = (s.length / 2) * k;
    const w = (s.beam / 2) * k;
    ctx.fillStyle = '#222';                                   // outboard motor
    roundRect(-h - 0.06 * h, 0, 0.22 * h, 0.5 * w, 0.05 * h);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-h, -w * 0.94);
    ctx.lineTo(h * 0.15, -w);
    ctx.quadraticCurveTo(h * 0.85, -w * 0.95, h, 0);
    ctx.quadraticCurveTo(h * 0.85, w * 0.95, h * 0.15, w);
    ctx.lineTo(-h, w * 0.94);
    ctx.closePath();
    ctx.fillStyle = '#f2f2f2';
    ctx.fill();
    ctx.strokeStyle = '#9aa3ab';
    ctx.lineWidth = Math.max(1, w * 0.08);
    ctx.stroke();
    ctx.fillStyle = '#e1e4e6';                                // cockpit floor
    roundRect(-h * 0.2, 0, h * 0.75, w * 1.5, w * 0.1);
    ctx.fill();
    ctx.fillStyle = 'rgba(70, 90, 105, 0.85)';                // windscreen
    roundRect(h * 0.22, 0, h * 0.1, w * 1.5, w * 0.05);
    ctx.fill();
    ctx.fillStyle = '#b3202a';                                // seats
    for (const side of [-1, 1]) {
      roundRect(-h * 0.08, side * w * 0.42, h * 0.2, w * 0.5, w * 0.12);
      ctx.fill();
    }
  }

  // Passenger cruise boat, traced from a Thames river boat: a blunt rounded
  // bow, dark hull band, glazed forward saloon, open upper deck lined with
  // benches, and the wheelhouse aft.
  function drawCruiseBoat(s) {
    const k = cam.scale;
    const h = (s.length / 2) * k;
    const w = (s.beam / 2) * k;
    const outline = (inset) => {
      const hw = w - inset;
      const hh = h - inset;
      ctx.beginPath();
      ctx.moveTo(-hh, -hw);
      ctx.lineTo(hh - 1.6 * hw, -hw);
      ctx.bezierCurveTo(hh - 0.3 * hw, -hw, hh, -0.6 * hw, hh, 0);
      ctx.bezierCurveTo(hh, 0.6 * hw, hh - 0.3 * hw, hw, hh - 1.6 * hw, hw);
      ctx.lineTo(-hh, hw);
      ctx.closePath();
    };
    outline(0);                                               // hull and rubbing strake
    ctx.fillStyle = '#39424c';
    ctx.fill();
    outline(w * 0.1);                                         // upper deck
    ctx.fillStyle = '#f4f4f2';
    ctx.fill();

    // Forward saloon roof, ringed by its dark windows.
    const front = h - 0.16 * s.length * k;
    ctx.save();
    outline(w * 0.1);
    ctx.clip();
    ctx.fillStyle = '#26303a';
    ctx.fillRect(front, -w, h - front, 2 * w);
    ctx.restore();
    ctx.save();
    outline(w * 0.28);
    ctx.clip();
    ctx.fillStyle = '#eef0f0';
    ctx.fillRect(front + w * 0.18, -w, h - front, 2 * w);
    ctx.restore();

    // Rows of benches across the open deck, about 1.2 m apart.
    const aft = -h + 0.14 * s.length * k;
    ctx.fillStyle = '#b9c0c6';
    const gap = 1.2 * k;
    if (gap > 2) {
      for (let x = aft + gap; x < front - gap / 2; x += gap) {
        ctx.fillRect(x - gap * 0.2, -w * 0.72, gap * 0.4, w * 0.62);
        ctx.fillRect(x - gap * 0.2, w * 0.1, gap * 0.4, w * 0.62);
      }
    }

    // Wheelhouse near the stern: white roof with a dark window band.
    ctx.fillStyle = '#26303a';
    roundRect(-h + 0.08 * s.length * k, 0, 0.09 * s.length * k, w * 1.3, w * 0.1);
    ctx.fill();
    ctx.fillStyle = '#f7f7f7';
    roundRect(-h + 0.075 * s.length * k, 0, 0.07 * s.length * k, w * 1.1, w * 0.08);
    ctx.fill();
  }

  const POWER_DRAW = { speedBoat: drawSpeedBoat, cruise: drawCruiseBoat };

  function drawTrail(b) {
    ctx.strokeStyle = boatColor(b);
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = clamp(cam.scale * 0.2, 1, 3 * (window.devicePixelRatio || 1));
    ctx.beginPath();
    b.trail.forEach((p, i) => (i ? ctx.lineTo(sx(p.x), sy(p.y)) : ctx.moveTo(sx(p.x), sy(p.y))));
    ctx.lineTo(sx(b.x), sy(b.y));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawBoat(b) {
    const s = b.spec;
    const color = boatColor(b);
    ctx.save();
    ctx.lineJoin = 'round';                     // no flat stubs on the fine ends
    ctx.translate(sx(b.x), sy(b.y));
    ctx.rotate(-b.psi);
    if (b.motor ? hullTooSmall(b) : tooSmall) {
      // Too small to draw hulls to scale: show a marker pointing the way.
      const m = 7 * (window.devicePixelRatio || 1);
      ctx.beginPath();
      ctx.moveTo(m, 0);
      ctx.lineTo(-m * 0.7, -m * 0.6);
      ctx.lineTo(-m * 0.7, m * 0.6);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = b.role === 'You' ? '#fff' : 'rgba(0,0,0,0.6)';
      ctx.lineWidth = b.role === 'You' ? 2 : 1;
      ctx.stroke();
    } else if (b.motor) {
      POWER_DRAW[s.kind](s);
    } else {
      // Outlines are kept thin so they don't swallow the slim hulls.
      paddleHull(s);
      if (b.role === 'You') {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(3, cam.scale * 0.25);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = b.maxRoll >= 1 ? '#ff2d2d' : 'rgba(0,0,0,0.6)';
      ctx.lineWidth = Math.max(1, cam.scale * (b.maxRoll >= 1 ? 0.175 : 0.06));
      ctx.stroke();
      if (s.type === 'kayak') kayakDeck(s);
      else canoeDeck(s);
    }
    ctx.restore();

    ctx.fillStyle = '#fff';
    ctx.font = `600 ${Math.max(11, Math.min(15, cam.scale * 1.5))}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    const label = b.role === 'You' ? `YOU · ${s.name}` : s.name;
    ctx.fillText(label, sx(b.x) + Math.max(8, cam.scale * 1.2), sy(b.y));
    ctx.textAlign = 'start';
  }

  // Flow profiles across the river: arrows as long as the current is fast,
  // a curve through their tips, and speeds at the bank, partway out and mid-river.
  function drawFlowProfile(world, maxCurrent) {
    const dpr = window.devicePixelRatio || 1;
    const color = '#ffd166';
    const riverPx = RIVER.width * cam.scale;
    const ARROW = 70 * dpr;                      // arrow length at 2 m/s (7.2 km/h)
    const len = (x) => (currentAt(x, maxCurrent) / 2) * ARROW;
    const dir = -world.flowDir;                  // screen y grows down the river view

    ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    if (world.flowDir === 0 || maxCurrent === 0) {
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.fillText('No current', sx(RIVER.width / 2), canvas.height * 0.25);
      ctx.textAlign = 'start';
      return;
    }

    for (const frac of [0.25, 0.6]) {
      // Arrows point downstream, so start each row on its upstream side.
      const y0 = canvas.height * frac - (dir * ARROW) / 2;
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.5)';
      ctx.lineWidth = dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(sx(0), y0);
      ctx.lineTo(sx(RIVER.width), y0);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.5 * dpr;
      const step = riverPx > 200 * dpr ? 2 : 4;
      for (let x = step / 2; x < RIVER.width; x += step) {
        const l = len(x);
        if (l < 3 * dpr) continue;
        const tip = y0 + dir * l;
        ctx.beginPath();
        ctx.moveTo(sx(x), y0);
        ctx.lineTo(sx(x), tip);
        ctx.stroke();
        const head = Math.min(5 * dpr, l / 2);
        ctx.beginPath();
        ctx.moveTo(sx(x), tip);
        ctx.lineTo(sx(x) - head * 0.7, tip - dir * head);
        ctx.lineTo(sx(x) + head * 0.7, tip - dir * head);
        ctx.closePath();
        ctx.fill();
      }

      // The profile curve through the arrow tips.
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      for (let x = 0; x <= RIVER.width; x += 0.5) {
        const px = sx(x);
        const py = y0 + dir * len(x);
        if (x === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Speeds in km/h beside a few arrows, if there's room.
      if (riverPx < 140 * dpr) continue;
      ctx.textAlign = 'left';
      // Mid-river and 2 m from the bank, then a quarter of the way across if
      // its label has room; labels that would overlap one already placed are skipped.
      const placed = [];
      for (const x of [RIVER.width / 2, 2, RIVER.width / 4]) {
        const kmh = currentAt(x, maxCurrent) * 3.6;
        const ty = y0 + dir * len(x) + dir * 10 * dpr;
        const text = `${kmh.toFixed(1)} km/h`;
        const box = { x: sx(x) + 3 * dpr, y: ty - 8 * dpr, w: ctx.measureText(text).width + 6 * dpr, h: 16 * dpr };
        const clash = placed.some((p) => box.x < p.x + p.w + 4 * dpr && p.x < box.x + box.w + 4 * dpr
          && box.y < p.y + p.h && p.y < box.y + box.h);
        if (clash) continue;
        placed.push(box);
        ctx.fillStyle = 'rgba(10, 20, 30, 0.75)';
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.fillStyle = color;
        ctx.fillText(text, box.x + 3 * dpr, ty);
      }
      ctx.textAlign = 'start';
    }
  }

  // sources: the wakes on the water, from washSources().
  // flowProfile: the max current (m/s) to draw flow profiles for, or null.
  function draw(world, view, sources, flowProfile = null) {
    cam = camera(world, view);
    ctx.fillStyle = '#5b7d3a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    paintWater(sources);
    drawBanks();
    drawFlow();
    drawLine(START_Y, 'START');
    drawLine(world.course, 'FINISH');
    if (flowProfile != null) drawFlowProfile(world, flowProfile);
    // If any paddle boat's hull would be too small to make out, every paddle
    // boat shows as a marker, so they're never mixed. Powered boats go by
    // their own size, so a big cruise boat stays drawn to scale.
    tooSmall = world.boats.some((b) => !b.motor && hullTooSmall(b));
    // Every trail first, so no boat's trail is drawn over another boat.
    for (const b of world.boats) drawTrail(b);
    for (const b of world.boats) drawBoat(b);
    drawHud(world);
    if (tooSmall || world.boats.some((b) => b.motor && hullTooSmall(b))) drawScaleNote();
  }

  // Set each frame when any paddle boat is too small to show as a hull.
  let tooSmall = false;

  function hullTooSmall(b) {
    const dpr = window.devicePixelRatio || 1;
    return b.spec.length * cam.scale < MIN_HULL_PX * dpr
      || b.spec.beam * (b.motor ? 1 : BEAM_DRAWN) * cam.scale < MIN_BEAM_PX * dpr;
  }

  // Explains the ▲ markers, on the left bank under the current label.
  function drawScaleNote() {
    const dpr = window.devicePixelRatio || 1;
    const pad = 10 * dpr;
    const lines = ['Drawn to scale', 'Boats are too small to show', 'at this zoom, so ▲ marks', 'each one.'];
    ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16 * dpr;
    const lh = 15 * dpr;
    const x = pad;
    const y = pad + 30 * dpr;
    ctx.fillStyle = 'rgba(10, 20, 30, 0.72)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, lines.length * lh + 12 * dpr, 8 * dpr);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? '#fff' : 'rgba(255,255,255,0.8)';
      ctx.font = `${i === 0 ? 600 : 400} ${11 * dpr}px system-ui, sans-serif`;
      ctx.fillText(line, x + 8 * dpr, y + 6 * dpr + i * lh);
    });
    ctx.textAlign = 'start';
    ctx.textBaseline = 'middle';
  }

  resize();
  return { resize, draw, stepParticles, steeringAt };
}

// Your boat keeps its class colour; everyone else is neutral so you stand out.
export function boatColor(b) {
  return b.role === 'You' || b.motor ? b.spec.color : '#c3ccd5';
}
