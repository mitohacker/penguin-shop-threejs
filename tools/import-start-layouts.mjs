import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { makeLayout } from '../src/core.js';

const catalog = JSON.parse(fs.readFileSync('public/assets/catalog.json'));
const expected = makeLayout(catalog).expected;
const catalogSignature = JSON.stringify(catalog.products.map(p => [p.id, ...p.size]));
const cfg = fs.readFileSync('tools/reference/pour.cfg', 'utf8');
const pour = cfg.split('[pour]')[1]?.split(/\n\[/)[0] ?? '';
const setting = (key, fallback) => Number(pour.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1] ?? fallback);
const config = { batchSize: Math.max(1, Math.floor(setting('batch_size', 200))), batchSeconds: Math.max(0, setting('batch_seconds', 1)), startDegrees: setting('start_degrees', 30), gravity: 9.8, roof: 4.2 };
fs.mkdirSync('public/assets/start-layouts', { recursive: true });
const files = [], hashes = {};
for (let n = 1; n <= 32; n++) {
  const name = String(n).padStart(3, '0'), input = `tools/reference/start-layout-${name}.json`;
  const data = JSON.parse(fs.readFileSync(input));
  if (data.version !== 1 || data.items.length !== 4000) throw new Error(`Incomplete original layout ${name}`);
  const poses = data.items.map((item, id) => {
    if (item.id !== expected[id] || item.pose.length !== 12 || item.pose.some(v => !Number.isFinite(v))) throw new Error(`Catalog/pose mismatch in layout ${name}, item ${id}`);
    const m = new THREE.Matrix4().fromArray([ ...item.pose.slice(0,3),0,...item.pose.slice(3,6),0,...item.pose.slice(6,9),0,...item.pose.slice(9),1 ]);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p,q,s);
    if (Math.max(Math.abs(s.x-1),Math.abs(s.y-1),Math.abs(s.z-1)) > .001) throw new Error('Original pose contains an unexpected model scale.');
    q.normalize(); return [...p.toArray(), ...q.toArray()].map(v => +v.toFixed(6));
  });
  const output = `./assets/start-layouts/slot-${name}.json`;
  fs.writeFileSync(`public/${output.slice(2)}`, JSON.stringify({ catalogSignature, poses }));
  files.push(output); hashes[input] = crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex');
}
hashes['tools/reference/pour.cfg'] = crypto.createHash('sha256').update(cfg).digest('hex');
fs.writeFileSync('public/assets/start-layouts.json', JSON.stringify({ catalogSignature, files, config }));
fs.writeFileSync('tools/reference/copy-hashes.json', JSON.stringify(hashes, null, 2));
console.log(`Imported ${files.length} original settled layouts. Pour: ${config.batchSize} dolls every ${config.batchSeconds}s, ${config.startDegrees}° turn, ${config.gravity}m/s² gravity.`);
