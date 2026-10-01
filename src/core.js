export const SAVE_VERSION = 1;
export const CAPACITY = 4000;
export const ROW_SIZE = 10;
export const UPGRADE_NAMES = { inventory: 'Roomier bag', shift_move: 'Quick feet', zoom: 'Wide view', match: 'Find twins', guide: 'Shelf compass' };

export function random(seed) {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function makeLayout(catalog) {
  const size = [0, 0, 0];
  catalog.products.forEach(p => p.size.forEach((v, i) => size[i] = Math.max(size[i], v)));
  const clear = size[1] + .03, depth = Math.max(.98, size[2] * 2 + .06);
  const height = .1 + 4 * (clear + .04);
  const slots = [], rows = [], shelves = [], expected = [];
  for (let bank = 0; bank < 5; bank++) for (let bay = 0; bay < 10; bay++) for (let side = 0; side < 2; side++) {
    const id = (bank * 10 + bay) * 2 + side;
    const yaw = side === 0 ? -Math.PI / 2 : Math.PI / 2;
    const x = (bank - 2) * 5.5 + (side === 0 ? -1 : 1) * (depth * .5 + .01);
    const z = -15 + bay * 2.7 + (bay >= 5 ? 2.4 : 0);
    const sheet = catalog.sheets[Math.floor(id * catalog.sheets.length / 100)];
    const products = catalog.products.filter(p => p.sheet === sheet.id);
    shelves.push({ id, x, z, yaw, width: 2.6, depth, height, sheet: sheet.id });
    for (let row = 0; row < 4; row++) {
      const product = products[((id % 10) * 4 + row) % products.length];
      const y = .1 + row * (clear + .04);
      const rowId = id * 4 + row;
      const cardZ = -depth * .5 + .05;
      rows.push({ id: rowId, shelf: id, y, clear, product: product.id, center: [x + Math.sin(yaw) * (depth * .5 + .025), y + clear / 2, z], card: [x + Math.sin(yaw) * cardZ, y + clear - .2, z + Math.cos(yaw) * cardZ], yaw });
      for (let col = 0; col < 10; col++) {
        const lx = -1.24 + .496 * ((col % 5) + .5);
        const lz = -depth * .5 + .04 + (depth - .04) * (col < 5 ? .25 : .75);
        slots.push({ position: [x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, y, z - Math.sin(yaw) * lx + Math.cos(yaw) * lz], yaw, row: rowId });
        expected.push(product.id);
      }
    }
  }
  return { slots, rows, shelves, expected, size, depth, height, clear };
}

export function shelfParts(shelf, layout) {
  const parts = [{ size: [2.6, .1, shelf.depth], position: [0, .05, 0] }];
  for (let row = 1; row < 4; row++) parts.push({ size: [2.48, .04, shelf.depth], position: [0, .1 + row * (layout.clear + .04) - .02, 0] });
  parts.push({ size: [2.6, .04, shelf.depth], position: [0, shelf.height - .02, 0] }, { size: [2.6, shelf.height, .04], position: [0, shelf.height / 2, -shelf.depth / 2 + .02] });
  for (const side of [-1, 1]) parts.push({ size: [.06, shelf.height, shelf.depth], position: [side * 1.27, shelf.height / 2, 0] });
  return parts;
}

export class GameState {
  constructor(catalog, layout, { seed = Date.now() >>> 0, mode = 'free' } = {}) {
    this.catalog = catalog; this.layout = layout;
    this.signature = JSON.stringify(catalog.products.map(p => [p.id, ...p.size]));
    this.seed = seed; this.mode = mode;
    this.items = layout.expected.map((product, id) => ({ id, product, location: 'floor', slot: -1, rewarded: false }));
    this.slots = Array(CAPACITY).fill(-1); this.bag = [];
    this.rewardedRows = new Set(); this.coins = 0; this.spent = 0; this.elapsed = 0;
    this.levels = Object.fromEntries(Object.keys(catalog.upgrades).map(id => [id, 0]));
    this.timers = { match: { active: 0, cooldown: 0 }, guide: { active: 0, cooldown: 0 } };
    this.counts = new Map(); this.items.forEach(i => this.counts.set(i.product, (this.counts.get(i.product) ?? 0) + 1));
  }
  get held() { return this.bag.at(-1) ?? -1; }
  get sorted() { return this.items.reduce((n, i) => n + (i.location === 'shelf'), 0); }
  get complete() { return this.slots.every(id => id >= 0); }
  effect(id, key, fallback) { return this.catalog.upgrades[id]?.[this.levels[id] - 1]?.[key] ?? fallback; }
  get capacity() { return this.effect('inventory', 'capacity', 5); }
  cost(id) { return this.catalog.upgrades[id]?.[this.levels[id]]?.cost ?? null; }
  buy(id) {
    const cost = this.cost(id);
    if (cost === null) return { ok: false, reason: 'Fully upgraded.' };
    if (this.coins < cost) return { ok: false, reason: `You need ${cost - this.coins} more coins.` };
    this.coins -= cost; this.spent += cost; this.levels[id]++;
    return { ok: true };
  }
  rowProduct(row) {
    if (this.mode === 'assigned') return this.layout.expected[row * 10];
    for (let s = row * 10; s < row * 10 + 10; s++) if (this.slots[s] >= 0) return this.items[this.slots[s]].product;
    return null;
  }
  accepts(row, product) {
    const assigned = this.rowProduct(row);
    if (assigned) return assigned === product;
    let claims = 0;
    for (let r = 0; r < 400; r++) if (this.rowProduct(r) === product) claims++;
    return claims < Math.ceil(this.counts.get(product) / 10);
  }
  pick(id) {
    const item = this.items[id];
    if (!item || item.location === 'bag') return { ok: false, reason: 'Choose a penguin.' };
    if (this.bag.length >= this.capacity) return { ok: false, reason: 'Your bag is full. Stock a row or upgrade your bag.' };
    if (item.slot >= 0) this.slots[item.slot] = -1;
    item.slot = -1; item.location = 'bag'; this.bag.push(id);
    return { ok: true, id };
  }
  place(row) {
    if (!Number.isInteger(row) || row < 0 || row >= 400 || this.held < 0) return { ok: false, reason: 'Pick up a penguin first.' };
    const item = this.items[this.held];
    if (!this.accepts(row, item.product)) return { ok: false, reason: 'This row is for another design. Fill a matching row first.' };
    let slot = -1;
    for (let s = row * 10; s < row * 10 + 10; s++) if (this.slots[s] === -1) { slot = s; break; }
    if (slot < 0) return { ok: false, reason: 'This row is full.' };
    this.bag.pop(); this.slots[slot] = item.id; item.location = 'shelf'; item.slot = slot;
    let reward = 0, bonus = 0;
    if (!item.rewarded) { item.rewarded = true; reward = 1; }
    if (!this.rewardedRows.has(row) && this.slots.slice(row * 10, row * 10 + 10).every(id => id >= 0)) { this.rewardedRows.add(row); bonus = 10; }
    this.coins += reward + bonus;
    return { ok: true, id: item.id, slot, reward, bonus };
  }
  drop() {
    const id = this.bag.pop();
    if (id === undefined) return { ok: false, reason: 'Your bag is empty.' };
    this.items[id].location = 'floor'; return { ok: true, id };
  }
  cycle(direction = 1) {
    if (this.bag.length < 2) return;
    if (direction > 0) this.bag.unshift(this.bag.pop()); else this.bag.push(this.bag.shift());
  }
  activate(id) {
    const timer = this.timers[id];
    if (!timer || !this.levels[id]) return { ok: false, reason: 'Unlock this ability in Upgrades.' };
    if (timer.active > 0 || timer.cooldown > 0) return { ok: false, reason: 'This ability is recharging.' };
    timer.active = this.effect(id, 'duration_seconds', 5); return { ok: true };
  }
  tick(dt) {
    this.elapsed += dt;
    for (const [id, timer] of Object.entries(this.timers)) {
      if (timer.active > 0) {
        timer.active = Math.max(0, timer.active - dt);
        if (timer.active === 0) timer.cooldown = this.effect(id, 'cooldown_minutes', 10) * 60;
      } else timer.cooldown = Math.max(0, timer.cooldown - dt);
    }
  }
  save(poses, camera) {
    return { version: SAVE_VERSION, signature: this.signature, seed: this.seed, mode: this.mode, items: this.items.map(i => [i.location === 'floor' ? 0 : i.location === 'bag' ? 1 : 2, i.slot, +i.rewarded]), slots: this.slots, bag: this.bag, rewardedRows: [...this.rewardedRows], coins: this.coins, spent: this.spent, levels: this.levels, timers: this.timers, elapsed: this.elapsed, poses, camera, savedAt: new Date().toISOString() };
  }
  restore(data) {
    validateSave(data, this);
    this.seed = data.seed; this.mode = data.mode;
    this.items.forEach((item, id) => { const v = data.items[id]; item.location = ['floor', 'bag', 'shelf'][v[0]]; item.slot = v[1]; item.rewarded = !!v[2]; });
    this.slots = [...data.slots]; this.bag = [...data.bag]; this.rewardedRows = new Set(data.rewardedRows);
    this.coins = data.coins; this.spent = data.spent; this.levels = { ...data.levels };
    this.timers = structuredClone(data.timers); this.elapsed = data.elapsed;
  }
}

export function validateSave(d, state) {
  const fail = message => { throw new Error(message); };
  const integer = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!d || d.version !== SAVE_VERSION || d.signature !== state.signature) fail('This save belongs to another game version.');
  if (!['free', 'assigned'].includes(d.mode) || !integer(d.seed, 0, 4294967295) || !Number.isFinite(d.elapsed) || d.elapsed < 0) fail('Invalid session.');
  if (!Array.isArray(d.items) || d.items.length !== CAPACITY || !Array.isArray(d.slots) || d.slots.length !== CAPACITY || !Array.isArray(d.bag) || !Array.isArray(d.rewardedRows)) fail('Incomplete inventory.');
  if (!d.levels || !d.timers) fail('Incomplete upgrades.');
  let spent = 0;
  for (const [id, defs] of Object.entries(state.catalog.upgrades)) {
    if (!integer(d.levels[id], 0, defs.length)) fail('Invalid upgrade level.');
    spent += defs.slice(0, d.levels[id]).reduce((sum, row) => sum + row.cost, 0);
  }
  for (const id of ['match', 'guide']) for (const key of ['active', 'cooldown']) if (!Number.isFinite(d.timers[id]?.[key]) || d.timers[id][key] < 0 || d.timers[id][key] > 86400) fail('Invalid ability timers.');
  const cap = state.catalog.upgrades.inventory[d.levels.inventory - 1]?.capacity ?? 5;
  if (d.bag.length > cap) fail('Bag exceeds capacity.');
  const used = new Set(), rowTypes = new Map(), claims = new Map();
  let rewarded = 0;
  d.items.forEach((r, id) => {
    if (!Array.isArray(r) || r.length !== 3 || !integer(r[0], 0, 2) || !integer(r[1], -1, 3999) || ![0, 1].includes(r[2])) fail('Invalid item record.');
    if ((r[0] === 2) !== (r[1] >= 0)) fail('Invalid item location.');
    rewarded += r[2];
  });
  d.slots.forEach((id, slot) => {
    if (!integer(id, -1, 3999)) fail('Invalid shelf slot.');
    if (id < 0) return;
    if (used.has(id) || d.items[id][0] !== 2 || d.items[id][1] !== slot || d.items[id][2] !== 1) fail('Duplicate or inconsistent shelf item.');
    used.add(id);
    const product = state.items[id].product, row = Math.floor(slot / 10);
    if (d.mode === 'assigned' && product !== state.layout.expected[slot]) fail('Incorrect assigned row.');
    if (rowTypes.has(row) && rowTypes.get(row) !== product) fail('Mixed designs in a row.');
    rowTypes.set(row, product);
  });
  for (const id of d.bag) {
    if (!integer(id, 0, 3999) || used.has(id) || d.items[id][0] !== 1) fail('Duplicate or invalid bag item.');
    used.add(id);
  }
  d.items.forEach((r, id) => { if ((r[0] !== 0) !== used.has(id)) fail('Missing inventory item.'); });
  for (const product of rowTypes.values()) claims.set(product, (claims.get(product) ?? 0) + 1);
  if (d.mode === 'free') for (const [p, n] of claims) if (n > Math.ceil(state.counts.get(p) / 10)) fail('Too many claimed rows.');
  if (new Set(d.rewardedRows).size !== d.rewardedRows.length || d.rewardedRows.some(r => !integer(r, 0, 399))) fail('Invalid row rewards.');
  if (!integer(d.coins, 0, 8000) || d.spent !== spent || d.coins !== rewarded + d.rewardedRows.length * 10 - spent) fail('Invalid coin balance.');
  if (!Array.isArray(d.poses) || d.poses.length !== CAPACITY || d.poses.some(p => !Array.isArray(p) || p.length !== 7 || p.some(v => !Number.isFinite(v)) || Math.abs(p[0]) > 15 || p[1] < -.1 || p[1] > 6 || Math.abs(p[2]) > 20 || Math.abs(Math.hypot(...p.slice(3)) - 1) > .02)) fail('Invalid penguin poses.');
  if (!d.camera || !['overview', 'walk'].includes(d.camera.mode) || !Array.isArray(d.camera.position) || d.camera.position.length !== 3 || d.camera.position.some(v => !Number.isFinite(v) || Math.abs(v) > 100) || !Number.isFinite(d.camera.yaw) || !Number.isFinite(d.camera.pitch) || !Number.isFinite(d.camera.zoom) || d.camera.zoom < .5 || d.camera.zoom > 3) fail('Invalid camera.');
  return true;
}

