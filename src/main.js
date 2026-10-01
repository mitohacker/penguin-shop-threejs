import './style.css';
import * as THREE from 'three';
import { GameState, makeLayout, validateSave, UPGRADE_NAMES } from './core.js';
import { ShopWorld } from './world.js';
import { PenguinPhysics, initPhysics } from './physics.js';
import { Platform, Sound } from './platform.js';
import { UI } from './ui.js';

const canvas = document.getElementById('game');
const platform = new Platform(), sound = new Sound();
const ui = new UI(document.getElementById('ui'), action);
const keys = new Set(), mouse = new THREE.Vector2(.9, .9), touch = { x: 0, y: 0 };
let catalog, layout, hulls, lods, startInfo, view, state, physics, saved = null, active = false, returnScreen = 'title', starting = false;
let aim = { item: -1, row: -1 }, aimTimer = 0, hudTimer = 0, autosave = 0, lastTime = 0, fpsFrames = 0, fpsTime = 0, fps = 0;
let releasingLock = false, winShown = false, debug = false, lastGlow = null;
let mouseCaptureUnavailable = false;
const touchDevice = matchMedia('(pointer: coarse)').matches;
const settings = { quality: touchDevice ? 'low' : 'balanced', sound: true, music: false, sensitivity: 2.5 };
try { const existing = JSON.parse(localStorage.getItem('penguin-threejs-settings-v1')); if (existing) for (const key of Object.keys(settings)) { if (key === 'quality' && ['low', 'balanced', 'high'].includes(existing[key]) || ['sound', 'music'].includes(key) && typeof existing[key] === 'boolean' || key === 'sensitivity' && Number.isFinite(existing[key]) && existing[key] >= 1 && existing[key] <= 8) settings[key] = existing[key]; } } catch { /* Default settings remain usable when storage is unavailable. */ }

