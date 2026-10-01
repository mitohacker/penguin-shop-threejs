import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { makeLayout, shelfParts, walkClear, floorClear, GameState } from '../src/core.js';

const catalog = JSON.parse(fs.readFileSync('public/assets/catalog.json'));
const reference = JSON.parse(fs.readFileSync('tools/reference/shelf-layout.json'));
const layout = makeLayout(catalog);
const close = (a,b) => { assert.equal(a.length,b.length); a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-10,`${v} != ${b[i]}`)); };

test('100 shelf transforms and all 4000 slots match the captured original game', () => {
  assert.equal(layout.shelves.length,reference.shelves.length);
  for (const name of ['depth','height','clear']) assert.ok(Math.abs(layout[name]-reference[name])<1e-12);
  layout.shelves.forEach((s,i)=>{ close([s.x,0,s.z],reference.shelves[i].position); assert.equal(s.yaw,reference.shelves[i].yaw); });
  layout.slots.forEach((s,i)=>close(s.position,reference.slots[i]));
  for (const [name,hash] of Object.entries(reference.sourceHashes)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync('tools/reference/shelf-source/'+name)).digest('hex'),hash);
});
test('shelf boards and all row pictures retain original dimensions and back-panel positions', () => {
  const parts = shelfParts(layout.shelves[0],layout);
  assert.equal(parts.length,reference.parts.length);
  parts.forEach((p,i)=>{ close(p.size,reference.parts[i].size); close(p.position,reference.parts[i].position); });
  layout.rows.forEach((r,i)=>close(r.card,reference.rows[i].card));
});
test('central cross aisle is traversable across every bank and shelf fronts remain solid', () => {
  for (let x=-14;x<=14;x+=.1) { assert.equal(walkClear(x,-1.65,layout),true); assert.equal(floorClear(x,-1.65,layout,.35),true); }
  for (let bank=0;bank<5;bank++) {
    const x=(bank-2)*5.5;
    for (let bay=0;bay<10;bay++) assert.equal(walkClear(x,layout.shelves[(bank*10+bay)*2].z,layout),false);
  }
});
test('existing stocked inventory and rewards survive the shelf layout correction', () => {
  const state = new GameState(catalog,layout,{mode:'assigned',seed:12});
  for (let id=0;id<10;id++) { state.pick(id); state.place(0); }
  state.pick(10);
  const snapshot = state.save(Array.from({length:4000},()=>[2.7,0,14.7,0,0,0,1]),{mode:'walk',position:[2.75,1.75,14.5],yaw:0,pitch:-.12,zoom:1});
  const restored = new GameState(catalog,layout); restored.restore(snapshot);
  assert.equal(restored.sorted,10); assert.equal(restored.coins,20); assert.equal(restored.held,10); assert.deepEqual(restored.slots,state.slots);
});
