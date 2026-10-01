import { UPGRADE_NAMES } from './core.js';
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export class UI {
  constructor(root, actions) {
    this.root = root; this.actions = actions; this.catalog = null; this.state = null; this.screen = 'loading'; this.galleryFilter = '';
    root.innerHTML = `
      <header id="hud" hidden><div class="brand"><span class="brand-mark">P</span><div>Penguin Shop<small>Sort every penguin</small></div></div>
        <div class="hud-progress"><span id="sorted">0 / 4,000</span><div class="progress-track"><div id="progress-fill"></div></div></div>
        <div class="wallet"><span aria-hidden="true">●</span><b id="coins">0</b><small>coins</small></div>
        <button data-action="pause" aria-label="Pause game">Pause <kbd>Esc</kbd></button></header>
      <div id="crosshair" hidden>+</div>
      <aside id="target" hidden><small id="target-label">A LITTLE PENGUIN</small><img id="target-image" alt=""><strong id="target-name"></strong><span id="target-extra"></span></aside>
      <div id="guide-arrow" hidden aria-label="Direction to matching shelf">➤ <span></span></div>
      <div id="hint" hidden></div><div id="toast" role="status" aria-live="polite" hidden></div>
      <footer id="toolbar" hidden>
        <div class="bag-group"><div><small>YOUR BAG</small><b id="bag-count">0 / 5</b></div><div id="bag-items"></div><button data-action="cycle" aria-label="Cycle carried penguin">↻</button></div>
        <div class="toolbar-actions"><button data-action="mode" id="mode-button">Walk <kbd>Tab</kbd></button><button data-action="match" id="match-button">Find twins <kbd>Q</kbd></button><button data-action="guide" id="guide-button">Shelf compass <kbd>E</kbd></button><button data-action="upgrades">Upgrades <kbd>U</kbd></button></div>
      </footer>
      <div id="touch" hidden><div id="stick"><span></span></div><div id="touch-look" aria-label="Drag to look around"></div><div class="touch-actions"><button data-action="interact">Pick / stock</button><button data-action="drop">Drop</button></div></div>
      <div id="screen"></div><div id="pour" hidden role="status"><strong>The penguins are arriving…</strong><span id="pour-count">0 / 4,000 landed</span><div class="progress-track"><div id="pour-progress"></div></div></div><div id="stats" hidden></div>
      <input type="file" id="import-save" accept="application/json,.json" hidden>
      <dialog id="confirmation"><h2>Start a fresh store?</h2><p>Your browser progress will be replaced. Export your save first if you want to keep it.</p><div class="button-row"><button id="cancel-new">Keep my store</button><button class="primary" id="confirm-new">Start fresh</button></div></dialog>`;
    this.dom = Object.fromEntries([...root.querySelectorAll('[id]')].map(el => [el.id, el]));
    root.addEventListener('click', event => { const action = event.target.closest('[data-action]')?.dataset.action; if (action) this.actions(action, event.target.closest('[data-action]')); });
    root.addEventListener('change', event => { if (event.target.dataset.setting) this.actions('setting', event.target); if (event.target.id === 'gallery-filter') this.gallery(event.target.value); });
    root.addEventListener('input', event => { if (event.target.id === 'gallery-search') this.filterGallery(event.target.value); });
    this.dom['cancel-new'].addEventListener('click', () => this.dom.confirmation.close());
    this.dom['confirm-new'].addEventListener('click', () => { this.dom.confirmation.close(); this.onConfirm?.(); });
  }
  progress(fraction, label = '') {
    const bar = document.getElementById('load-progress'), text = document.getElementById('load-caption');
    if (bar) bar.style.width = `${Math.round(fraction * 100)}%`;
    if (text) text.textContent = `${Math.round(fraction * 100)}% · ${label}`;
  }
  setData(catalog) { this.catalog = catalog; this.products = new Map(catalog.products.map(p => [p.id, p])); }
  pourProgress(landed, total) { this.dom['pour-count'].textContent = `${landed.toLocaleString()} / ${total.toLocaleString()} landed`; this.dom['pour-progress'].style.width = `${landed / total * 100}%`; }
  show(screen, data = {}) {
    this.screen = screen; const playing = screen === 'play';
    this.dom.screen.hidden = playing || screen === 'pour'; this.dom.pour.hidden = screen !== 'pour'; if (screen === 'pour') this.pourProgress(0, 4000);
    this.dom.hud.hidden = !playing; this.dom.toolbar.hidden = !playing; this.dom.hint.hidden = !playing;
    this.dom.crosshair.hidden = !playing || data.mode !== 'walk'; this.dom.touch.hidden = !playing || data.mode !== 'walk' || !data.touch;
    if (!playing) { this.dom.target.hidden = true; this.dom['guide-arrow'].hidden = true; }
    const heading = (title, subtitle = '') => `<div class="pane-heading"><small>PENGUIN SHOP</small><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div>`;
    const back = '<button class="back" data-action="back">← Back</button>';
    if (screen === 'loading') this.dom.screen.innerHTML = `<section class="title-pane">${heading('A home for every<br>little penguin.', 'A cozy 3D shop. A wonderfully big mess.')}<div class="loading-block"><div class="progress-track"><div id="load-progress"></div></div><span id="load-caption">Preparing your shop…</span></div></section>`;
    if (screen === 'title') this.dom.screen.innerHTML = `<section class="title-pane">${heading('A home for every<br>little penguin.', 'Collect, carry, and find a place for 4,000 tiny treasures.')}<div class="game-facts"><span>160 designs</span><span>10 collections</span><span>Your own pace</span></div>${data.saved ? `<button class="primary large" data-action="continue">Continue your store <span>${data.sorted.toLocaleString()} / 4,000 sorted</span></button>` : ''}<label class="field">Shelf arrangement<select id="new-mode"><option value="free">Choose your rows — make the shop your own</option><option value="assigned">Assigned rows — match the shelf pictures</option></select></label><button class="${data.saved ? '' : 'primary '}large" data-action="new">${data.saved ? 'Start a fresh store' : 'Open your shop'} <span>Begin sorting</span></button><div class="button-row"><button data-action="help">How to play</button><button data-action="collection">Collections</button><button data-action="settings">Settings</button></div><p class="fineprint">Made for quiet moments. Progress saves automatically.</p></section>`;
    if (screen === 'pause') this.dom.screen.innerHTML = `<section class="panel">${heading('Take a little breather.', `${data.sorted.toLocaleString()} penguins have found their place.`)}<button class="primary large" data-action="resume">Back to the shop</button><div class="menu-grid"><button data-action="upgrades">Upgrades</button><button data-action="collection">Collections</button><button data-action="help">How to play</button><button data-action="settings">Settings</button><button data-action="export">Export save</button><button data-action="import">Import save</button></div><div class="button-row"><button data-action="save">Save now</button><button data-action="title">Return to title</button></div><p class="fineprint">Time in the shop: ${clock(data.elapsed ?? 0)}</p></section>`;
    if (screen === 'help') this.dom.screen.innerHTML = `<section class="panel wide-panel">${back}${heading('One penguin at a time.', 'Pick up a little friend. Find its row. Watch the shop come together.')}<div class="help-columns"><div><h3>The sorting loop</h3><p>Click a penguin to add it to your bag. Click the open front of a shelf row to stock the penguin you are holding. Every row holds ten of the same design.</p><p>Earn one coin for each penguin’s first placement, and ten extra when you finish a row. Spend coins on bag space, quicker movement, and helpful abilities.</p><p>Choose-your-rows mode lets an empty row adopt your design. Assigned mode uses the pictures on each shelf. You can pick stocked penguins back up, but rewards are paid only once.</p></div><div><h3>Get comfortable</h3><dl><dt>Overview</dt><dd>Click to pick or stock. Right-drag to orbit. Middle-drag to zoom.</dd><dt>Walk · Tab</dt><dd>WASD / arrows to move. Click penguins to pick them up. Mouse capture is optional; drag the scene to look if it is unavailable.</dd><dt>Bag</dt><dd>1–0 selects an item. Mouse wheel / C cycles the bag; Shift+C cycles backward. Right-click / G drops. R rotates; Shift+R rotates back.</dd><dt>Helpful tools</dt><dd>Q finds twins. E marks a shelf. U opens upgrades. Shift sprints after unlocking Quick feet.</dd><dt>Pause / fullscreen</dt><dd>Escape pauses. Use Fullscreen in settings, or CrazyGames’ own fullscreen control.</dd><dt>Touch</dt><dd>Tap in overview; two fingers orbit/zoom. In walk mode, use the left stick and drag the right side to look.</dd></dl></div></div></section>`;
    if (screen === 'settings') this.settings(data, heading, back);
    if (screen === 'upgrades') this.upgrades(data, heading, back);
    if (screen === 'collection') this.gallery('', heading, back);
    if (screen === 'win') this.dom.screen.innerHTML = `<section class="panel">${heading('Every penguin is home.', 'Your shop is complete. All 4,000 little treasures, beautifully sorted.')}<div class="win-stats"><div><b>4,000</b><span>penguins sorted</span></div><div><b>${clock(data.elapsed)}</b><span>time in the shop</span></div><div><b>${data.coins}</b><span>coins remaining</span></div></div><button class="primary large" data-action="resume">Enjoy your finished shop</button><div class="button-row"><button data-action="title">Title screen</button><button data-action="export">Export this store</button></div></section>`;
    if (screen === 'error') this.dom.screen.innerHTML = `<section class="panel">${heading('The shop could not open.', escape(data.message))}<button class="primary" data-action="reload">Try again</button><p class="fineprint">Use a browser with WebGL2 enabled and open this game through its local server.</p></section>`;
  }
  settings(data, heading, back) {
    const s = data.settings;
    this.dom.screen.innerHTML = `<section class="panel">${back}${heading('Make yourself at home.')}<label class="field">Graphics<select data-setting="quality"><option value="low" ${s.quality === 'low' ? 'selected' : ''}>Low — lighter on your device</option><option value="balanced" ${s.quality === 'balanced' ? 'selected' : ''}>Balanced</option><option value="high" ${s.quality === 'high' ? 'selected' : ''}>High — sharper rendering</option></select></label><label class="check-field"><input type="checkbox" data-setting="sound" ${s.sound ? 'checked' : ''}> Sound effects</label><label class="check-field"><input type="checkbox" data-setting="music" ${s.music ? 'checked' : ''}> Gentle background music</label><label class="field">Mouse sensitivity<input type="range" min="1" max="8" step=".5" value="${s.sensitivity}" data-setting="sensitivity"></label>${!data.crazygames ? '<button data-action="fullscreen">Enter / leave fullscreen</button>' : '<p>Fullscreen is available in the CrazyGames player.</p>'}<div class="button-row"><button data-action="import">Import a browser save</button>${data.active ? '<button data-action="export">Export progress</button>' : ''}</div><p class="fineprint">This version has its own saves. It does not read or change your desktop game progress.</p></section>`;
  }
  upgrades(data, heading = title => `<h1>${title}</h1>`, back = '<button class="back" data-action="back">← Back</button>') {
    const state = data.state;
    this.dom.screen.innerHTML = `<section class="panel wide-panel">${back}${heading('A little help goes a long way.', `You have ${state.coins.toLocaleString()} coins to spend.`)}<div class="upgrade-list">${Object.entries(UPGRADE_NAMES).map(([id, title]) => {
      const level = state.levels[id], cost = state.cost(id), next = this.catalog.upgrades[id][Math.min(level, this.catalog.upgrades[id].length - 1)];
      const desc = id === 'inventory' ? `See what is in your bag. Carry ${next.capacity} penguins.` : id === 'shift_move' ? `Hold Shift to walk ${next.speed_multiplier}× faster.` : id === 'zoom' ? 'Use the wheel to zoom out for a wider overview.' : id === 'match' ? `Lift matching floor penguins to shelf height for ${next.duration_seconds}s. Recharge: ${next.cooldown_minutes} min.` : `Mark a matching shelf for ${next.duration_seconds}s. Recharge: ${next.cooldown_minutes} min.`;
      return `<article><div><small>LEVEL ${level} / ${this.catalog.upgrades[id].length}</small><h3>${title}</h3><p>${desc}</p></div><button data-action="buy" data-upgrade="${id}" ${cost === null || state.coins < cost ? 'disabled' : ''}>${cost === null ? 'Fully upgraded' : `${cost} coins`}</button></article>`;
    }).join('')}</div></section>`;
  }
  gallery(filter = '', heading = title => `<h1>${title}</h1>`, back = '<button class="back" data-action="back">← Back</button>') {
    this.galleryFilter = filter;
    this.dom.screen.innerHTML = `<section class="panel gallery-panel">${back}${heading('Meet the whole collection.')}<div class="gallery-controls"><select id="gallery-filter" aria-label="Filter collection"><option value="">All 160 designs</option>${this.catalog.sheets.map(s => `<option value="${s.id}" ${filter === s.id ? 'selected' : ''}>${escape(s.title)}</option>`).join('')}</select><input id="gallery-search" type="search" placeholder="Find a penguin…" aria-label="Search penguin designs"></div><div class="gallery" id="gallery-items"></div></section>`;
    this.filterGallery('');
  }
  filterGallery(search) {
    const items = this.catalog.products.filter(p => (!this.galleryFilter || p.sheet === this.galleryFilter) && p.name.toLowerCase().includes(search.toLowerCase()));
    document.getElementById('gallery-items').innerHTML = items.map(p => {
      const collected = this.state?.items.filter(i => i.product === p.id && i.location === 'shelf').length ?? 0;
      return `<article><img src="${p.thumbnail}" alt="${escape(p.name)}" loading="lazy"><span>${escape(p.name)}</span>${this.state ? `<small>${collected} stocked</small>` : ''}</article>`;
    }).join('');
  }
  update(state, mode, target, touch = false) {
    this.state = state;
    this.dom.sorted.textContent = `${state.sorted.toLocaleString()} / 4,000`;
    this.dom['progress-fill'].style.width = `${state.sorted / 40}%`; this.dom.coins.textContent = state.coins.toLocaleString();
    this.dom['bag-count'].textContent = `${state.bag.length} / ${state.capacity}`;
    const bagKey = state.bag.join(',') + ':' + state.levels.inventory;
    if (this.bagKey !== bagKey) {
      this.bagKey = bagKey;
      this.dom['bag-items'].innerHTML = state.bag.map((id, index) => {
        const item = state.items[id], p = this.products.get(item.product);
        return `<button data-action="select-bag" data-index="${index}" class="bag-slot ${id === state.held ? 'selected' : ''}" aria-label="${state.levels.inventory ? escape(p.name) : `Bag item ${index + 1}`}">${state.levels.inventory ? `<img src="${p.thumbnail}" alt="">` : `<span>${index + 1}</span>`}</button>`;
      }).join('');
    }
    this.dom['mode-button'].innerHTML = `${mode === 'walk' ? 'Overview' : 'Walk'} <kbd>Tab</kbd>`;
    for (const id of ['match', 'guide']) {
      const button = this.dom[`${id}-button`], timer = state.timers[id];
      button.classList.toggle('ability-active', timer.active > 0);
      button.textContent = `${id === 'match' ? 'Find twins' : 'Shelf compass'}${!state.levels[id] ? ' · locked' : timer.active > 0 ? ` · ${Math.ceil(timer.active)}s` : timer.cooldown > 0 ? ` · ${clock(timer.cooldown)}` : ''}`;
    }
    const activeProduct = state.held >= 0 ? this.products.get(state.items[state.held].product) : null;
    let product = target.item >= 0 ? this.products.get(state.items[target.item].product) : target.row >= 0 ? this.products.get(state.rowProduct(target.row)) : activeProduct;
    this.dom.target.hidden = !product || this.screen !== 'play';
    if (product) {
      this.dom['target-label'].textContent = target.row >= 0 ? 'THIS ROW IS FOR' : target.item >= 0 ? 'A LITTLE PENGUIN' : 'YOU ARE HOLDING';
      if (this.dom['target-image'].dataset.product !== product.id) { this.dom['target-image'].src = product.thumbnail; this.dom['target-image'].dataset.product = product.id; }
      this.dom['target-name'].textContent = product.name;
      this.dom['target-extra'].textContent = target.row >= 0 ? `${state.slots.slice(target.row * 10, target.row * 10 + 10).filter(n => n >= 0).length} / 10 stocked` : '';
    }
    const pick = touch ? mode === 'walk' ? 'Use Pick / stock to pick up this penguin' : 'Tap to pick up this penguin' : 'Click to pick up this penguin';
    const stock = touch ? mode === 'walk' ? 'Use Pick / stock to stock this row' : 'Tap to stock this row' : 'Click to stock this row';
    const explore = touch ? mode === 'walk' ? 'Left stick to walk · Drag right to look · Overview to orbit' : 'Tap a penguin · Two fingers to orbit · Walk to explore' : mode === 'walk' ? 'WASD to walk · Drag to look · Click a penguin · Tab for overview' : 'Click a penguin · Right-drag to orbit · Tab to walk';
    this.dom.hint.textContent = target.item >= 0 ? pick : target.row >= 0 ? activeProduct ? stock : 'Pick a penguin to stock this row' : explore;
  }
  toast(message) { this.dom.toast.textContent = message; this.dom.toast.hidden = false; clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => this.dom.toast.hidden = true, 3200); }
  confirm(callback) { this.onConfirm = callback; this.dom.confirmation.showModal(); }
  guide(point, camera) {
    const el = this.dom['guide-arrow']; el.hidden = !point || this.screen !== 'play'; if (!point) return;
    const projected = point.clone().project(camera); const behind = point.clone().sub(camera.position).dot(camera.getWorldDirection(point.clone())) < 0;
    const x = Math.max(-.75, Math.min(.75, projected.x * (behind ? -1 : 1))), y = Math.max(-.65, Math.min(.65, projected.y * (behind ? -1 : 1)));
    el.style.left = `${(x + 1) * 50}%`; el.style.top = `${(1 - y) * 50}%`; el.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(-y, x) * 180 / Math.PI}deg)`;
  }
}
