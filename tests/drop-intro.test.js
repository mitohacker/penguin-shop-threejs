import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { DropIntro } from '../src/drop-intro.js';
import { GameState, makeLayout, validateSave } from '../src/core.js';

const catalog = JSON.parse(fs.readFileSync('public/assets/catalog.json'));
const layout = makeLayout(catalog), info = JSON.parse(fs.readFileSync('public/assets/start-layouts.json'));
const camera = {mode:'walk',position:[2.75,1.75,14.5],yaw:0,pitch:-.12,zoom:1};
test('all original starting layouts preserve every destination and orientation', () => {
  assert.equal(info.files.length,32); assert.equal(info.config.batchSize,500); assert.equal(info.config.batchSeconds,.2);
  const state = new GameState(catalog,layout,{seed:7});
  for (const path of info.files) {
    const data = JSON.parse(fs.readFileSync(`public/${path.slice(2)}`));
    validateSave(state.save(data.poses,camera),state);
    const source = JSON.parse(fs.readFileSync(`tools/reference/start-layout-${path.match(/slot-(\d+)/)[1]}.json`));
    for (let id=0; id<4000; id++) {
      const p = source.items[id].pose, v = data.poses[id];
      for (let n=0;n<3;n++) assert.ok(Math.abs(v[n]-p[n+9])<=.00000051);
      const actual = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(...v.slice(3))).elements;
      const expected = [...p.slice(0,3),0,...p.slice(3,6),0,...p.slice(6,9),0,...p.slice(9),1];
      for (const n of [0,1,2,4,5,6,8,9,10]) assert.ok(Math.abs(actual[n]-expected[n])<.00002);
    }
  }
});
test('opening pour hides unreleased dolls, falls to exact destinations, and never moves saved poses', () => {
  const state = new GameState(catalog,layout,{seed:37});
  const raw = JSON.parse(fs.readFileSync(`public/${info.files[0].slice(2)}`)).poses;
  const poses = raw.map(v=>({p:new THREE.Vector3(...v.slice(0,3)),q:new THREE.Quaternion(...v.slice(3))}));
  const intro = new DropIntro(poses,state.items,catalog.products,layout.height,info.config,state.seed);
  assert.ok([...intro.entries.keys()].every(id=>intro.pose(id)===null));
  const order = [...intro.entries.keys()];
  assert.ok(intro.entries.get(order[500]).start>=.2);
  const id = order[0], entry = intro.entries.get(id), t = entry.duration*.4;
  intro.elapsed = entry.start+t;
  const drawn = intro.pose(id), drawnCenter = entry.center.clone().applyQuaternion(drawn.q).add(drawn.p);
  assert.ok(Math.abs(drawnCenter.y-entry.restCenter.y-(entry.height-.5*9.8*t*t))<1e-8);
  assert.ok(drawnCenter.distanceTo(entry.restCenter)>.3);
  intro.elapsed = 0;
  while (!intro.finished) intro.advance(1/60);
  assert.equal(intro.landed,4000); assert.ok(intro.elapsed<2.5); assert.equal(intro.progress,1);
  for (const item of state.items) assert.equal(intro.pose(item.id),poses[item.id]);
  assert.deepEqual(poses.map(p=>[...p.p.toArray(),...p.q.toArray()]),raw);
});
test('reference copies still match their original-source hashes', () => {
  const hashes = JSON.parse(fs.readFileSync('tools/reference/copy-hashes.json'));
  for (const [path,expected] of Object.entries(hashes)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex'),expected,path);
  const originals = JSON.parse(fs.readFileSync('tools/reference/source-hashes.json'));
  for (const [path,hash] of Object.entries(originals)) {
    const n = path.match(/penguin_start_slot_(\d+)\.json$/)?.[1];
    const copy = n ? `tools/reference/start-layout-${n}.json` : 'tools/reference/pour.cfg';
    assert.equal(hashes[copy],hash,copy);
  }
});
