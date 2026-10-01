// Generate independent LOD index buffers. Original positions, UVs, normals,
// materials and the entire source project are untouched.
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';
await MeshoptSimplifier.ready;
const catalog = JSON.parse(fs.readFileSync('public/assets/catalog.json'));
const lods = {}, report = [];
let before = 0, after = 0;
for (const product of catalog.products) {
  const filename = path.resolve('public', product.model), gltf = JSON.parse(fs.readFileSync(filename));
  const buffers = gltf.buffers.map(b => fs.readFileSync(path.resolve(path.dirname(filename), decodeURIComponent(b.uri))));
  const read = index => {
    const accessor = gltf.accessors[index], view = gltf.bufferViews[accessor.bufferView];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
    const bytes = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[accessor.componentType];
    if (!width || !bytes || accessor.normalized || accessor.sparse) throw new Error('Unsupported LOD accessor.');
    const array = accessor.componentType === 5126 ? new Float32Array(accessor.count * width) : new Uint32Array(accessor.count * width);
    const data = buffers[view.buffer], base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), stride = view.byteStride ?? width * bytes;
    for (let i = 0; i < accessor.count; i++) for (let k = 0; k < width; k++) {
      const at = base + i * stride + k * bytes;
      array[i * width + k] = accessor.componentType === 5126 ? data.readFloatLE(at) : bytes === 4 ? data.readUInt32LE(at) : bytes === 2 ? data.readUInt16LE(at) : data.readUInt8(at);
    }
    return array;
  };
  const parts = [];
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    const positions = read(primitive.attributes.POSITION), count = positions.length / 3;
    const indices = primitive.indices === undefined ? Uint32Array.from({ length: count }, (_, i) => i) : read(primitive.indices);
    const normals = primitive.attributes.NORMAL === undefined ? null : read(primitive.attributes.NORMAL);
    const uv = primitive.attributes.TEXCOORD_0 === undefined ? null : read(primitive.attributes.TEXCOORD_0);
    const stride = (normals ? 3 : 0) + (uv ? 2 : 0), attrs = new Float32Array(count * stride);
    for (let i = 0; i < count; i++) { if (normals) attrs.set(normals.subarray(i * 3, i * 3 + 3), i * stride); if (uv) attrs.set(uv.subarray(i * 2, i * 2 + 2), i * stride + (normals ? 3 : 0)); }
    const target = Math.max(600, Math.floor(indices.length * .38 / 3) * 3);
    const [simplified, error] = stride ? MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attrs, stride, [...(normals ? [.05, .05, .05] : []), ...(uv ? [.3, .3] : [])], null, target, .02) : MeshoptSimplifier.simplify(indices, positions, 3, target, .02);
    parts.push([...simplified]); before += indices.length / 3; after += simplified.length / 3;
    report.push({ product: product.id, originalTriangles: indices.length / 3, distantTriangles: simplified.length / 3, relativeError: +error.toFixed(5) });
  }
  lods[product.id] = parts;
}
fs.writeFileSync('public/assets/lod.json', JSON.stringify(lods));
fs.writeFileSync('tools/mesh-optimization.json', JSON.stringify({ originalTriangles: before, distantTriangles: after, reductionPercent: +(100 * (1 - after / before)).toFixed(1), parts: report }, null, 2));
console.log(`Distant geometry: ${before.toLocaleString()} → ${after.toLocaleString()} triangles (${(100 * (1 - after / before)).toFixed(1)}% less).`);
