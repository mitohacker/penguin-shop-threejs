import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PenguinPhysics, initPhysics } from '../src/physics.js';

await initPhysics();
function fixture() {
  const items = [{ id: 0, product: 'a', location: 'floor' }, { id: 1, product: 'a', location: 'floor' }, { id: 2, product: 'b', location: 'floor' }];
  const view = {
    catalog: { products: ['a', 'b'].map(id => ({ id, size: [.4, .6, .4] })) }, state: { items },
    solids: [new THREE.Box3(new THREE.Vector3(-15, -.3, -20), new THREE.Vector3(15, 0, 20))],
    poses: items.map((item, n) => ({ p: new THREE.Vector3(n * 2, 0, 0), q: new THREE.Quaternion() })),
    write() {}, capturePoses() { return this.poses.map(p => [...p.p.toArray(), ...p.q.toArray()]); },
  };
  return { view, physics: new PenguinPhysics(view, {}) };
}
test('match lift raises the matching design without lifting others or the walking surface', () => {
  const { view, physics } = fixture();
  try {
    physics.setMatchLift('a');
    assert.equal(physics.lifted.size, 2); assert.equal(physics.active.size, 0);
    assert.equal(view.poses[0].p.y, 2.6); assert.equal(view.poses[1].p.y, 2.6); assert.equal(view.poses[2].p.y, 0);
    assert.equal(physics.walkHeight(new THREE.Vector3(0, 0, 0)), 0);
    assert.equal(physics.savedPoses()[0][1], 0);
    physics.setMatchLift(null);
    assert.equal(view.poses[0].p.y, 0); assert.equal(physics.lifted.size, 0); assert.equal(physics.active.size, 2);
  } finally { physics.dispose(); }
});
test('picking a lifted penguin removes its lift record and expiry never puts it back on the floor', () => {
  const { view, physics } = fixture();
  try {
    physics.setMatchLift('a'); view.state.items[0].location = 'bag'; physics.take(0);
    assert.equal(physics.lifted.has(0), false);
    physics.setMatchLift('b');
    assert.equal(physics.lifted.has(2), true); assert.equal(physics.active.has(0), false);
    assert.equal(view.state.items[0].location, 'bag'); assert.equal(view.poses[1].p.y, 0);
  } finally { physics.dispose(); }
});
test('carried releases fall onto the floor and onto a destination pile under gravity', () => {
  for (const x of [10,4]) {
    const {view,physics} = fixture();
    try {
      view.state.items[0].location='bag'; physics.index(0);
      const release = physics.dropPosition(0,new THREE.Vector3(x,1.75,.6),new THREE.Vector3(0,0,-1),0);
      assert.ok(release);
      view.poses[0].p.copy(release.p); view.poses[0].q.copy(release.q);
      view.state.items[0].location='floor'; physics.wake(0);
      const startY = view.poses[0].p.y; physics.step(.1); assert.ok(view.poses[0].p.y<startY);
      for(let n=0;n<360;n++) physics.step(1/60);
      const expected = x===4 ? .6 : 0;
      assert.ok(Math.abs(view.poses[0].p.y-expected)<.04,`Doll stopped at ${view.poses[0].p.y}, expected ${expected}.`);
      assert.ok(Math.abs(view.poses[0].p.x-x)<.02);
    } finally {physics.dispose();}
  }
});
test('release checks the whole hull and refuses a completely obstructed hand', () => {
  const {view,physics} = fixture();
  try {
    view.state.items[0].location='bag'; physics.index(0);
    // The origin clears the other doll, but its side intersects the doll's hull.
    view.poses[1].p.set(10,1,0); physics.index(1);
    assert.equal(physics.dropClear(0,{p:new THREE.Vector3(9.7,1,0),q:new THREE.Quaternion()}),false);
    assert.equal(physics.dropClear(0,{p:new THREE.Vector3(9.5,1,0),q:new THREE.Quaternion()}),true);
    const saved = view.capturePoses();
    // A static room-wide obstruction blocks every alternative release.
    physics.staticShapes.push({box:new THREE.Box3(new THREE.Vector3(-20,0,-20),new THREE.Vector3(20,5,20)),center:new THREE.Vector3(0,2.5,0),shape:new RAPIER.Cuboid(20,2.5,20),q:new THREE.Quaternion()});
    assert.equal(physics.dropPosition(0,new THREE.Vector3(10,1.75,0),new THREE.Vector3(0,0,-1),0),null);
    assert.equal(view.state.items[0].location,'bag'); assert.deepEqual(view.capturePoses(),saved);
  } finally {physics.dispose();}
});
