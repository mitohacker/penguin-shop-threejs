// Capture the original shelf rules from independent, byte-preserved GDScript copies.
// This fixture is a regression oracle, not an input to the runtime layout code.
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';

const folder = 'tools/reference/shelf-source/';
const store = fs.readFileSync(folder+'store.gd','utf8');
const shelf = fs.readFileSync(folder+'penguin_shelf_layout.gd','utf8').replace(/\r/g,'');
const penguin = fs.readFileSync(folder+'penguin_store.gd','utf8');
const number = name => {
  const match = shelf.match(new RegExp(`^const ${name} := ([\\d.]+)$`,'m'));
  if (!match) throw new Error(`Missing original shelf constant ${name}`);
  return Number(match[1]);
};
const zRule = store.match(/var z := (-[\d.]+) \+ bay \* ([\d.]+) \+ \(([\d.]+) if bay >= (\d+) else ([\d.]+)\)/);
const xRule = store.match(/\(bank - (\d+)\) \* ([\d.]+)/);
if (!zRule || !xRule || !penguin.includes('shelf_layout.depth * 0.5 + 0.01')) throw new Error('Original shelf placement rules changed; inspect them before capturing.');
const catalog = JSON.parse(fs.readFileSync('public/assets/catalog.json'));
const maxSize = [0,0,0];
for (const p of catalog.products) p.size.forEach((v,i) => maxSize[i] = Math.max(maxSize[i],v));
const clear = maxSize[1]+number('HEADROOM');
const width = number('WIDTH'), sideWidth = number('SIDE'), back = number('BACK'), plank = number('PLANK'), base = number('BASE');
const depth = Math.max(number('MIN_DEPTH'),maxSize[2]*2+number('LINE_GAP')+back);
const height = base+number('ROWS')*(clear+plank);
const rows = [], shelves = [], slots = [];
const parts = [{size:[width,base,depth],position:[0,base/2,0]}];
for (let r=1;r<number('ROWS');r++) parts.push({size:[width-sideWidth*2,plank,depth],position:[0,base+r*(clear+plank)-plank/2,0]});
parts.push({size:[width,plank,depth],position:[0,height-plank/2,0]}, {size:[width,height,back],position:[0,height/2,-depth/2+back/2]});
for (const s of [-1,1]) parts.push({size:[sideWidth,height,depth],position:[s*(width-sideWidth)/2,height/2,0]});
for (let bank=0;bank<5;bank++) for (let bay=0;bay<10;bay++) for (let side=0;side<2;side++) {
  const yaw = side===0 ? -Math.PI/2 : Math.PI/2;
  const origin = new THREE.Vector3((bank-Number(xRule[1]))*Number(xRule[2])+(side===0?-1:1)*(depth/2+.01),0,Number(zRule[1])+bay*Number(zRule[2])+(bay>=Number(zRule[4])?Number(zRule[3]):Number(zRule[5])));
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
  const transform = local => new THREE.Vector3(...local).applyQuaternion(q).add(origin).toArray();
  shelves.push({position:origin.toArray(),yaw});
  for (let row=0;row<number('ROWS');row++) {
    const top = base+row*(clear+plank);
    rows.push({card:transform([0,top+clear-.2,-depth/2+back+.01])});
    for (let slot=0;slot<10;slot++) {
      const innerWidth = width-sideWidth*2, pitch = innerWidth/number('PER_LINE');
      slots.push(transform([-innerWidth/2+pitch*(slot%5+.5),top,-depth/2+back+(depth-back)*(slot<5?.25:.75)]));
    }
  }
}
const sourceHashes = {};
for (const name of ['store.gd','penguin_shelf_layout.gd','penguin_store.gd']) sourceHashes[name] = crypto.createHash('sha256').update(fs.readFileSync(folder+name)).digest('hex');
const result = {sourceHashes,maxSize,width,depth,height,clear,parts,shelves,rows,slots};
fs.writeFileSync('tools/reference/shelf-layout.json',JSON.stringify(result));
console.log(`Captured ${shelves.length} original shelves, ${rows.length} row cards and ${slots.length} slot positions.`);
