// Illustrative figures for comparing boats, not measured hull data. They're
// set so the classes' speeds relative to each other match race results; see
// "Boat figures" in the README.
// type (kayak or canoe) isn't used yet; it's kept for simulating paddle strokes.
// beam only sets how wide the hull is drawn.
// dragK lumps 0.5 * rho * Cd * A so that drag force = dragK * v^2 (N): the
// hull's resistance alone.
// efficiency is the share of the paddler's power that drives the boat
// forward. A kayak's alternating double blade drives straight; a canoe's
// single blade on one side also yaws the boat and needs correcting every
// stroke, so less of its power goes forward.
// swayK does the same for sliding sideways: 0.5 * rho * Cd * side area below water.
// maxTurn is the turn rate (deg/s) at full steering.
// pivot is where the hull turns about, as a fraction of length from the bow.
// steerCost is the fraction of forward power lost at full steering effort:
// kayaks steer with a rudder, canoes with correction strokes.
// rollLimit is the roll angle (deg) treated as the capsize point.
// wake is the height (m) of the boat's own wash at 4 m/s (14.4 km/h).
// twist is how strongly the hull follows water turning it: current or wash
// moving the bow sideways differently from the stern.
export const BOATS = {
  K1: {
    name: 'K1', type: 'kayak', paddlers: 1,
    length: 5.2, beam: 0.41, mass: 92,
    dragK: 2.3, efficiency: 0.7, swayK: 250, maxTurn: 25, pivot: 0.3, steerCost: 0.08, rollLimit: 8, wake: 0.09, twist: 0.6,
    color: '#e4572e',
  },
  K2: {
    name: 'K2', type: 'kayak', paddlers: 2,
    length: 6.5, beam: 0.41, mass: 178,
    dragK: 3.7, efficiency: 0.7, swayK: 350, maxTurn: 20, pivot: 0.3, steerCost: 0.08, rollLimit: 9, wake: 0.11, twist: 0.6,
    color: '#f3a712',
  },
  C1: {
    name: 'C1', type: 'canoe', paddlers: 1,
    length: 5.2, beam: 0.35, mass: 94,
    dragK: 2.3, efficiency: 0.56, swayK: 270, maxTurn: 18, pivot: 0.45, steerCost: 0.35, rollLimit: 6.5, wake: 0.10, twist: 0.6,
    color: '#29bf12',
  },
  C2: {
    name: 'C2', type: 'canoe', paddlers: 2,
    length: 6.5, beam: 0.45, mass: 180,
    dragK: 3.8, efficiency: 0.58, swayK: 380, maxTurn: 16, pivot: 0.4, steerCost: 0.25, rollLimit: 8, wake: 0.12, twist: 0.6,
    color: '#a855f7',
  },
};

// Untouched copy, so edited settings can be put back.
export const DEFAULT_BOATS = structuredClone(BOATS);

// Powered boats that pass you. They hold a set speed through the water.
// speed is the starting speed and minSpeed-maxSpeed the slider's range (km/h).
// wash is the wash height (m) at the starting speed; at other speeds it
// follows washCurve in physics.js.
export const POWER_BOATS = {
  speedBoat: {
    name: 'Speed boat', kind: 'speedBoat', length: 5.5, beam: 2.2,
    speed: 18, minSpeed: 5, maxSpeed: 45, wash: 0.29, color: '#f4f4f4',
  },
  cruise: {
    name: 'Cruise boat', kind: 'cruise', length: 100, beam: 11.2,
    speed: 12, minSpeed: 4, maxSpeed: 20, wash: 0.15, color: '#f4f4f4',
  },
};
