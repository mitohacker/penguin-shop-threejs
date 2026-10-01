import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { floorClear } from './core.js';

export async function initPhysics() { await RAPIER.init(); }

export class PenguinPhysics {
  constructor(view, hulls) {
    this.view = view; this.hulls = hulls; this.active = new Map(); this.supports = new Map(); this.spatial = new Map(); this.cells = new Map(); this.lifted = new Map();
    this.products = new Map(view.catalog.products.map(p => [p.id, p]));
    this.shapes = new Map(); this.staticShapes = [];
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); this.world.timestep = 1 / 60;
    this.accumulator = 0;
    for (const box of view.solids) {
      const center = box.getCenter(new THREE.Vector3()), half = box.getSize(new THREE.Vector3()).multiplyScalar(.5);
      const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(center.x, center.y, center.z).setFriction(.65);
      this.world.createCollider(desc); this.staticShapes.push({ box, center, shape: desc.shape, q: new THREE.Quaternion() });
    }
    // As in the original, loose dolls cannot roll into the empty shelf rows.
    // These guards affect physics only; shelf targeting still reaches the rows.
    for (const shelf of view.layout?.shelves ?? []) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), shelf.yaw);
      const center = new THREE.Vector3(0, shelf.height/2, shelf.depth/2+.02).applyQuaternion(q).add(new THREE.Vector3(shelf.x,0,shelf.z));
      const half = new THREE.Vector3(.02,shelf.height/2,shelf.width/2);
      const box = new THREE.Box3(center.clone().sub(half),center.clone().add(half));
      const desc = RAPIER.ColliderDesc.cuboid(shelf.width/2,shelf.height/2,.02).setTranslation(center.x,center.y,center.z).setRotation(q).setFriction(.65);
      this.world.createCollider(desc); this.staticShapes.push({box,center,shape:desc.shape,q});
    }
    this.rebuild();
  }
  key(p) { return `${Math.floor(p.x)},${Math.floor(p.z)}`; }
  index(id) {
    const old = this.cells.get(id); if (old) this.spatial.get(old)?.delete(id);
    if (this.view.state.items[id].location !== 'floor') { this.cells.delete(id); return; }
    const key = this.key(this.view.poses[id].p); this.cells.set(id, key);
    if (!this.spatial.has(key)) this.spatial.set(key, new Set()); this.spatial.get(key).add(id);
  }
  rebuild() { this.spatial.clear(); this.cells.clear(); for (const item of this.view.state.items) this.index(item.id); }
  walkHeight(point) {
    let highest = 0;
    const matrix = new THREE.Matrix4();
    for (const id of this.nearby(point, .75)) {
      if (this.lifted.has(id)) continue;
      const pose = this.view.poses[id], size = this.products.get(this.view.state.items[id].product).size;
      matrix.makeRotationFromQuaternion(pose.q); const r = matrix.elements;
      const center = new THREE.Vector3(0, size[1] / 2, 0).applyQuaternion(pose.q).add(pose.p);
      const ex = (Math.abs(r[0]) * size[0] + Math.abs(r[4]) * size[1] + Math.abs(r[8]) * size[2]) / 2;
      const ez = (Math.abs(r[2]) * size[0] + Math.abs(r[6]) * size[1] + Math.abs(r[10]) * size[2]) / 2;
      if (Math.abs(center.x - point.x) > ex + .15 || Math.abs(center.z - point.z) > ez + .15) continue;
      const ey = (Math.abs(r[1]) * size[0] + Math.abs(r[5]) * size[1] + Math.abs(r[9]) * size[2]) / 2;
      highest = Math.max(highest, center.y + ey);
    }
    return highest;
  }
  nearby(point, radius = 1.3) {
    const ids = new Set();
    for (let x = Math.floor(point.x - radius); x <= Math.floor(point.x + radius); x++) for (let z = Math.floor(point.z - radius); z <= Math.floor(point.z + radius); z++) for (const id of this.spatial.get(`${x},${z}`) ?? []) ids.add(id);
    return ids;
  }
  shape(id) {
    const product = this.products.get(this.view.state.items[id].product);
    if (!this.shapes.has(product.id)) {
      const points = this.hulls[product.id];
      const desc = points?.length ? RAPIER.ColliderDesc.convexHull(new Float32Array(points.flat())) : null;
      this.shapes.set(product.id, (desc ?? RAPIER.ColliderDesc.cuboid(product.size[0]/2,product.size[1]/2,product.size[2]/2)).shape);
    }
    return new RAPIER.ColliderDesc(this.shapes.get(product.id)).setTranslation(0, product.size[1] / 2, 0).setFriction(.7).setRestitution(.06);
  }
  volume(id, pose) {
    const size = this.products.get(this.view.state.items[id].product).size;
    const center = new THREE.Vector3(0,size[1]/2,0).applyQuaternion(pose.q).add(pose.p);
    const r = new THREE.Matrix4().makeRotationFromQuaternion(pose.q).elements;
    const half = new THREE.Vector3(
      (Math.abs(r[0])*size[0]+Math.abs(r[4])*size[1]+Math.abs(r[8])*size[2])/2,
      (Math.abs(r[1])*size[0]+Math.abs(r[5])*size[1]+Math.abs(r[9])*size[2])/2,
      (Math.abs(r[2])*size[0]+Math.abs(r[6])*size[1]+Math.abs(r[10])*size[2])/2);
    return {center,box:new THREE.Box3(center.clone().sub(half),center.clone().add(half)),shape:this.shape(id).shape,q:pose.q};
  }
  dropClear(id, pose) {
    const v = this.volume(id,pose);
    if (v.box.min.y < .01 || v.box.max.y > 4.6 || this.view.layout && !floorClear(pose.p.x,pose.p.z,this.view.layout,.35)) return false;
    for (const solid of this.staticShapes) if (v.box.intersectsBox(solid.box) && v.shape.intersectsShape(v.center,v.q,solid.shape,solid.center,solid.q)) return false;
    for (const other of this.nearby(pose.p,1.5)) {
      if (other === id || this.lifted.has(other)) continue;
      const target = this.volume(other,this.view.poses[other]);
      if (v.box.intersectsBox(target.box) && v.shape.intersectsShape(v.center,v.q,target.shape,target.center,target.q)) return false;
    }
    return true;
  }
  dropPosition(id, eye, direction, yaw) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
    const front = eye.clone().addScaledVector(direction,.6); front.y = Math.max(.5,front.y);
    // Pull the full hull back from a blocked hand position. Test alternatives
    // before removing anything from the bag, so a failed release loses nothing.
    const candidates = Array.from({length:11},(_,i)=>front.clone().lerp(eye,i/10));
    const right = new THREE.Vector3(direction.z,0,-direction.x).normalize();
    candidates.push(eye.clone().add(new THREE.Vector3(0,.5,0)),eye.clone().addScaledVector(right,.6),eye.clone().addScaledVector(right,-.6),eye.clone().addScaledVector(direction,-.6));
    for (const p of candidates) if (this.dropClear(id,{p,q})) return {p,q};
    return null;
  }
  removeSupport(id) { const body = this.supports.get(id); if (body) { this.world.removeRigidBody(body); this.supports.delete(id); } }
  wake(id, velocity = { x: 0, y: 0, z: 0 }) {
    if (this.active.has(id) || this.lifted.has(id) || this.view.state.items[id].location !== 'floor') return;
    // Bound the active set; the player can never create thousands of dynamic bodies.
    if (this.active.size >= 96) this.settle(this.active.keys().next().value);
    this.removeSupport(id);
    const pose = this.view.poses[id];
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(pose.p.x, pose.p.y, pose.p.z).setRotation(pose.q).setLinvel(velocity.x, velocity.y, velocity.z).setLinearDamping(.25).setAngularDamping(.5).setCcdEnabled(true);
    const body = this.world.createRigidBody(desc); this.world.createCollider(this.shape(id), body);
    this.active.set(id, { body, age: 0 }); this.index(id);
  }
  take(id, oldPose) {
    const lifted = this.lifted.get(id);
    this.lifted.delete(id);
    this.removeSupport(id);
    if (this.active.has(id)) { this.world.removeRigidBody(this.active.get(id).body); this.active.delete(id); }
    this.index(id);
    // Removing the bottom of a stack wakes the locally unsupported dolls above it.
    const p = lifted?.p ?? oldPose ?? this.view.poses[id].p;
    const size = this.products.get(this.view.state.items[id].product).size;
    for (const other of this.nearby(p, .75)) {
      if (other === id) continue;
      const q = this.view.poses[other].p;
      if (Math.hypot(q.x - p.x, q.z - p.z) < .55 && q.y > p.y + .05 && q.y < p.y + size[1] + .8) this.wake(other);
    }
  }
  prepareSupports() {
    const wanted = new Set();
    for (const [id] of this.active) {
      const p = this.view.poses[id].p;
      for (const other of this.nearby(p, 1.25)) {
        if (other === id || this.active.has(other) || this.lifted.has(other) || this.view.state.items[other].location !== 'floor') continue;
        const pose = this.view.poses[other]; if (Math.abs(pose.p.y - p.y) > 1.5) continue;
        wanted.add(other);
        if (!this.supports.has(other)) {
          const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pose.p.x, pose.p.y, pose.p.z).setRotation(pose.q));
          this.world.createCollider(this.shape(other), body); this.supports.set(other, body);
        }
      }
    }
    for (const id of this.supports.keys()) if (!wanted.has(id)) this.removeSupport(id);
  }
  settle(id) {
    const record = this.active.get(id); if (!record) return;
    this.sync(id, record.body); this.world.removeRigidBody(record.body); this.active.delete(id); this.index(id);
  }
  setMatchLift(product) {
    for (const [id, original] of this.lifted) {
      const item = this.view.state.items[id];
      if (item.location === 'floor' && item.product === product) continue;
      this.lifted.delete(id);
      if (item.location === 'floor') {
        const pose = this.view.poses[id]; pose.p.copy(original.p); pose.q.copy(original.q);
        this.view.write(id); this.index(id); this.wake(id);
      }
    }
    if (!product) return;
    for (const item of this.view.state.items) {
      if (item.location !== 'floor' || item.product !== product || this.lifted.has(item.id)) continue;
      if (this.active.has(item.id)) this.settle(item.id);
      this.removeSupport(item.id);
      const pose = this.view.poses[item.id];
      this.lifted.set(item.id, { p: pose.p.clone(), q: pose.q.clone() });
      pose.p.y = 2.6; pose.q.identity(); this.view.write(item.id); this.index(item.id);
    }
  }
  savedPoses() {
    const poses = this.view.capturePoses();
    for (const [id, original] of this.lifted) if (this.view.state.items[id].location === 'floor') poses[id] = [...original.p.toArray(), ...original.q.toArray()].map(n => +n.toFixed(5));
    return poses;
  }
  sync(id, body) {
    const p = body.translation(), q = body.rotation(); const pose = this.view.poses[id];
    pose.p.set(p.x, p.y, p.z); pose.q.set(q.x, q.y, q.z, q.w);
    if (pose.p.y < -.08 || pose.p.y > 5 || Math.abs(pose.p.x) > 14.6 || Math.abs(pose.p.z) > 19.5) {
      pose.p.set(2.75, .65, 14.8); pose.q.identity(); body.setTranslation(pose.p, true); body.setRotation(pose.q, true); body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.view.write(id); this.index(id);
  }
  step(dt) {
    if (!this.active.size) { if (this.supports.size) for (const id of this.supports.keys()) this.removeSupport(id); this.accumulator = 0; return; }
    this.accumulator = Math.min(this.accumulator + dt, .1);
    while (this.accumulator >= 1 / 60) {
      this.prepareSupports(); this.world.step(); this.accumulator -= 1 / 60;
      for (const [id, record] of this.active) {
        record.age += 1 / 60; this.sync(id, record.body);
        if (record.body.isSleeping() || record.age > 12) this.settle(id);
      }
    }
  }
  dispose() { this.world.free(); this.active.clear(); this.supports.clear(); this.lifted.clear(); }
}
