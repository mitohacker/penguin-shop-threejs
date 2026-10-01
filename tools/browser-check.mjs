import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'C:/Users/kevin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
fs.mkdirSync('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [], failed = [], consoleErrors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') { consoleErrors.push(message.text()); console.log('BROWSER:', message.text()); } });
page.on('response', response => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`); });
await page.addInitScript(() => window.addEventListener('unhandledrejection', e => console.error('REJECTION:', e.reason?.target?.src, e.reason?.message, e.reason?.stack)));
// Reproduce embedded browsers which deny pointer lock. Walk-mode clicks must
// still pick and place, rather than being consumed by repeated capture requests.
await page.addInitScript(() => { HTMLElement.prototype.requestPointerLock = () => Promise.reject(new DOMException('Mouse capture denied', 'NotAllowedError')); });
await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5178/');
await page.waitForFunction(() => window.penguinGame, null, { timeout: 120000 });
console.log('Shop loaded.');
await page.screenshot({ path: 'test-results/title.png' });
await page.getByRole('button', { name: /Open your shop/ }).click();
await page.waitForFunction(() => window.penguinGame.active && penguinGame.ui.screen === 'play');
const initial = await page.evaluate(() => ({ items: penguinGame.state.items.length, designs: penguinGame.view.prototypes.size, poses: penguinGame.view.poses.length, mode: penguinGame.view.mode, pour: penguinGame.view.lastPour, calls: penguinGame.view.renderer.info.render.calls, triangles: penguinGame.view.renderer.info.render.triangles }));
assert.equal(initial.items, 4000); assert.equal(initial.designs, 160); assert.equal(initial.poses, 4000);
assert.equal(initial.mode,'walk'); assert.equal(initial.pour.landed,4000);
// Pick a visibly exposed doll through real projected screen coordinates.
const point = await page.evaluate(async () => {
  const g = penguinGame, camera = g.view.camera; camera.updateMatrixWorld();
  for (const item of g.state.items) {
    const pose = g.view.poses[item.id], size = g.view.catalog.products.find(p => p.id === item.product).size;
    const p = pose.p.clone().set(0, size[1] / 2, 0).applyQuaternion(pose.q).add(pose.p).project(camera);
    if (Math.abs(p.x) > .7 || Math.abs(p.y) > .7 || p.x > .55 && p.y > .3) continue;
    const target = g.view.pickRay({ x: p.x, y: p.y },5);
    if (target.item === item.id) return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2, id: item.id };
  }
  throw new Error('No exposed penguin could be targeted.');
});
await page.mouse.click(point.x, point.y);
await page.waitForFunction(() => penguinGame.state.bag.length === 1);
console.log('Real pointer pickup passed.');
assert.equal(await page.evaluate(() => penguinGame.state.held), point.id);
await page.screenshot({ path: 'test-results/gameplay.png' });
await page.getByRole('button', { name: /Pause/ }).click();
await page.getByRole('button', { name: 'Save now', exact: true }).click();
assert.equal(await page.evaluate(() => !!localStorage.getItem('penguin-threejs-save-v1')), true);
await page.reload(); await page.waitForFunction(() => window.penguinGame, null, { timeout: 120000 });
console.log('Reload passed.');
await page.getByRole('button', { name: /Continue your store/ }).click();
assert.equal(await page.evaluate(() => penguinGame.state.held), point.id);
// Aim a real camera at an accessible upper shelf, then stock through the normal
// Space action. This changes the camera only, never the inventory or economy.
assert.equal(await page.evaluate(() => penguinGame.view.mode),'walk');
for (let attempt = 0; attempt < 2; attempt++) {
  const floorPoint = await page.evaluate(() => {
    const g = penguinGame, camera = g.view.camera; camera.updateMatrixWorld();
    for (const item of g.state.items) {
      if (item.location !== 'floor' || g.physics.active.has(item.id)) continue;
      const pose = g.view.poses[item.id], size = g.view.catalog.products.find(p => p.id === item.product).size;
      const p = pose.p.clone().set(0, size[1] / 2, 0).applyQuaternion(pose.q).add(pose.p).project(camera);
      if (Math.abs(p.x) > .7 || Math.abs(p.y) > .75 || p.x > .55 && p.y > .3) continue;
      if (g.view.pickRay({ x: p.x, y: p.y }, 5).item === item.id) return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
    }
    throw new Error('No exposed walk-mode penguin.');
  });
  await page.mouse.click(floorPoint.x, floorPoint.y);
  await page.waitForFunction(count => penguinGame.state.bag.length === count, attempt + 2);
}
assert.equal(await page.evaluate(() => !!document.pointerLockElement), false);
console.log('Repeated walk-mode mouse pickup with capture denied passed.');
const shelf = await page.evaluate(() => {
  const g = penguinGame;
  g.view.setMode('walk');
  for (const row of g.view.layout.rows.filter(r => r.id % 4 === 3)) {
    const n = { x: Math.sin(row.yaw), z: Math.cos(row.yaw) };
    g.view.player.set(row.center[0] + n.x * 1.6, 1.75, row.center[2] + n.z * 1.6);
    g.view.player.y = Math.min(4.25, 1.75 + g.physics.walkHeight(g.view.player));
    const direction = g.view.player.clone().set(...row.center).sub(g.view.player).normalize();
    g.view.yaw = Math.atan2(-direction.x, -direction.z); g.view.pitch = Math.asin(direction.y);
    g.view.camera.position.copy(g.view.player); g.view.camera.rotation.set(g.view.pitch, g.view.yaw, 0); g.view.camera.updateMatrixWorld();
    const target = g.view.pickRay({ x: 0, y: 0 }, 5);
    if (target.row === row.id) return row.id;
  }
  throw new Error('No accessible shelf row.');
});
await page.mouse.move(page.viewportSize().width / 2, page.viewportSize().height / 2);
await page.waitForFunction(() => penguinGame.ui.dom.hint.textContent.includes('stock this row'));
await page.mouse.click(page.viewportSize().width / 2, page.viewportSize().height / 2);
await page.waitForFunction(() => penguinGame.state.sorted === 1);
assert.equal(await page.evaluate(() => penguinGame.state.coins), 1);
await page.screenshot({ path: 'test-results/walk.png' });
console.log('Real shelf placement and reward passed.');
await page.getByRole('button', { name: /Pause/ }).click();
await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.getByRole('button', { name: 'Enter / leave fullscreen' }).click();
await page.waitForFunction(() => !!document.fullscreenElement);
await page.getByRole('button', { name: 'Enter / leave fullscreen' }).click();
await page.waitForFunction(() => !document.fullscreenElement);
await page.setViewportSize({ width: 821, height: 462 });
await page.screenshot({ path: 'test-results/settings-small.png' });
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
await page.getByRole('button', { name: '← Back' }).click();
await page.getByRole('button', { name: 'Collections', exact: true }).click();
assert.equal(await page.locator('#gallery-items article').count(), 160);
await page.locator('#gallery-search').fill('umbrella');
assert.equal(await page.locator('#gallery-items article').count(), 1);
await page.screenshot({ path: 'test-results/collection.png' });
await page.getByRole('button', { name: '← Back' }).click();
await page.getByRole('button', { name: 'Back to the shop', exact: true }).click();
const dynamicId = await page.evaluate(() => {
  const g = penguinGame;
  // A scripted physical drop complements the real mouse/keyboard sorting checks.
  const id = g.state.items.find(i => i.location === 'floor').id;
  g.view.poses[id].p.set(2.75, 2.5, 14.7); g.view.poses[id].q.identity(); g.view.write(id); g.physics.wake(id); return id;
});
await page.waitForFunction(id => penguinGame.view.poses[id].p.y < 2, dynamicId);
assert.equal(await page.evaluate(() => penguinGame.physics.active.size <= 96), true);
console.log('Rapier gravity and sparse body cap passed.');
await page.keyboard.press('Escape');
await page.waitForFunction(() => penguinGame.ui.screen === 'pause');
await page.getByRole('button', { name: 'Settings', exact: true }).click();
const textureCount = await page.evaluate(() => penguinGame.view.renderer.info.memory.textures);
assert.ok(textureCount < 70, `Unexpected texture duplication: ${textureCount}`);
console.log(JSON.stringify({ errors, failed }));
assert.deepEqual(errors, []); assert.deepEqual(failed, []);
assert.deepEqual(consoleErrors, []);
const report = { initial, realPointerPickup: point.id, walkPickupWithoutPointerLock: true, shelf, realPlacement: true, physics: true, textureCount, saveReload: true, fullscreen: true, smallIframe: true, collectionSearch: true, errors, failed };
fs.writeFileSync('test-results/browser-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await page.close();
const mobile = await browser.newContext({ viewport: { width: 800, height: 450 }, hasTouch: true, isMobile: true });
const mobilePage = await mobile.newPage();
mobilePage.on('pageerror', error => errors.push(error.message));
await mobilePage.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5178/');
await mobilePage.waitForFunction(() => window.penguinGame, null, { timeout: 120000 });
await mobilePage.getByRole('button', { name: /Open your shop/ }).tap();
await mobilePage.waitForFunction(() => penguinGame.ui.screen === 'play' && penguinGame.view.mode === 'walk' && !penguinGame.ui.dom.touch.hidden);
await mobilePage.waitForFunction(() => !penguinGame.ui.dom.hint.textContent.includes('WASD'));
const initialZ = await mobilePage.evaluate(() => penguinGame.view.player.z);
const stick = await mobilePage.locator('#stick').boundingBox(), cdp = await mobile.newCDPSession(mobilePage);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x + 55, y: stick.y + 55, id: 1 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: stick.x + 55, y: stick.y + 25, id: 1 }] });
await mobilePage.waitForFunction(z => penguinGame.view.player.z < z - .1, initialZ);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await mobilePage.screenshot({ path: 'test-results/touch.png' });
report.touchMovement = true;
report.touchInstructions = true;
await mobile.close();
const sdkPage = await browser.newPage({ viewport: { width: 907, height: 510 } });
sdkPage.on('pageerror', error => errors.push(error.message));
await sdkPage.route('https://sdk.crazygames.com/crazygames-sdk-v3.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.sdkEvents=[]; window.CrazyGames={SDK:{environment:'local',init:async()=>sdkEvents.push('init'),game:{loadingStart:()=>sdkEvents.push('loadingStart'),loadingStop:()=>sdkEvents.push('loadingStop'),gameplayStart:()=>sdkEvents.push('gameplayStart'),gameplayStop:()=>sdkEvents.push('gameplayStop')},data:window.localStorage}};` }));
await sdkPage.goto((process.env.GAME_URL ?? 'http://127.0.0.1:5178/') + '?platform=crazygames');
await sdkPage.waitForFunction(() => window.penguinGame, null, { timeout: 120000 });
await sdkPage.getByRole('button', { name: /Open your shop/ }).click();
await sdkPage.waitForFunction(() => penguinGame.ui.screen === 'play');
await sdkPage.getByRole('button', { name: /Pause/ }).click();
await sdkPage.getByRole('button', { name: 'Settings', exact: true }).click();
assert.equal(await sdkPage.getByRole('button', { name: 'Enter / leave fullscreen' }).count(), 0);
const sdkEvents = await sdkPage.evaluate(() => sdkEvents);
assert.deepEqual(sdkEvents, ['init', 'loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStop']);
assert.equal(await sdkPage.evaluate(() => !!localStorage.getItem('penguin-threejs-save-v1')), true);
report.sdkAdapterMock = { events: sdkEvents, dataSave: true, customFullscreenAbsent: true };
assert.deepEqual(errors, []);
fs.writeFileSync('test-results/browser-report.json', JSON.stringify(report, null, 2));
console.log('Touch movement and SDK adapter mock passed.');
await browser.close();
