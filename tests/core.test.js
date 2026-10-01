import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { GameState, makeLayout, validateSave, floorClear } from '../src/core.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../public/assets/catalog.json', import.meta.url)));
const layout = makeLayout(catalog);
const fresh = mode => new GameState(catalog, layout, { mode, seed: 12 });
const poses = () => Array.from({ length: 4000 }, () => [2.7, 0, 14.7, 0, 0, 0, 1]);
const camera = { mode: 'overview', position: [2.75, 1.75, 14.7], yaw: 0, pitch: -.15, zoom: 1 };

test('real catalog creates 100 shelf faces, 400 consistent rows and 4,000 unique slots', () => {
  assert.equal(catalog.products.length, 160); assert.equal(layout.shelves.length, 100); assert.equal(layout.rows.length, 400); assert.equal(layout.slots.length, 4000);
  assert.equal(new Set(layout.slots.map(s => s.position.join(','))).size, 4000);
  for (let row = 0; row < 400; row++) assert.equal(new Set(layout.expected.slice(row * 10, row * 10 + 10)).size, 1);
  assert.equal(floorClear(2.75, 14.7, layout, .22), true);
});
test('bag capacity blocks pickup without losing an item', () => {
  const s = fresh('free'); for (let i = 0; i < 5; i++) assert.equal(s.pick(i).ok, true);
  assert.equal(s.pick(5).ok, false); assert.equal(s.items[5].location, 'floor'); assert.equal(s.bag.length, 5);
  assert.equal(s.pick(0).ok, false);
});
test('assigned rows reject the wrong design and preserve carried inventory', () => {
  const s = fresh('assigned'); const wrong = s.items.find(i => i.product !== layout.expected[0]); s.pick(wrong.id);
  assert.equal(s.place(0).ok, false); assert.equal(s.held, wrong.id); assert.equal(s.sorted, 0);
});
test('free rows reserve capacity for all designs', () => {
  const s = fresh('free'), product = s.items[0].product;
  const ids = s.items.filter(i => i.product === product).map(i => i.id);
  const allowed = Math.ceil(ids.length / 10);
  for (let i = 0; i < allowed; i++) { s.pick(ids[i]); assert.equal(s.place(i).ok, true); }
  s.pick(ids[allowed]); assert.equal(s.place(allowed).ok, false); assert.equal(s.held, ids[allowed]);
});
test('repeated pickup and restocking cannot farm item or row rewards', () => {
  const s = fresh('assigned'); for (let id = 0; id < 10; id++) { s.pick(id); assert.equal(s.place(0).ok, true); }
  assert.equal(s.coins, 20); s.pick(0); const r = s.place(0); assert.equal(r.reward, 0); assert.equal(r.bonus, 0); assert.equal(s.coins, 20);
});
test('all 4,000 penguins can be sorted in both modes and earn exactly 8,000 coins', () => {
  for (const mode of ['assigned', 'free']) {
    const s = fresh(mode);
    for (let id = 0; id < 4000; id++) { assert.equal(s.pick(id).ok, true); assert.equal(s.place(Math.floor(id / 10)).ok, true); }
    assert.equal(s.complete, true); assert.equal(s.coins, 8000); assert.equal(s.rewardedRows.size, 400);
    const data = s.save(poses(), camera); assert.equal(validateSave(data, s), true);
  }
});
test('upgrade prices, inventory expansion and cooldowns use original balance', () => {
  const s = fresh('assigned'); for (let id = 0; id < 30; id++) { s.pick(id); s.place(Math.floor(id / 10)); }
  assert.equal(s.coins, 60); assert.equal(s.buy('inventory').ok, true); assert.equal(s.capacity, 5);
  assert.equal(s.buy('inventory').ok, true); assert.equal(s.capacity, 6); assert.equal(s.coins, 0); assert.equal(s.buy('shift_move').ok, false);
  s.levels.match = 1; assert.equal(s.activate('match').ok, true); s.tick(5); assert.equal(s.timers.match.cooldown, 600);
  assert.equal(s.activate('match').ok, false); s.tick(600); assert.equal(s.activate('match').ok, true);
});
test('save roundtrip preserves bag, shelf state and the exact economy', () => {
  const s = fresh('free'); for (let id = 0; id < 10; id++) { s.pick(id); s.place(2); } s.pick(10);
  const data = JSON.parse(JSON.stringify(s.save(poses(), camera))); const restored = fresh('free'); restored.restore(data);
  assert.equal(restored.sorted, 10); assert.equal(restored.held, 10); assert.equal(restored.coins, 20);
  assert.deepEqual(restored.slots, s.slots);
  assert.ok(Buffer.byteLength(JSON.stringify(data)) < 490000);
});
test('corrupt saves reject duplicated items, forged coins, invalid poses and missing items', () => {
  const s = fresh('assigned'); s.pick(0); s.place(0); s.pick(1);
  const valid = s.save(poses(), camera);
  const changes = [d => d.bag.push(1), d => d.coins += 500, d => d.poses[0][0] = 99, d => d.items[2][0] = 1, d => d.camera.position[0] = Infinity, d => d.slots[2] = 0];
  for (const change of changes) { const data = structuredClone(valid); change(data); assert.throws(() => validateSave(data, s)); }
});
test('every deployed model, buffer, texture and thumbnail resolves within the independent project', () => {
  const root = path.resolve('public');
  for (const product of catalog.products) {
    const filename = path.resolve(root, product.model); assert.ok(filename.startsWith(root + path.sep)); assert.ok(fs.existsSync(filename));
    assert.ok(fs.existsSync(path.resolve(root, product.thumbnail)));
    const gltf = JSON.parse(fs.readFileSync(filename));
    for (const resource of [...gltf.buffers, ...(gltf.images ?? [])]) {
      if (!resource.uri || resource.uri.startsWith('data:')) continue;
      const dep = path.resolve(path.dirname(filename), decodeURIComponent(resource.uri)); assert.ok(dep.startsWith(root + path.sep)); assert.ok(fs.existsSync(dep));
    }
  }
});
test('original project assets retain their recorded SHA256 hashes', t => {
  const hashes = JSON.parse(fs.readFileSync('tools/source-integrity.json'));
  if (Object.keys(hashes).every(filename => !fs.existsSync(filename))) {
    t.skip('Original Godot project is unavailable on this machine; independent deployment assets are tested above.');
    return;
  }
  for (const [filename, digest] of Object.entries(hashes)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'), digest, filename);
});