function data() { return { state, settings, mode: view?.mode, touch: touchDevice, active, crazygames: platform.crazygames, saved: !!saved, sorted: active ? state.sorted : saved?.sorted ?? 0, elapsed: state?.elapsed ?? 0, coins: state?.coins ?? 0 }; }
function releaseMouse() { if (document.pointerLockElement) { releasingLock = true; document.exitPointerLock(); } }
function screen(name) {
  if (name !== 'play') { keys.clear(); touch.x = touch.y = 0; releaseMouse(); platform.stop(); }
  else platform.start();
  ui.show(name, data());
}
function overlay(name) { returnScreen = active ? 'pause' : 'title'; if (ui.screen === 'title') returnScreen = 'title'; screen(name); }
function applySettings() {
  view?.quality(settings.quality); sound.enabled = settings.sound; sound.music = settings.music;
  try { localStorage.setItem('penguin-threejs-settings-v1', JSON.stringify(settings)); } catch { /* Gameplay still works. */ }
}
function save(notify = false, keepBackup = true) {
  if (!active) return false;
  try {
    const snapshot = state.save(physics.savedPoses(), view.captureCamera());
    platform.save(snapshot, keepBackup);
    saved = { data: snapshot, sorted: state.sorted };
    if (notify) ui.toast('Your store is saved.'); return true;
  } catch (error) { ui.toast(`Progress could not save: ${error.message}`); return false; }
}
async function getAsset(path) { const r = await fetch(path); if (!r.ok) throw new Error(`Missing game asset: ${path}`); return r.json(); }
async function startPoses(next) {
  const source = await getAsset(startInfo.files[next.seed % startInfo.files.length]);
  if (source.catalogSignature !== next.signature) throw new Error('Starting layout does not match the penguin catalog.');
  validateSave(next.save(source.poses, { mode: 'walk', position: [2.75, 1.75, 14.5], yaw: 0, pitch: -.12, zoom: 1 }), next);
  return source.poses;
}
async function begin(mode = 'free', stored = null) {
  if (starting) return;
  starting = true;
  try {
  const next = new GameState(catalog, layout, { mode });
  if (stored) next.restore(stored);
  const poses = stored?.poses ?? await startPoses(next);
  physics?.dispose(); state = next; ui.state = state;
  view.start(state, poses); physics = new PenguinPhysics(view, hulls); view.floorHeight = point => physics.walkHeight(point);
  if (stored) view.restoreCamera({ ...stored.camera, mode: 'walk' });
  else { view.player.set(2.75, 1.75, 14.5); view.yaw = 0; view.pitch = -.12; view.setMode('walk', false); view.startDropIntro(startInfo.config); }
  view.orbit.enableZoom = !!state.levels.zoom;
  active = true; winShown = state.complete; lastGlow = null; autosave = 0;
  ui.bagKey = null; screen(stored ? 'play' : 'pour'); updateHud(); save(false, !!stored);
  if (stored) ui.toast('Welcome back. Your little shop was waiting.');
  } catch (error) { ui.toast(`The shop could not start: ${error.message}`); }
  finally { starting = false; }
}
function resultSound(result, kind) { if (!result.ok) { sound.play('error'); ui.toast(result.reason); return false; } sound.play(kind); return true; }
function interact(target = aim) {
  if (!active || ui.screen !== 'play') return;
  sound.unlock();
  // With something held, clicking its row takes precedence over pulling a stocked
  // penguin out of that row. A floor penguin remains independently selectable.
  if (target.item >= 0 && state.items[target.item].location === 'shelf' && state.held >= 0) target = { item: -1, row: Math.floor(state.items[target.item].slot / 10) };
  if (target.item >= 0) {
    const p = view.poses[target.item].p.clone();
    if (resultSound(state.pick(target.item), 'pick')) { physics.take(target.item, p); view.write(target.item); view.setHand(state.held); view.updateRowCards(); }
  } else if (target.row >= 0) {
    const result = state.place(target.row);
    if (resultSound(result, result.bonus ? 'bonus' : 'place')) {
      view.toSlot(result.id, result.slot); view.write(result.id); view.setHand(state.held); physics.index(result.id); view.updateRowCards();
      if (result.bonus) ui.toast(`Row complete! +${result.reward + result.bonus} coins`);
    }
  } else {
    const distant = view.mode === 'walk' ? view.pickRay(aimPoint(), 100) : null;
    ui.toast(distant?.item >= 0 && distant.distance > 5 ? 'Move closer to pick up that penguin.' : state.held >= 0 ? 'Aim at the open front of a matching shelf row.' : 'Click a penguin to add it to your bag.');
  }
  updateHud();
  if (state.complete && !winShown) { winShown = true; save(); sound.play('bonus'); screen('win'); }
}
function drop() {
  if (!active || ui.screen !== 'play') return;
  const turn = view.hand?.rotation.y ?? 0;
  if (state.held < 0) { ui.toast('Your bag is empty.'); return; }
  const forward = view.mode === 'walk' ? view.camera.getWorldDirection(new THREE.Vector3()) : new THREE.Vector3(0, 0, -1);
  const origin = view.player.clone(); if (view.mode !== 'walk') origin.y = 2.2;
  const release = physics.dropPosition(state.held, origin, forward, view.yaw + turn);
  if (!release) { sound.play('error'); ui.toast('There is no room to drop here. Move away from the shelf or pile.'); return; }
  const result = state.drop(); if (!resultSound(result, 'pick')) return;
  const p = view.poses[result.id];
  p.p.copy(release.p); p.q.copy(release.q);
  physics.wake(result.id, { x: forward.x, y: forward.y, z: forward.z });
  view.write(result.id); view.setHand(state.held); lastGlow = null; updateHud();
}
function updateHud() { if (state) ui.update(state, view.mode, aim, touchDevice); }
async function action(name, element) {
  try {
    sound.unlock();
    if (name === 'reload') { location.reload(); return; }
    if (name === 'new') {
      const mode = document.getElementById('new-mode')?.value ?? 'free';
      if (saved || active) ui.confirm(() => begin(mode)); else await begin(mode);
    }
    if (name === 'continue') { if (saved) await begin(saved.data.mode, saved.data); }
    if (name === 'resume') screen('play');
    if (name === 'pause') { save(); screen('pause'); }
    if (name === 'title') { save(); active = false; view.setMode('overview'); screen('title'); }
    if (name === 'back') screen(returnScreen);
    if (['help', 'settings', 'collection'].includes(name)) overlay(name);
    if (name === 'upgrades') { if (active) overlay('upgrades'); else ui.toast('Open your shop to unlock upgrades.'); }
    if (name === 'save') save(true);
    if (name === 'buy') {
      const id = element.dataset.upgrade, result = state.buy(id);
      if (resultSound(result, 'upgrade')) { ui.toast(`${UPGRADE_NAMES[id]} upgraded.`); view.orbit.enableZoom = !!state.levels.zoom; save(); ui.show('upgrades', data()); }
    }
    if (name === 'mode' && active && ui.screen === 'play') { releaseMouse(); view.setMode(view.mode === 'walk' ? 'overview' : 'walk'); screen('play'); updateHud(); }
    if (name === 'cycle' && active) { state.cycle(); view.setHand(state.held); updateHud(); }
    if (name === 'select-bag' && active) {
      const i = Number(element.dataset.index); if (Number.isInteger(i) && i >= 0 && i < state.bag.length) state.bag.push(state.bag.splice(i, 1)[0]); view.setHand(state.held); updateHud();
    }
    if (name === 'match' || name === 'guide') {
      if (!active || ui.screen !== 'play') return;
      if (state.held < 0) { ui.toast('Pick up a penguin first.'); return; }
      const result = state.activate(name); if (resultSound(result, 'upgrade')) ui.toast(name === 'match' ? 'Matching penguins are glowing.' : 'Follow the gold marker to a matching row.');
    }
    if (name === 'interact') interact();
    if (name === 'drop') drop();
    if (name === 'setting') { const key = element.dataset.setting; settings[key] = element.type === 'checkbox' ? element.checked : key === 'sensitivity' ? Number(element.value) : element.value; applySettings(); }
    if (name === 'fullscreen' && !platform.crazygames) { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    if (name === 'export' && active) {
      const blob = new Blob([JSON.stringify(state.save(physics.savedPoses(), view.captureCamera()))], { type: 'application/json' });
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `penguin-shop-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
    }
    if (name === 'import') ui.dom['import-save'].click();
  } catch (error) { ui.toast(error.message); }
}

ui.dom['import-save'].addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 1048576) throw new Error('Choose a browser save smaller than 1 MB.');
    const stored = JSON.parse(await file.text()); validateSave(stored, new GameState(catalog, layout));
    ui.confirm(() => begin(stored.mode, stored));
    ui.dom.confirmation.querySelector('h2').textContent = 'Restore this browser save?';
    ui.dom.confirmation.querySelector('p').textContent = 'This replaces your browser store with the imported progress. Your desktop game is unaffected.';
  } catch (error) { ui.toast(`Cannot import this save: ${error.message}`); }
  event.target.value = '';
});

function pointer(event) {
  const rect = canvas.getBoundingClientRect(); mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
}
let pointerStart = null;
function captureMouse() {
  if (touchDevice || mouseCaptureUnavailable || document.pointerLockElement === canvas) return;
  const unavailable = () => {
    mouseCaptureUnavailable = true;
    ui.toast('Click a penguin to pick it up. Drag the scene to look around.');
  };
  try {
    if (!canvas.requestPointerLock) unavailable();
    else canvas.requestPointerLock()?.catch(unavailable);
  } catch { unavailable(); }
}
document.addEventListener('pointerlockerror', () => { mouseCaptureUnavailable = true; });
function aimPoint() { return view.mode === 'walk' && (touchDevice || document.pointerLockElement === canvas) ? new THREE.Vector2(0, 0) : mouse; }
canvas.addEventListener('pointerdown', event => {
  if (ui.screen !== 'play') return;
  sound.unlock(); pointer(event); pointerStart = { x: event.clientX, y: event.clientY, button: event.button, captured: document.pointerLockElement === canvas, moved: false };
  if (view.mode === 'walk' && !pointerStart.captured) canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointerup', event => {
  if (ui.screen !== 'play' || !pointerStart) return;
  const clicked = pointerStart.captured || !pointerStart.moved && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) < 8;
  if (clicked && pointerStart.button === 0) {
    pointer(event); aim = view.pickRay(aimPoint(), view.mode === 'walk' ? 5 : 100); interact();
    // Capture is optional and requested after the click has already worked.
    // Embedded browsers may reject it; subsequent clicks remain usable.
    if (view.mode === 'walk' && event.pointerType !== 'touch') captureMouse();
  } else if (clicked && pointerStart.button === 2 && view.mode === 'walk') drop();
  pointerStart = null;
});
canvas.addEventListener('pointercancel', () => { pointerStart = null; });
canvas.addEventListener('pointermove', event => {
  if (!view) return;
  if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) >= 8) pointerStart.moved = true;
  if (view.mode === 'walk' && ui.screen === 'play' && (document.pointerLockElement === canvas || pointerStart?.moved && event.buttons)) {
    view.yaw -= event.movementX * settings.sensitivity / 1000; view.pitch = Math.max(-1.45, Math.min(1.45, view.pitch - event.movementY * settings.sensitivity / 1000));
  } else pointer(event);
});
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('wheel', event => {
  if (ui.screen !== 'play') return;
  event.preventDefault();
  if (view.mode === 'walk') { state.cycle(Math.sign(event.deltaY)); view.setHand(state.held); lastGlow = null; updateHud(); }
  else if (!state.levels.zoom) ui.toast('Unlock Wide view in Upgrades to zoom the overview.');
}, { passive: false });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && ui.screen === 'play' && view?.mode === 'walk' && !releasingLock) { save(); screen('pause'); } releasingLock = false; });
document.addEventListener('keydown', event => {
  if (event.target.matches('input,select,textarea')) return;
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  if (ui.screen === 'pour') return;
  keys.add(event.code); if (event.repeat) return;
  if (event.code === 'F3') { event.preventDefault(); debug = !debug; ui.dom.stats.hidden = !debug; }
  if (event.code === 'Escape' && active && !ui.dom.confirmation.open) { if (ui.screen === 'play') action('pause'); else if (ui.screen === 'pause') action('resume'); else screen('pause'); }
  if (ui.screen !== 'play') return;
  const binds = { Tab: 'mode', KeyU: 'upgrades', KeyQ: 'match', KeyE: 'guide', KeyG: 'drop', Space: 'interact' };
  if (binds[event.code]) action(binds[event.code]);
  if (event.code === 'KeyC') { state.cycle(event.shiftKey ? -1 : 1); view.setHand(state.held); lastGlow = null; updateHud(); }
  if (['KeyR', 'KeyF'].includes(event.code) && view.hand) view.hand.rotation.y += (event.shiftKey ? -1 : 1) * Math.PI / 12;
  if (/^Digit\d$/.test(event.code)) { const i = (Number(event.code.at(-1)) + 9) % 10; if (i < state.bag.length) { state.bag.push(state.bag.splice(i, 1)[0]); view.setHand(state.held); updateHud(); } }
});
document.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); if (ui.screen === 'play') action('pause'); });
document.addEventListener('visibilitychange', () => { if (document.hidden && ui.screen === 'play') action('pause'); });
window.addEventListener('pagehide', () => save());
window.addEventListener('resize', () => view?.resize());
document.addEventListener('fullscreenchange', () => { view?.resize(); });

let stickPointer = null;
ui.dom.stick.addEventListener('pointerdown', event => { stickPointer = event.pointerId; ui.dom.stick.setPointerCapture(event.pointerId); });
ui.dom.stick.addEventListener('pointermove', event => {
  if (stickPointer !== event.pointerId) return;
  const r = ui.dom.stick.getBoundingClientRect(); touch.x = THREE.MathUtils.clamp((event.clientX - r.left - 55) / 40, -1, 1); touch.y = THREE.MathUtils.clamp((event.clientY - r.top - 55) / 40, -1, 1); ui.dom.stick.firstElementChild.style.transform = `translate(${touch.x * 30}px,${touch.y * 30}px)`;
});
const clearStick = () => { stickPointer = null; touch.x = touch.y = 0; ui.dom.stick.firstElementChild.style.transform = ''; };
ui.dom.stick.addEventListener('pointerup', clearStick); ui.dom.stick.addEventListener('pointercancel', clearStick);
let lookPointer = null, lookX = 0, lookY = 0;
ui.dom['touch-look'].addEventListener('pointerdown', event => { lookPointer = event.pointerId; lookX = event.clientX; lookY = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); });
ui.dom['touch-look'].addEventListener('pointermove', event => { if (event.pointerId !== lookPointer) return; view.yaw -= (event.clientX - lookX) * .005; view.pitch = THREE.MathUtils.clamp(view.pitch - (event.clientY - lookY) * .005, -1.45, 1.45); lookX = event.clientX; lookY = event.clientY; });
ui.dom['touch-look'].addEventListener('pointerup', () => lookPointer = null); ui.dom['touch-look'].addEventListener('pointercancel', () => lookPointer = null);

function frame(time) {
  requestAnimationFrame(frame); const dt = Math.min((time - lastTime) / 1000 || 0, .1); lastTime = time;
  if (!view) return;
  if (active && ui.screen === 'pour') {
    const poured = view.stepDropIntro(dt); ui.pourProgress(poured.landed, state.items.length);
    if (poured.finished) { screen('play'); updateHud(); save(false, false); ui.toast('Click a penguin to pick it up. WASD to walk; drag to look.'); }
  }
  const playing = active && ui.screen === 'play';
  if (playing) {
    state.tick(dt); physics.step(dt);
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') ? state.effect('shift_move', 'speed_multiplier', 1) : 1;
    view.move(dt, keys, touch, sprint);
    aimTimer += dt; hudTimer += dt; autosave += dt;
    if (aimTimer >= .12) { aimTimer = 0; aim = view.pickRay(aimPoint(), view.mode === 'walk' ? 5 : 100); view.showAim(aim); }
    ui.dom.crosshair.hidden = view.mode !== 'walk' || !touchDevice && document.pointerLockElement !== canvas;
    if (hudTimer >= .2) { hudTimer = 0; updateHud(); }
    const glow = state.timers.match.active > 0 && state.held >= 0 ? state.items[state.held].product : null;
    if (glow !== lastGlow) { physics.setMatchLift(glow); view.glow(glow); lastGlow = glow; }
    ui.guide(view.guide(), view.camera); sound.tick(time / 1000, true);
    if (autosave >= 30) { autosave = 0; save(); }
  } else { if (view.mode === 'overview') view.orbit.update(); view.highlight.visible = false; view.rowHighlight.visible = false; view.clearRowGhosts(); }
  if (view.state) view.updateLOD(dt);
  view.render(); fpsFrames++; fpsTime += dt;
  if (fpsTime >= 1) { fps = Math.round(fpsFrames / fpsTime); fpsFrames = 0; fpsTime = 0; }
  if (debug) ui.dom.stats.textContent = `${fps} fps\n${view.renderer.info.render.calls} draw calls\n${view.renderer.info.render.triangles.toLocaleString()} triangles\n${physics?.active.size ?? 0} moving bodies\n${physics?.supports.size ?? 0} local supports\n${view.renderer.info.memory.textures} textures`;
}

async function boot() {
  ui.show('loading'); requestAnimationFrame(frame);
  try {
    [catalog, hulls, lods, startInfo] = await Promise.all([getAsset('./assets/catalog.json'), getAsset('./assets/hulls.json'), getAsset('./assets/lod.json'), getAsset('./assets/start-layouts.json'), platform.init(), initPhysics()]);
    layout = makeLayout(catalog); ui.setData(catalog);
    view = new ShopWorld(canvas, catalog, layout, (fraction, label) => ui.progress(fraction, label)); applySettings();
    state = new GameState(catalog, layout, { mode: 'assigned', seed: 2037 });
    const [previewPoses] = await Promise.all([startPoses(state), view.load(lods)]);
    view.start(state, previewPoses); view.orbit.enabled = false;
    try {
      const candidates = platform.candidates();
      for (const candidate of candidates) {
        try { validateSave(candidate.data, state); saved = { ...candidate, sorted: candidate.data.slots.filter(n => n >= 0).length }; break; } catch { /* Try recovery generation. */ }
      }
      if (candidates.length && !saved) ui.toast('Existing browser progress is invalid. Export or restore a compatible save.');
    } catch (error) { ui.toast(`Saving is unavailable: ${error.message}`); }
    platform.loaded(); ui.show('title', data());
    if (saved?.backup) ui.toast('Recovered your store from its backup save.');
    // Read-only diagnostics for the browser verifier and player performance checks.
    window.penguinGame = { get state() { return state; }, get view() { return view; }, get physics() { return physics; }, get ui() { return ui; }, get active() { return active; }, version: '1.1.0' };
  } catch (error) { console.error(error); ui.show('error', { message: error.message }); }
}
boot();