export function floorClear(x, z, layout, margin = .3) {
  if (Math.abs(x) > 14.6 - margin || Math.abs(z) > 19.5 - margin) return false;
  for (let bank = 0; bank < 5; bank++) if (Math.abs(x - (bank - 2) * 5.5) < layout.depth + .01 + margin) {
    for (let bay = 0; bay < 10; bay++) {
      const bayZ = layout.shelves[(bank * 10 + bay) * 2].z;
      if (Math.abs(z - bayZ) < 1.3 + margin) return false;
    }
  }
  for (const cx of [-9, -3, 3, 9]) if (Math.abs(x - cx) < 1.95 + margin && Math.abs(z - 17.2) < .9 + margin) return false;
  return true;
}

export function walkClear(x, z, layout) {
  if (Math.abs(x) > 14.5 || Math.abs(z) > 19.4) return false;
  for (let bank = 0; bank < 5; bank++) if (Math.abs(x - (bank - 2) * 5.5) < layout.depth + .01 + .26) {
    for (let bay = 0; bay < 10; bay++) if (Math.abs(z - layout.shelves[(bank * 10 + bay) * 2].z) < 1.5) return false;
  }
  for (const cx of [-9, -3, 3, 9]) if (Math.abs(x - cx) < 1.95 && Math.abs(z - 17.2) < .9) return false;
  return true;
}
