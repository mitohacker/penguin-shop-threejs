import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { walkClear, shelfParts } from './core.js';
import { DropIntro } from './drop-intro.js';

const V = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

export class ShopWorld {
  constructor(canvas, catalog, layout, progress) {
    this.catalog = catalog; this.layout = layout; this.progress = progress;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0xc1dcd6); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.3;
    this.scene = new THREE.Scene(); this.scene.fog = new THREE.Fog(0xc1dcd6, 55, 105);
    this.camera = new THREE.PerspectiveCamera(55, 1, .04, 130);
    this.camera.rotation.order = 'YXZ'; this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xfff4dc, 0x6b9991, 2.7));
    const sun = new THREE.DirectionalLight(0xffebcb, 2.5); sun.position.set(-8, 16, 12); this.scene.add(sun);
    this.mode = 'overview'; this.yaw = 0; this.pitch = -.15; this.zoom = 1;
    this.player = new THREE.Vector3(2.75, 1.75, 14.7);
    this.orbit = new OrbitControls(this.camera, canvas); this.orbit.target.set(0, 0, -1);
    this.orbit.enableDamping = true; this.orbit.dampingFactor = .08;
    this.orbit.minDistance = 9; this.orbit.maxDistance = 70; this.orbit.maxPolarAngle = Math.PI * .46;
    this.orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.orbit.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.camera.position.set(29, 31, 35);
    this.poses = []; this.prototypes = new Map(); this.batches = new Map(); this.references = new Map(); this.levelGroups = new Map(); this.lodElapsed = 0;
    this.dirty = new Set(); this.meshMaterials = []; this.solids = [];
    this.matrix = new THREE.Matrix4(); this.scale = new THREE.Vector3(1, 1, 1);
    this.raycaster = new THREE.Raycaster(); this.hand = null; this.highlighted = new Set();
    this.highlight = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffd778, transparent: true, opacity: .17, depthWrite: false }));
    this.highlight.visible = false; this.scene.add(this.highlight);
    this.rowHighlight = new THREE.Mesh(new THREE.BoxGeometry(2.6, layout.clear, .04), new THREE.MeshBasicMaterial({ color: 0x63dac6, transparent: true, opacity: .25, depthWrite: false }));
    this.rowHighlight.visible = false; this.scene.add(this.rowHighlight);
    this.marker = new THREE.Mesh(new THREE.TorusGeometry(.4, .055, 6, 28), new THREE.MeshBasicMaterial({ color: 0xffd36b }));
    this.marker.rotation.x = Math.PI / 2; this.marker.visible = false; this.scene.add(this.marker);
    this.rowGhosts = []; this.ghostKey = ''; this.ghostMaterial = new THREE.MeshBasicMaterial({ color: 0x64daca, transparent: true, opacity: .22, depthWrite: false });
    this.buildShop(); this.resize();
  }
  box(size, pos, color, solid = false) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshLambertMaterial({ color }));
    m.position.set(...pos); this.scene.add(m);
    if (solid) this.solids.push(new THREE.Box3().setFromObject(m));
    return m;
  }
  buildShop() {
    this.box([30, .3, 40], [0, -.15, 0], 0xe5dcc7, true);
    // Grid grout is a single line draw, not thousands of floor meshes.
    const grid = new THREE.GridHelper(40, 40, 0xc6bcaa, 0xc6bcaa); grid.position.y = .006; grid.scale.x = .75; this.scene.add(grid);
    this.box([30, 4.6, .25], [0, 2.3, -20], 0xf4ecd9, true);
    for (const side of [-1, 1]) {
      this.box([.25, 4.6, 40], [side * 15, 2.3, 0], 0xf4ecd9, true);
      this.box([.08, 1.25, 40], [side * 14.85, .625, 0], 0x236766);
      this.box([.12, .1, 40], [side * 14.78, 1.28, 0], 0xc99459);
    }
    this.box([30, 1.25, .08], [0, .625, -19.85], 0x236766);
    this.box([30, .1, .12], [0, 1.28, -19.78], 0xc99459);
    this.box([30, .3, .3], [0, 4.6, -19.75], 0xad7f50);
    const wood = new THREE.MeshLambertMaterial({ color: 0xb38350 });
    const geometries = [];
    const addShelfPart = (shelf, size, local, solid = true) => {
      const g = new THREE.BoxGeometry(...size);
      const mat = new THREE.Matrix4().compose(new THREE.Vector3(shelf.x, 0, shelf.z), new THREE.Quaternion().setFromAxisAngle(UP, shelf.yaw), new THREE.Vector3(1, 1, 1));
      const world = new THREE.Vector3(...local).applyMatrix4(mat);
      g.translate(...local); g.applyMatrix4(mat); geometries.push(g);
      if (solid) {
        const half = new THREE.Vector3(size[2], size[1], size[0]).multiplyScalar(.5);
        this.solids.push(new THREE.Box3(world.clone().sub(half), world.clone().add(half)));
      }
    };
    const signGeometries = [];
    for (const shelf of this.layout.shelves) {
      for (const part of shelfParts(shelf, this.layout)) addShelfPart(shelf, part.size, part.position);
    }
    const merged = mergeGeometries(geometries); geometries.forEach(g => g.dispose());
    this.scene.add(new THREE.Mesh(merged, wood));
    for (const x of [-9, -3, 3, 9]) this.box([3.5, .88, 1.45], [x, .44, 17.2], 0x236766, true);
    for (const x of [-9, -3, 3, 9]) this.box([3.7, .09, 1.65], [x, .925, 17.2], 0xc99459);
    // A single atlas supplies readable department placards.
    const signCanvas = document.createElement('canvas'); signCanvas.width = 1024; signCanvas.height = 1024;
    const ctx = signCanvas.getContext('2d'); ctx.fillStyle = '#164d4c'; ctx.fillRect(0, 0, 1024, 1024);
    ctx.fillStyle = '#fff2d5'; ctx.textAlign = 'center'; ctx.font = 'bold 28px Georgia';
    this.catalog.sheets.forEach((sheet, i) => {
      const title = sheet.title.replace(/ Penguins?/i, '').toUpperCase();
      ctx.fillText(title, 512, i * 96 + 58, 980);
    });
    const atlas = new THREE.CanvasTexture(signCanvas); atlas.colorSpace = THREE.SRGBColorSpace;
    for (const shelf of this.layout.shelves) {
      const i = this.catalog.sheets.findIndex(s => s.id === shelf.sheet);
      const g = new THREE.PlaneGeometry(2.45, .23);
      const uv = g.attributes.uv;
      for (let n = 0; n < uv.count; n++) uv.setY(n, 1 - ((i * 96 + (1 - uv.getY(n)) * 96) / 1024));
      const signZ = shelf.depth * .5 - .04;
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(shelf.x + Math.sin(shelf.yaw) * signZ, shelf.height + .2, shelf.z + Math.cos(shelf.yaw) * signZ), new THREE.Quaternion().setFromAxisAngle(UP, shelf.yaw), new THREE.Vector3(1, 1, 1))); signGeometries.push(g);
    }
    this.scene.add(new THREE.Mesh(mergeGeometries(signGeometries), new THREE.MeshBasicMaterial({ map: atlas }))); signGeometries.forEach(g => g.dispose());
    const textCanvas = document.createElement('canvas'); textCanvas.width = 1024; textCanvas.height = 180;
    const c = textCanvas.getContext('2d'); c.fillStyle = '#164d4c'; c.fillRect(0, 0, 1024, 180);
    c.fillStyle = '#ffe7ba'; c.font = 'bold 62px Georgia'; c.textAlign = 'center'; c.fillText('PENGUIN SHOP', 512, 82);
    c.font = '24px sans-serif'; c.fillText('A home for every little penguin', 512, 134);
    const tex = new THREE.CanvasTexture(textCanvas); tex.colorSpace = THREE.SRGBColorSpace;
    const shopSign = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 1.44), new THREE.MeshBasicMaterial({ map: tex })); shopSign.position.set(0, 3.5, -19.8); this.scene.add(shopSign);
    this.rowCards = new Map();
  }
  async load(lods) {
    const manager = new THREE.LoadingManager(); THREE.Cache.enabled = true;
    const textures = new Map();
    class SharedTextureLoader extends THREE.TextureLoader {
      load(url, onLoad, onProgress, onError) {
        if (textures.has(url)) { const t = textures.get(url); t.promise.then(() => onLoad?.(t.texture), onError); return t.texture; }
        let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
        promise.catch(() => {});
        const texture = super.load(url, tex => { resolve(tex); onLoad?.(tex); }, onProgress, e => { reject(e); onError?.(e); });
        textures.set(url, { texture, promise }); return texture;
      }
    }
    manager.addHandler(/\.(png|jpe?g)(\?.*)?$/i, new SharedTextureLoader(manager));
    const loader = new GLTFLoader(manager);
    let index = 0, completed = 0;
    const worker = async () => {
      while (index < this.catalog.products.length) {
        const product = this.catalog.products[index++];
        const gltf = await loader.loadAsync(product.model); gltf.scene.updateMatrixWorld(true);
        const parts = []; const scale = new THREE.Matrix4().makeScale(2, 2, 2);
        gltf.scene.traverse(node => {
          if (!node.isMesh) return;
          const geo = node.geometry.clone(); geo.applyMatrix4(node.matrixWorld); geo.applyMatrix4(scale); geo.computeBoundingBox();
          const convert = source => {
            const mat = new THREE.MeshLambertMaterial({ color: source.color, map: source.map, side: THREE.FrontSide, transparent: source.transparent, opacity: source.opacity, alphaTest: source.alphaTest });
            this.meshMaterials.push(mat); return mat;
          };
          const materials = Array.isArray(node.material) ? node.material.map(convert) : convert(node.material);
          parts.push({ geo, materials });
        });
        if (gltf.parser.json.materials?.some(m => m.pbrMetallicRoughness?.baseColorTexture) && parts.every(p => !(Array.isArray(p.materials) ? p.materials : [p.materials]).some(m => m.map))) throw new Error(`Could not load the texture for ${product.name}.`);
        const bounds = new THREE.Box3(); parts.forEach(part => bounds.union(part.geo.boundingBox));
        const center = bounds.getCenter(V()); parts.forEach((part, index) => {
          part.geo.translate(-center.x, -bounds.min.y, -center.z); part.geo.computeBoundingBox(); part.geo.computeBoundingSphere();
          part.lowGeo = part.geo.clone(); if (lods[product.id]?.[index]) part.lowGeo.setIndex(lods[product.id][index]);
        });
        this.prototypes.set(product.id, parts);
        this.progress(++completed / this.catalog.products.length, product.name);
      }
    };
    await Promise.all(Array.from({ length: 5 }, worker));
    this.textures = textures;
    await this.loadRowAtlas();
    // Decorative props are optional to gameplay but part of the complete room.
    const places = { a02: [[-11, 0, -16.38], [-5.5, 0, -16.38], [0, 0, -16.38], [5.5, 0, -16.38], [11, 0, -16.38]], a03: [[-8.25, 3.65, -10], [-2.75, 3.65, -10], [2.75, 3.65, -10], [8.25, 3.65, -10]], a04: [[-14.735, 2.8, -8], [14.735, 2.8, -8]], b02: [[-14.8, .86, -6], [14.8, .86, -6]], b03: [[-14.53, 3.83, -10], [14.53, 3.83, -10]], b04: [[0, 2.2, -19.65]], c01: [[-9.45, .97, 17.45], [2.55, .97, 17.45]], c02: [[-8.25, .97, 17.55], [3.75, .97, 17.55]], c03: [[-10.2, .97, 17.2], [1.8, .97, 17.2]], c04: [[-8.7, .97, 17.2], [3.3, .97, 17.2]] };
    const props = await Promise.all(Object.entries(places).map(async ([id, poses]) => {
      const gltf = await loader.loadAsync(`./assets/environment/${id}.glb`);
      return { id, poses, root: gltf.scene };
    }));
    for (const { id, poses, root } of props) for (const p of poses) { const instance = root.clone(); instance.position.set(...p); if (['a04', 'b02', 'b03'].includes(id) && p[0] > 0) instance.rotation.y = Math.PI; this.scene.add(instance); }
  }
  start(state, savedPoses = null) {
    if (!savedPoses || savedPoses.length !== state.items.length) throw new Error('The complete starting floor layout is required.');
    this.intro = null;
    this.clearRowGhosts();
    this.state = state;
    for (const batches of this.batches.values()) for (const b of batches) { this.scene.remove(b); b.dispose(); }
    this.batches.clear(); this.references.clear(); this.levelGroups.clear(); this.dirty.clear(); this.setHand(-1); this.clearGlow();
    const ids = new Map(); state.items.forEach(item => { if (!ids.has(item.product)) ids.set(item.product, []); ids.get(item.product).push(item.id); });
    for (const [product, itemIds] of ids) {
      const create = (part, low) => {
        const mesh = new THREE.InstancedMesh(low ? part.lowGeo : part.geo, part.materials, itemIds.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.userData.ids = itemIds;
        mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 30);
        this.scene.add(mesh); return mesh;
      };
      const high = this.prototypes.get(product).map(p => create(p, false)), low = this.prototypes.get(product).map(p => create(p, true));
      this.levelGroups.set(product, { high, low, ids: itemIds });
      this.batches.set(product, [...high, ...low]); itemIds.forEach((id, n) => this.references.set(id, { meshes: high, n }));
    }
    this.poses = Array(4000);
    state.items.forEach(({id}) => {
      const v = savedPoses[id]; this.poses[id] = {p:new THREE.Vector3(...v.slice(0,3)),q:new THREE.Quaternion(...v.slice(3,7))};
      if (state.items[id].location === 'shelf') this.toSlot(id, state.items[id].slot);
      this.write(id);
    });
    this.rebuildLOD(); this.flush(); this.updateRowCards(); this.setHand(state.held);
  }
  updateLOD(dt) { this.lodElapsed += dt; if (this.lodElapsed > .5) { this.lodElapsed = 0; this.rebuildLOD(); } }
  rebuildLOD() {
    for (const { high, low, ids } of this.levelGroups.values()) {
      let hi = 0, lo = 0;
      for (const id of ids) {
        const near = this.mode === 'walk' && this.poses[id].p.distanceToSquared(this.camera.position) < 64;
        const ref = { meshes: near ? high : low, n: near ? hi++ : lo++ }; this.references.set(id, ref); this.write(id);
        for (const mesh of ref.meshes) if (mesh.instanceColor) { mesh.setColorAt(ref.n, this.highlighted.has(id) ? new THREE.Color(1.8, 1.45, .45) : new THREE.Color(1, 1, 1)); mesh.instanceColor.needsUpdate = true; }
      }
      high.forEach(mesh => mesh.count = hi); low.forEach(mesh => mesh.count = lo);
    }
  }
  toSlot(id, slot) { const target = this.layout.slots[slot]; this.poses[id].p.set(...target.position); this.poses[id].q.setFromAxisAngle(UP, target.yaw); }
  write(id) {
    const ref = this.references.get(id); if (!ref) return;
    const drawn = this.intro?.pose(id), pose = drawn === undefined ? this.poses[id] : drawn;
    const mat = !pose || this.state.items[id].location === 'bag' ? hiddenMatrix : this.matrix.compose(pose.p, pose.q, this.scale);
    for (const mesh of ref.meshes) { mesh.setMatrixAt(ref.n, mat); this.dirty.add(mesh); }
  }
  flush() { for (const mesh of this.dirty) mesh.instanceMatrix.needsUpdate = true; this.dirty.clear(); }
  startDropIntro(config) {
    this.intro = new DropIntro(this.poses,this.state.items,this.catalog.products,this.layout.height,config,this.state.seed);
    for (const item of this.state.items) this.write(item.id);
  }
  stepDropIntro(dt) {
    const intro = this.intro;
    if (!intro) return {finished:true,progress:1,landed:4000};
    for (const id of intro.advance(dt)) this.write(id);
    const result = {finished:intro.finished,progress:intro.progress,landed:intro.landed};
    if (intro.finished) { this.intro = null; this.lastPour = { landed: intro.landed, elapsed: intro.elapsed }; }
    return result;
  }
  setHand(id) {
    if (this.hand) { this.camera.remove(this.hand); this.hand = null; }
    if (id < 0) return;
    this.hand = new THREE.Group();
    for (const part of this.prototypes.get(this.state.items[id].product)) this.hand.add(new THREE.Mesh(part.geo, part.materials));
    this.hand.position.set(.3, -.32, -.82); this.hand.scale.setScalar(.68); this.hand.visible = this.mode === 'walk'; this.camera.add(this.hand);
  }
  setMode(mode, standOnPile = true) {
    this.mode = mode; this.orbit.enabled = mode === 'overview';
    if (mode === 'overview') { this.camera.position.set(29, 31, 35); this.orbit.target.set(0, 0, -1); this.camera.lookAt(this.orbit.target); }
    else { if (standOnPile) this.player.y = Math.min(4.25, 1.75 + (this.floorHeight?.(this.player) ?? 0)); this.camera.position.copy(this.player); this.camera.rotation.set(this.pitch, this.yaw, 0); }
    if (this.hand) this.hand.visible = mode === 'walk';
    if (this.poses.length) this.rebuildLOD();
  }
  async loadRowAtlas() {
    const atlas = document.createElement('canvas'); atlas.width = 2048; atlas.height = 1280;
    const ctx = atlas.getContext('2d'); ctx.fillStyle = '#fff7e7'; ctx.fillRect(0, 0, atlas.width, atlas.height);
    await Promise.all(this.catalog.products.map(async (p, index) => {
      const img = new Image(); img.src = p.thumbnail; await img.decode();
      ctx.drawImage(img, index % 16 * 128 + 4, Math.floor(index / 16) * 128 + 4, 120, 120);
    }));
    const texture = new THREE.CanvasTexture(atlas); texture.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(.32, .32);
    this.cardOffsets = new THREE.InstancedBufferAttribute(new Float32Array(400 * 2), 2); geo.setAttribute('cardOffset', this.cardOffsets);
    const material = new THREE.MeshBasicMaterial({ map: texture });
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute vec2 cardOffset;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n vMapUv = vMapUv * vec2(120.0 / 2048.0, 120.0 / 1280.0) + cardOffset;');
    };
    material.customProgramCacheKey = () => 'penguin-row-atlas-v1';
    this.rowCardMesh = new THREE.InstancedMesh(geo, material, 400); this.rowCardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(this.rowCardMesh);
    // Same four-ring bevel as the original thumbnail_frame_mesh(), shared by all rows.
    const positions = [], colors = [], sizes = [.181, .177, .163, .158], depths = [.001, .007, .007, .002];
    const shades = ['#251b16', '#765036', '#533723', '#211915'].map(c => new THREE.Color(c));
    const corners = [[-1,-1],[1,-1],[1,1],[-1,1]];
    for (let ring = 0; ring < 3; ring++) for (let side = 0; side < 4; side++) {
      const next = (side + 1) % 4;
      for (const [r,c] of [[ring,side],[ring,next],[ring+1,next],[ring,side],[ring+1,next],[ring+1,side]]) {
        positions.push(corners[c][0]*sizes[r], corners[c][1]*sizes[r], depths[r]); colors.push(...shades[r].toArray());
      }
    }
    const frame = new THREE.BufferGeometry(); frame.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); frame.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    this.cardFrameMesh = new THREE.InstancedMesh(frame,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}),400);
    this.cardFrameMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(this.cardFrameMesh);
  }
  updateRowCards() {
    for (const row of this.layout.rows) {
      const product = this.state.rowProduct(row.id);
      const pose = new THREE.Matrix4().compose(new THREE.Vector3(...row.card), new THREE.Quaternion().setFromAxisAngle(UP, row.yaw), new THREE.Vector3(1, 1, 1));
      this.rowCardMesh.setMatrixAt(row.id, product ? pose : hiddenMatrix);
      this.cardFrameMesh.setMatrixAt(row.id, product ? pose : hiddenMatrix);
      if (product) { const index = this.catalog.products.findIndex(p => p.id === product); this.cardOffsets.setXY(row.id, (index % 16 * 128 + 4) / 2048, 1 - (Math.floor(index / 16) * 128 + 124) / 1280); }
    }
    this.rowCardMesh.instanceMatrix.needsUpdate = true; this.cardOffsets.needsUpdate = true; this.rowCardMesh.computeBoundingSphere();
    this.cardFrameMesh.instanceMatrix.needsUpdate = true; this.cardFrameMesh.computeBoundingSphere();
  }
  pickRay(ndc, reach = 100) {
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera); const ray = this.raycaster.ray;
    let nearest = reach, itemId = -1, rowId = -1;
    const hit = V();
    // Physical shelf boards and walls occlude input; the floor is excluded because
    // its surface is exactly underneath the dolls.
    for (const box of this.solids.slice(1)) if (ray.intersectBox(box, hit)) nearest = Math.min(nearest, hit.distanceTo(ray.origin) + .025);
    for (const row of this.layout.rows) {
      const normal = new THREE.Vector3(Math.sin(row.yaw), 0, Math.cos(row.yaw));
      if (ray.direction.dot(normal) >= 0) continue;
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(...row.center));
      if (!ray.intersectPlane(plane, hit)) continue;
      const distance = ray.origin.distanceTo(hit); if (distance > nearest) continue;
      const delta = hit.clone().sub(new THREE.Vector3(...row.center));
      const localX = delta.x * Math.cos(row.yaw) - delta.z * Math.sin(row.yaw);
      if (Math.abs(localX) < 1.24 && Math.abs(delta.y) < row.clear / 2) { nearest = distance; rowId = row.id; }
    }
    // Box intersections are exact in each doll's local frame, without testing
    // thousands of mesh triangles. A radius rejection keeps distant items cheap.
    const localRay = new THREE.Ray(), inverse = new THREE.Matrix4(), matrix = new THREE.Matrix4();
    const productMap = this.productMap ??= new Map(this.catalog.products.map(p => [p.id, p]));
    for (const item of this.state.items) {
      if (item.location === 'bag') continue;
      const pose = this.poses[item.id], size = productMap.get(item.product).size;
      const center = new THREE.Vector3(0, size[1] / 2, 0).applyQuaternion(pose.q).add(pose.p);
      if (ray.distanceSqToPoint(center) > (Math.hypot(...size) / 2 + .04) ** 2) continue;
      matrix.compose(pose.p, pose.q, this.scale); inverse.copy(matrix).invert(); localRay.copy(ray).applyMatrix4(inverse);
      const box = new THREE.Box3(new THREE.Vector3(-size[0] / 2 - .015, -.015, -size[2] / 2 - .015), new THREE.Vector3(size[0] / 2 + .015, size[1] + .015, size[2] / 2 + .015));
      if (localRay.intersectBox(box, hit)) {
        hit.applyMatrix4(matrix); const distance = hit.distanceTo(ray.origin);
        if (distance < nearest) { nearest = distance; itemId = item.id; rowId = -1; }
      }
    }
    return { item: itemId, row: rowId, distance: nearest };
  }
  showAim(target) {
    const previewRow = target.row >= 0 ? target.row : target.item >= 0 && this.state.held >= 0 && this.state.items[target.item].location === 'shelf' ? Math.floor(this.state.items[target.item].slot / 10) : -1;
    this.showRowGhosts(previewRow);
    this.highlight.visible = target.item >= 0; this.rowHighlight.visible = target.row >= 0;
    if (target.item >= 0) {
      const pose = this.poses[target.item], item = this.state.items[target.item]; const size = this.productMap.get(item.product).size;
      this.highlight.position.set(0, size[1] / 2, 0).applyQuaternion(pose.q).add(pose.p); this.highlight.quaternion.copy(pose.q); this.highlight.scale.set(...size).multiplyScalar(1.08);
    }
    if (target.row >= 0) { const row = this.layout.rows[target.row]; this.rowHighlight.position.set(...row.center); this.rowHighlight.rotation.y = row.yaw; }
  }
  clearRowGhosts() {
    for (const mesh of this.rowGhosts) { this.scene.remove(mesh); mesh.dispose(); }
    this.rowGhosts = []; this.ghostKey = '';
  }
  showRowGhosts(row) {
    if (row < 0) { if (this.rowGhosts.length) this.clearRowGhosts(); return; }
    let product = this.state.rowProduct(row);
    if (!product && this.state.held >= 0) {
      const held = this.state.items[this.state.held].product;
      if (this.state.accepts(row, held)) product = held;
    }
    const empty = Array.from({ length: 10 }, (_, n) => row * 10 + n).filter(slot => this.state.slots[slot] < 0);
    const key = `${row}:${product}:${empty.join(',')}`;
    if (this.ghostKey === key) return;
    this.clearRowGhosts(); this.ghostKey = key;
    if (!product || !empty.length) return;
    for (const part of this.prototypes.get(product)) {
      const mesh = new THREE.InstancedMesh(part.geo, this.ghostMaterial, empty.length);
      empty.forEach((slot, n) => { const p = this.layout.slots[slot]; this.matrix.compose(new THREE.Vector3(...p.position), new THREE.Quaternion().setFromAxisAngle(UP, p.yaw), this.scale); mesh.setMatrixAt(n, this.matrix); });
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); this.scene.add(mesh); this.rowGhosts.push(mesh);
    }
  }
  glow(product) {
    this.clearGlow();
    if (!product) return;
    for (const item of this.state.items) if (item.product === product && item.location === 'floor') {
      const ref = this.references.get(item.id); for (const mesh of ref.meshes) { mesh.setColorAt(ref.n, new THREE.Color(1.8, 1.45, .45)); mesh.instanceColor.needsUpdate = true; } this.highlighted.add(item.id);
    }
  }
  clearGlow() {
    for (const id of this.highlighted) {
      const ref = this.references.get(id); if (ref) for (const mesh of ref.meshes) if (mesh.instanceColor) { mesh.setColorAt(ref.n, new THREE.Color(1, 1, 1)); mesh.instanceColor.needsUpdate = true; }
    }
    this.highlighted.clear();
  }
  guide() {
    this.marker.visible = false;
    if (this.state.held < 0 || this.state.timers.guide.active <= 0) return null;
    const product = this.state.items[this.state.held].product;
    let selected = null, closest = Infinity;
    for (const row of this.layout.rows) if (this.state.accepts(row.id, product) && this.state.slots.slice(row.id * 10, row.id * 10 + 10).includes(-1)) {
      const point = new THREE.Vector3(...row.center), distance = point.distanceToSquared(this.camera.position) + (!this.state.rowProduct(row.id) ? 500 : 0);
      if (distance < closest) { closest = distance; selected = point; }
    }
    if (selected) { this.marker.visible = true; this.marker.position.copy(selected); this.marker.rotation.set(0, 0, 0); }
    return selected;
  }
  move(dt, keys, touch, sprint) {
    if (this.mode !== 'walk') { this.orbit.update(); return; }
    const forward = +(keys.has('KeyW') || keys.has('ArrowUp')) - +(keys.has('KeyS') || keys.has('ArrowDown')) - touch.y;
    const strafe = +(keys.has('KeyD') || keys.has('ArrowRight')) - +(keys.has('KeyA') || keys.has('ArrowLeft')) + touch.x;
    const vector = new THREE.Vector3(strafe, 0, -forward); if (vector.lengthSq() > 1) vector.normalize();
    vector.applyAxisAngle(UP, this.yaw).multiplyScalar(dt * 4 * sprint);
    const canMove = (x, z) => walkClear(x, z, this.layout);
    if (canMove(this.player.x + vector.x, this.player.z)) this.player.x += vector.x;
    if (canMove(this.player.x, this.player.z + vector.z)) this.player.z += vector.z;
    const eyeHeight = Math.min(4.25, 1.75 + (this.floorHeight?.(this.player) ?? 0));
    this.player.y += THREE.MathUtils.clamp(eyeHeight - this.player.y, -6 * dt, 4 * dt);
    this.camera.position.copy(this.player); this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
  quality(level) {
    this.qualityLevel = level;
    const dpr = level === 'low' ? 1 : Math.min(window.devicePixelRatio, level === 'high' ? 2 : 1.35);
    this.renderer.setPixelRatio(dpr); this.resize();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  render() { this.flush(); this.renderer.render(this.scene, this.camera); }
  capturePoses() { return this.poses.map(v => [...v.p.toArray(), ...v.q.toArray()].map(n => +n.toFixed(5))); }
  captureCamera() { return { mode: this.mode, position: this.player.toArray(), yaw: this.yaw, pitch: this.pitch, zoom: this.zoom }; }
  restoreCamera(v) { this.player.set(...v.position); if (!walkClear(this.player.x, this.player.z, this.layout)) this.player.set(2.75, 1.75, 14.5); this.yaw = v.yaw; this.pitch = Math.max(-1.45, Math.min(1.45, v.pitch)); this.zoom = v.zoom; this.setMode(v.mode); }
}
