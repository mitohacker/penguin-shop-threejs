import * as THREE from 'three';
import { random } from './core.js';

// The original game animates only the drawn transforms during its opening pour.
// Resting positions remain authoritative for targeting, saves and later physics.
export class DropIntro {
  constructor(poses, items, products, shelfHeight, config, seed) {
    this.elapsed = 0; this.landed = 0; this.finished = false;
    this.entries = new Map(); const productMap = new Map(products.map(p => [p.id, p]));
    const rng = random(seed), top = Math.min(shelfHeight, config.roof);
    const order = items.filter(i => i.location === 'floor').map(i => i.id).sort((a,b) => poses[a].p.y-poses[b].p.y);
    order.forEach((id, index) => {
      const rest = poses[id], height = Math.max(.3, top-rest.p.y), duration = Math.sqrt(2*height/config.gravity);
      const center = new THREE.Vector3(0, productMap.get(items[id].product).size[1]/2, 0);
      this.entries.set(id, {
        rest, center, restCenter: center.clone().applyQuaternion(rest.q).add(rest.p), offset: new THREE.Vector3(), height, duration, landed: false,
        start: Math.floor(index/config.batchSize)*config.batchSeconds + rng()*Math.min(.3, config.batchSeconds*.5),
        from: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),config.startDegrees*Math.PI/180).multiply(rest.q),
        current: {p:new THREE.Vector3(),q:new THREE.Quaternion()}, gravity: config.gravity,
      });
    });
    this.total = this.entries.size;
  }
  pose(id) {
    const e = this.entries.get(id); if (!e) return undefined;
    const t = this.elapsed-e.start;
    if (t < 0) return null;
    if (t >= e.duration) return e.rest;
    const x = Math.min(1, t/e.duration/.85), turn = x*x*x*(x*(x*6-15)+10);
    e.current.q.copy(e.from).slerp(e.rest.q,turn);
    e.current.p.copy(e.restCenter).sub(e.offset.copy(e.center).applyQuaternion(e.current.q));
    e.current.p.y += e.height-.5*e.gravity*t*t;
    return e.current;
  }
  advance(dt) {
    this.elapsed += dt; const changed=[];
    for (const [id,e] of this.entries) {
      if (e.landed || this.elapsed < e.start) continue;
      changed.push(id);
      if (this.elapsed >= e.start+e.duration) { e.landed=true; this.landed++; }
    }
    this.finished = this.landed === this.total;
    return changed;
  }
  get progress() { return this.total ? this.landed/this.total : 1; }
}
