// Fame Lounge Hannover — renders content/site.json + content/menu.json into the page,
// wires up menu, reservation, and the motion layer (GSAP, Lenis, Three.js smoke).

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const euro = n => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const icon = (id, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

// ?motion forces animations on (for previewing on a system with "reduce motion" switched on)
// Animations run for every visitor, regardless of the system "reduce motion" setting (owner decision 2026-10-23).
const reduceMotion = false;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

let site, menu, images;

// mobile action bar appears once the hero buttons have scrolled away
new IntersectionObserver(([e]) => $('.action-bar').classList.toggle('shown', !e.isIntersecting)).observe($('.hero-actions'));

// The free Netlify plan injects a fixed "Powered by Netlify" badge bottom-right. It must stay visible,
// so the mobile action bar is lifted above it instead of being covered.
{
  const check = () => document.documentElement.style.setProperty('--badge-h', document.querySelector('iframe[title="Powered by Netlify"]') ? '56px' : '0px');
  new MutationObserver(check).observe(document.body, { childList: true });
  check();
}

init().catch(err => {
  console.error('Inhalte konnten nicht geladen werden', err);
});

async function init() {
  const load = (p, priority = 'high') => fetch(p, { priority }).then(r => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); });
  [site, menu, images] = await Promise.all([load('content/site.json'), load('content/menu.json', 'low'), load('assets/img/images.json?v=fea6beb6')]);

  // hero first, then the rest in small tasks so the main thread never blocks for long
  bindText();
  setupOpenState();
  setupNav();
  await renderAll();
  for (const step of [setupMenu, setupFlavours, setupForm, setupMap, setupVideos, setupCocktailShow, injectJsonLd, setupMotion, setupSmoke]) {
    await yieldMain();
    step();
  }
}

function yieldMain() {
  return globalThis.scheduler?.yield ? scheduler.yield() : new Promise(r => setTimeout(r, 0));
}

/* ---------- helpers ---------- */

function img(name, { sizes = '100vw', alt = '', cls = '', lazy = true, max = 1400 } = {}) {
  const m = images[name];
  if (!m) return '';
  const srcset = m.widths.map(w => `assets/img/${name}-${w}.webp ${w}w`).join(', ');
  const fallback = [...m.widths].reverse().find(w => w <= max) ?? m.widths[0];
  return `<img src="assets/img/${name}-${fallback}.webp" srcset="${srcset}" sizes="${sizes}" width="${m.w}" height="${m.h}" alt="${esc(alt)}"${cls ? ` class="${cls}"` : ''}${lazy ? ' loading="lazy" decoding="async"' : ''}>`;
}

function links() {
  const v = site.venue;
  const wa = v.whatsapp ? `https://wa.me/${v.whatsapp}` : 'https://wa.me/';
  return {
    tel: `tel:${v.phoneLink}`,
    route: v.routeUrl,
    google: v.google,
    facebook: v.facebook,
    instagram: `https://www.instagram.com/${v.instagram}/`,
    whatsapp: `${wa}?text=${encodeURIComponent('Hallo Fame Lounge, ich möchte gern einen Tisch reservieren.')}`,
    wa,
  };
}

function findItem(name) {
  for (const t of menu.tabs) for (const g of t.groups) for (const i of g.items) if (i.name === name) return { tab: t, group: g, item: i };
  return null;
}
const findGroup = id => menu.tabs.flatMap(t => t.groups).find(g => g.id === id);
function priceOf(item) {
  if (item.price != null) return (item.prefix ? item.prefix + ' ' : '') + euro(item.price);
  if (item.prices?.length) return item.prices.map(p => euro(p.price)).join(' / ');
  return item.priceText ?? '';
}

function berlinNow() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((o, p) => (o[p.type] = p.value, o), {});
  const dayIdx = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  return { dayIdx, minutes: +parts.hour * 60 + +parts.minute, iso: `${parts.year}-${parts.month}-${parts.day}` };
}
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/* ---------- static bindings ---------- */

function bindText() {
  const hero = site.hero, title = hero.titles[hero.activeTitle] ?? hero.titles[0];
  // accent is split over two staggered lines: everything but the last word / the last word
  const words = title.accent.trim().split(/\s+/);
  const accent2 = words.pop(), accent1 = words.join(' ');
  const ctx = { ...site, hero: { ...hero, pre: title.pre, accent1, accent2 } };
  $$('[data-bind]').forEach(el => { const v = get(ctx, el.dataset.bind); if (v != null) el.textContent = v; });
  $$('[data-bind-html]').forEach(el => { const v = get(ctx, el.dataset.bindHtml); if (v != null) el.innerHTML = v; });
  const l = links();
  $$('[data-href]').forEach(el => { if (l[el.dataset.href]) el.href = l[el.dataset.href]; });
  $$('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
}

/* ---------- section renderers ---------- */

async function renderAll() {
  const R = (key, html) => $$(`[data-render="${key}"]`).forEach(el => { el.innerHTML = html; });
  const v = site.venue, l = links();

  R('usps', site.usps.map(u => `<li>${icon(u.icon)}<strong>${esc(u.title)}</strong><span>${esc(u.text)}</span></li>`).join(''));

  R('tiers', site.shisha.cards.map(c => {
    const g = findGroup(c.group);
    return `<article class="card tier${c.featured ? ' featured' : ''}">
      <div class="card-media">${img(c.img, { sizes: '(min-width: 680px) 22vw, 92vw', alt: `${c.label} Shisha` })}</div>
      <div class="card-body">
        <h3>${esc(c.label)}</h3>
        <p class="price">${euro(g.price)}</p>
        <span class="hh">${icon('clock', 'ico')} Happy Hour bis ${esc(site.hours.happyHourUntil)} Uhr: ${euro(g.happyHour)}</span>
        <p>${esc(c.text)}</p>
        <button class="more" type="button" data-open-tab="shisha" data-group="${esc(c.group)}">Sorten ansehen ${icon('arrow')}</button>
      </div>
    </article>`;
  }).join(''));

  await yieldMain();
  const about = site.about;
  R('about', about.paragraphs.map(p => `<p>${esc(p)}</p>`).join(''));
  const aboutImg = $('[data-img="about"]');
  if (aboutImg) aboutImg.outerHTML = img(about.image, { sizes: '(min-width: 900px) 55vw, 100vw', alt: about.imageAlt, max: 1400 });

  R('categories', site.categories.tiles.map(t => `
    <button class="card cat-tile" type="button" data-open-tab="${esc(t.tab)}">
      <div class="card-media">${img(t.img, { sizes: '(min-width: 900px) 19vw, 46vw', alt: '' })}</div>
      <div class="card-body"><h3>${esc(t.label)}</h3><p>${esc(t.text)}</p><span class="more">Entdecken ${icon('arrow')}</span></div>
    </button>`).join(''));

  // moving words behind the video, price tags floating around it, rotating drink name in the text
  const names = menu.tabs.find(t => t.id === 'cocktails').groups[0].items.map(i => i.name);
  const strip = names.slice(0, 10).map(n => `<span>${esc(n)}</span>`).join('<i>✦</i>');
  R('cocktailWords', strip + '<i>✦</i>' + strip + '<i>✦</i>');
  R('cocktailFloat', site.cocktails.highlights.slice(0, 4).map((n, i) => {
    const f = findItem(n);
    return f ? `<span class="ftag ftag-${i + 1}">${esc(n)} <b>${priceOf(f.item)}</b></span>` : '';
  }).join(''));
  $('.rot-word').dataset.words = ['Mojito', 'Pina Colada', 'Zombie', 'Caipirinha', 'Swimming Pool', 'Moscow Mule'].filter(n => names.includes(n)).join('|');

  R('cocktailHighlights', site.cocktails.highlights.map(n => {
    const f = findItem(n);
    return f ? `<li class="chip">${esc(n)} <b>${priceOf(f.item)}</b></li>` : '';
  }).join(''));

  await yieldMain();
  R('dishes', site.speisen.dishes.map(d => {
    let title = d.title, desc = d.text, price = '';
    if (d.ref) { const f = findItem(d.ref); if (f) { title ??= f.item.name; desc ??= f.item.desc; price = priceOf(f.item); } }
    if (d.group) { const g = findGroup(d.group); const min = Math.min(...g.items.map(i => i.price)); price = `ab ${euro(min)}`; }
    return `<article class="card dish${d.wide ? ' wide' : ''}">
      <div class="card-media">${img(d.img, { sizes: d.wide ? '(min-width: 1000px) 40vw, (min-width: 600px) 46vw, 92vw' : '(min-width: 1000px) 30vw, (min-width: 600px) 46vw, 92vw', alt: title })}</div>
      <div class="card-body">
        <div class="row"><h3>${esc(title)}</h3><span class="price">${esc(price)}</span></div>
        ${desc ? `<p>${esc(desc)}</p>` : ''}
        <button class="more" type="button" data-open-tab="${esc(d.tab)}">Zur Karte ${icon('arrow')}</button>
      </div>
    </article>`;
  }).join(''));

  await yieldMain();
  R('aktionen', site.aktionen.items.filter(a => a.aktiv).map(a => {
    const href = a.link?.href ? (l[a.link.href] ?? a.link.href) : null;
    const link = a.link ? (a.link.tab
      ? `<button class="more" type="button" data-open-tab="${esc(a.link.tab)}">${esc(a.link.label)} ${icon('arrow')}</button>`
      : `<a class="more" href="${esc(href)}" target="_blank" rel="noopener">${esc(a.link.label)} ${icon('arrow')}</a>`) : '';
    const media = a.video ? `<div class="promo-video"><span class="pv-bg" style="background-image:url(assets/video/${esc(a.video)}-poster.webp)" aria-hidden="true"></span><video class="lazy-video" muted loop playsinline preload="none" data-poster="assets/video/${esc(a.video)}-poster.webp" aria-label="${esc(a.title)} (Video ohne Ton)"><source data-src="assets/video/${esc(a.video)}.mp4" type="video/mp4"></video></div>` : '';
    return `<article class="card promo${a.video ? ' has-video' : ''}">${media}
      <div class="card-body">
        <div class="top"><span class="promo-icon">${icon(a.icon)}</span><span class="badge">${esc(a.badge)}</span></div>
        <h3>${esc(a.title)}</h3><p>${esc(a.text)}</p>${link}
      </div></article>`;
  }).join(''));

  await yieldMain();
  const r = site.rating;
  const stars = Array.from({ length: 5 }, (_, i) => {
    const cls = r.value >= i + 1 ? '' : r.value > i ? 'half' : 'empty';
    return `<svg viewBox="0 0 24 24" class="${cls}"><use href="#i-star"/></svg>`;
  }).join('');
  R('stars', stars);
  const checked = new Date(r.checked).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  R('ratingCount', `${r.count.toLocaleString('de-DE')} Bewertungen auf Google<small>Stand: ${esc(checked)}</small>`);
  $$('[data-count]').forEach(el => { el.dataset.count = r.value; el.textContent = r.value.toLocaleString('de-DE', { minimumFractionDigits: 1 }); });

  R('address', `${esc(v.street)}, ${esc(v.zip)} ${esc(v.city)}`);
  R('igHandle', `@${esc(v.instagram)}`);

  const h = site.hours, today = berlinNow().dayIdx;
  R('hours', DAYS.map((d, i) => `<tr${i === today ? ' class="today"' : ''}><td>${esc(h.days[d])}</td><td>${esc(h.opens)} – ${esc(h.closes[d])} Uhr</td></tr>`).join('')
    + `<tr class="hh-row"><td colspan="2">Happy Hour täglich bis ${esc(h.happyHourUntil)} Uhr</td></tr>`);
  R('hoursShort', hoursSummary());

  R('footerTabs', menu.tabs.map(t => `<li><a href="#speisekarte" data-open-tab="${esc(t.id)}">${esc(t.label)}</a></li>`).join(''));

  $('#f-persons').innerHTML = '<option value="" disabled selected>Bitte wählen</option>'
    + Array.from({ length: 12 }, (_, i) => `<option>${i + 1}</option>`).join('') + '<option value="mehr als 12">mehr als 12</option>';
}

function hoursSummary() {
  // Groups consecutive days with equal hours: "Mo–Do & So 14:00–01:00 · Fr–Sa 14:00–03:00"
  const h = site.hours, groups = [];
  DAYS.forEach(d => {
    const t = `${h.opens}–${h.closes[d]}`, last = groups.at(-1);
    if (last && last.t === t) last.days.push(d); else groups.push({ t, days: [d] });
  });
  if (groups.length > 2 && groups[0].t === groups.at(-1).t) { const end = groups.pop(); groups[0].days.unshift(...end.days); }
  const label = ds => (ds.length > 2 ? `${ds[0]}–${ds.at(-1)}` : ds.join(' & '));
  return groups.map(g => `${label(g.days)} ${g.t}`).join(' · ') + ' Uhr';
}

/* ---------- navigation ---------- */

function setupNav() {
  const header = $('#header'), toggle = $('.nav-toggle'), nav = $('#main-nav');
  const onScroll = () => header.classList.toggle('scrolled', scrollY > 30);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const setOpen = open => {
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open);
    toggle.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
    document.body.classList.toggle('locked', open);
    window.__lenis?.[open ? 'stop' : 'start']();
  };
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
  nav.addEventListener('click', e => { if (e.target.closest('a')) setOpen(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && nav.classList.contains('open')) { setOpen(false); toggle.focus(); } });

  // highlight the nav link of the section in view
  const navLinks = $$('.main-nav a[href^="#"]:not(.btn)');
  const io = new IntersectionObserver(entries => entries.forEach(en => {
    if (!en.isIntersecting) return;
    navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${en.target.id}`));
  }), { rootMargin: '-45% 0px -50% 0px' });
  navLinks.forEach(a => { const s = $(a.getAttribute('href')); if (s) io.observe(s); });

  // anchor links go through Lenis when it runs
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.hasAttribute('data-open-tab')) return;
    const target = a.getAttribute('href') === '#top' ? document.body : $(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    scrollToEl(target);
    history.replaceState(null, '', a.getAttribute('href'));
  });
}

// Where to scroll so a section sits in the middle of the free screen area (below the header,
// above the mobile action bar). Sections taller than that area start right under the header
// with their content, not with their empty top padding.
function targetY(el, extra = 0) {
  if (el === document.body) return 0;
  const header = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 72;
  const bar = $('.action-bar');
  const barH = bar && getComputedStyle(bar).display !== 'none' ? bar.offsetHeight + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--badge-h')) || 0) : 0;
  const free = innerHeight - header - barH;
  let top, bottom;
  if (el.tagName === 'SECTION') {
    // the visible content of the section: its in-flow children, without padding and background layers
    // (offsetTop, not getBoundingClientRect: reveal animations may still be moving the children)
    const kids = [...el.children].filter(c => getComputedStyle(c).position !== 'absolute' && c.offsetHeight);
    const secTop = el.getBoundingClientRect().top;
    top = Math.min(...kids.map(c => secTop + c.offsetTop));
    bottom = Math.max(...kids.map(c => secTop + c.offsetTop + c.offsetHeight));
  } else {
    const r = el.getBoundingClientRect();
    top = r.top; bottom = r.top + 1;
  }
  const h = bottom - top;
  const gap = h < free - 32 ? (free - h) / 2 : 16;
  return Math.max(0, top + scrollY - header - gap - extra);
}

function scrollToEl(el, extra = 0, retry = 3) {
  // Sections use content-visibility:auto, so heights above the target can change while scrolling.
  // After arriving, check the position and correct it.
  // (checked a moment later: sections passed on the way finish rendering only after the scroll stops)
  const settle = () => setTimeout(() => {
    if (el === document.body || retry <= 0) return;
    if (Math.abs(targetY(el, extra) - scrollY) > 4) scrollToEl(el, extra, retry - 1);
  }, 220);
  const y = targetY(el, extra);
  if (window.__lenis) window.__lenis.scrollTo(y, { duration: retry === 3 ? 1.2 : 0.4, onComplete: settle });
  else {
    const smooth = !reduceMotion && retry === 3;
    scrollTo({ top: y, behavior: smooth ? 'smooth' : 'auto' });
    if (smooth && 'onscrollend' in window) addEventListener('scrollend', settle, { once: true });
    else setTimeout(settle, smooth ? 900 : 60);
  }
}

/* ---------- menu ---------- */

let activeTab = 'shisha';

function setupMenu() {
  const tabs = $('[data-render="menuTabs"]');
  tabs.innerHTML = menu.tabs.map(t => `<button class="menu-tab" role="tab" type="button" id="tab-${t.id}" data-tab="${t.id}" aria-controls="menu-panel" aria-selected="false" tabindex="-1">${esc(t.label)}</button>`).join('');
  tabs.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { clearSearch(); selectTab(b.dataset.tab); } });
  tabs.addEventListener('keydown', e => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const ids = menu.tabs.map(t => t.id), i = ids.indexOf(activeTab);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
    e.preventDefault(); clearSearch(); selectTab(ids[n]); $(`#tab-${ids[n]}`).focus();
  });

  const search = $('#menu-search');
  let t;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => renderSearch(search.value), 120); });

  // any [data-open-tab] on the page opens that tab and scrolls to the menu
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-open-tab]');
    if (!b) return;
    e.preventDefault();
    $('#flavours-dialog').open && $('#flavours-dialog').close();
    clearSearch();
    selectTab(b.dataset.openTab);
    if (b.dataset.group) unfoldPanel();
    const group = b.dataset.group && $(`#grp-${b.dataset.group}`);
    scrollToEl(group || $('#speisekarte'), group ? 80 : 0);
  });

  const legend = menu.additives;
  $('[data-render="menuLegend"]').innerHTML = `<details>
    <summary>Zusatzstoffe &amp; Hinweise</summary>
    <ol>${Object.entries(legend).map(([k, v]) => `<li><sup>${esc(k)}</sup> ${esc(v)}</li>`).join('')}</ol>
    <p>${esc(menu.notes.allergens)}</p>
    <p>${esc(menu.notes.food)}</p>
    <p>${esc(menu.notes.drinks)}</p>
    <p>${esc(menu.halal)} Alle Preise in Euro inkl. MwSt.</p></details>`;

  selectTab(activeTab);
}

function selectTab(id) {
  const tab = menu.tabs.find(t => t.id === id) ?? menu.tabs[0];
  activeTab = tab.id;
  $$('.menu-tab').forEach(b => {
    const on = b.dataset.tab === tab.id;
    b.setAttribute('aria-selected', on);
    b.tabIndex = on ? 0 : -1;
    if (on) {
      // scroll only the tab strip horizontally, never the page
      const strip = b.parentElement;
      strip.scrollTo({ left: b.offsetLeft - (strip.clientWidth - b.offsetWidth) / 2, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  });
  const panel = $('#menu-panel');
  panel.setAttribute('aria-labelledby', `tab-${tab.id}`);
  panel.innerHTML = `
    ${tab.intro ? `<p class="menu-intro">${esc(tab.intro)}</p>` : ''}
    ${tab.age ? `<p class="menu-age"><span class="age-badge">18+</span> Ausschank alkoholischer Getränke nur ab 18 Jahren.</p>` : ''}
    <div class="menu-groups">${renderGroups(tab.groups)}</div>`;
  foldPanel();
  window.ScrollTrigger?.refresh();
}

// long categories start folded so the menu doesn't stretch down the page; one tap shows the rest
function foldPanel() {
  const panel = $('#menu-panel'), max = Math.round(Math.max(560, innerHeight * 0.85));
  unfoldPanel();
  if (panel.scrollHeight <= max * 1.5) return;
  panel.style.setProperty('--fold-h', `${max}px`);
  panel.classList.add('folded');
  const count = panel.querySelectorAll('.mi').length;
  panel.insertAdjacentHTML('afterend', `<button class="btn btn-ghost menu-more" type="button" aria-controls="menu-panel" aria-expanded="false">Alle ${count} Positionen anzeigen</button>`);
  $('.menu-more').addEventListener('click', () => { unfoldPanel(); window.ScrollTrigger?.refresh(); });
}
function unfoldPanel() {
  $('#menu-panel').classList.remove('folded');
  $('.menu-more')?.remove();
}

function renderGroups(groups, q = '') {
  // a group with one price for all items is a flavour list (shisha): shown as a compact grid
  const isFlav = g => g.price != null && g.items.every(i => i.price == null && !i.prices?.length && !i.priceText);
  return groups.map(g => `
    <section class="menu-group${isFlav(g) ? ' flav' : ''}${g.items.length > 8 ? ' long' : ''}" id="grp-${esc(g.id)}" aria-label="${esc(g.title)}">
      <div class="menu-group-head">
        <h3>${esc(g.title)}</h3>
        ${g.price != null ? `<span class="gprice">${euro(g.price)}${g.happyHour != null ? `<small>Happy Hour ${euro(g.happyHour)}</small>` : ''}</span>` : ''}
      </div>
      ${g.note ? `<p class="note">${esc(g.note)}</p>` : ''}
      <div class="mi-list">${g.items.map(i => renderItem(i, q)).join('')}</div>
      ${g.footnote ? `<p class="footnote">${esc(g.footnote)}</p>` : ''}
    </section>`).join('');
}

function renderItem(i, q) {
  const hl = s => {
    const safe = esc(s);
    if (!q) return safe;
    const n = norm(s), k = norm(q), at = n.indexOf(k);
    // only highlight when the normalised text maps 1:1 to the original
    if (at < 0 || n.length !== s.length) return safe;
    return esc(s.slice(0, at)) + '<mark>' + esc(s.slice(at, at + k.length)) + '</mark>' + esc(s.slice(at + k.length));
  };
  const codes = i.codes?.length ? `<sup title="Zusatzstoffe: ${i.codes.map(c => esc(menu.additives[c])).join(', ')}">${i.codes.join(',')}</sup>` : '';
  const tags = [i.tag && `<span class="tag">${esc(i.tag)}</span>`, i.check && '<span class="tag check" title="Angabe wird noch geprüft">wird geprüft</span>'].filter(Boolean).join('');
  const price = i.prices?.length
    ? `<div class="mi-prices">${i.prices.map(p => `<span><em>${esc(p.label)}</em>${euro(p.price)}</span>`).join('')}</div>`
    : `<div class="mi-price">${esc(priceOf(i))}</div>`;
  return `<div class="mi"><div class="mi-name">${hl(i.name)}${codes}${tags}</div>${price}${i.desc ? `<div class="mi-desc">${hl(i.desc)}</div>` : ''}</div>`;
}

function renderSearch(q) {
  q = q.trim();
  if (!q) { selectTab(activeTab); return; }
  const k = norm(q);
  const hits = menu.tabs.map(t => ({
    tab: t,
    groups: t.groups.map(g => ({ ...g, footnote: null, items: g.items.filter(i => norm(`${i.name} ${i.desc ?? ''} ${g.title}`).includes(k)) })).filter(g => g.items.length),
  })).filter(t => t.groups.length);
  const count = hits.reduce((a, t) => a + t.groups.reduce((b, g) => b + g.items.length, 0), 0);
  $('#menu-panel').innerHTML = count
    ? `<p class="sr-only">${count} Treffer</p>` + hits.map(h => `<p class="search-tab-title">${esc(h.tab.label)}</p><div class="menu-groups">${renderGroups(h.groups, q)}</div>`).join('')
    : `<p class="empty">Nichts gefunden für „${esc(q)}“. Versuch es mit einem anderen Begriff.</p>`;
  unfoldPanel();
  $$('.menu-tab').forEach(b => b.setAttribute('aria-selected', 'false'));
  window.ScrollTrigger?.refresh();
}
function clearSearch() { const s = $('#menu-search'); if (s.value) s.value = ''; }

function setupFlavours() {
  const dlg = $('#flavours-dialog');
  const shisha = menu.tabs.find(t => t.id === 'shisha');
  const body = $('#flavours-body');
  $$('[data-open-flavours]').forEach(b => b.addEventListener('click', () => {
    // rendered on first open to keep the initial page light
    if (!body.childElementCount) body.innerHTML = `${shisha.intro ? `<p class="menu-intro">${esc(shisha.intro)}</p>` : ''}<div class="menu-groups">${renderGroups(shisha.groups)}</div>`;
    dlg.showModal();
    window.__lenis?.stop();
  }));
  dlg.addEventListener('close', () => window.__lenis?.start());
  dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
}

/* ---------- reservation via WhatsApp ---------- */

function setupForm() {
  const form = $('#res-form'), err = $('#form-error');
  const { iso } = berlinNow();
  form.datum.min = iso;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const problems = [];
    $$('input, select', form).forEach(f => f.removeAttribute('aria-invalid'));
    const bad = (field, msg) => { form[field].setAttribute('aria-invalid', 'true'); problems.push(msg); };
    if (!data.name?.trim()) bad('name', 'Name');
    if (!data.datum) bad('datum', 'Datum');
    else if (data.datum < iso) bad('datum', 'Datum liegt in der Vergangenheit');
    if (!data.zeit) bad('zeit', 'Uhrzeit');
    else if (data.datum) {
      const day = DAYS[(new Date(data.datum + 'T12:00:00').getDay() + 6) % 7];
      const prev = DAYS[(DAYS.indexOf(day) + 6) % 7];
      const t = toMin(data.zeit), open = toMin(site.hours.opens), lateClose = toMin(site.hours.closes[prev]);
      if (t < open && t >= lateClose) bad('zeit', `Uhrzeit außerhalb der Öffnungszeiten (ab ${site.hours.opens} Uhr)`);
    }
    if (!data.personen) bad('personen', 'Personen');
    if (problems.length) {
      err.hidden = false;
      err.textContent = 'Bitte prüfen: ' + problems.join(', ') + '.';
      form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    err.hidden = true;
    const datum = new Date(data.datum + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    const text = site.contact.message
      .replace('{name}', data.name.trim()).replace('{datum}', datum).replace('{zeit}', `${data.zeit} Uhr`).replace('{personen}', data.personen);
    window.open(`${links().wa}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  });
}

/* ---------- map (loads Google only after a click) ---------- */

function setupMap() {
  $('#map-load').addEventListener('click', () => {
    const f = document.createElement('iframe');
    f.src = site.venue.mapEmbed;
    f.title = `Karte: ${site.venue.name}, ${site.venue.street}`;
    f.loading = 'lazy';
    f.referrerPolicy = 'no-referrer-when-downgrade';
    $('#map').replaceChildren(f);
  });
}

/* ---------- videos: muted, only while visible ---------- */

// Cocktail block: the video fades in when it scrolls into view, the drink name in the text keeps changing.
// Runs also with "reduce motion" (owner's request); the movement is slow and the video has no sound.
function setupCocktailShow() {
  const sec = $('#cocktails');
  new IntersectionObserver(([e], io) => { if (e.isIntersecting) { sec.classList.add('show'); io.disconnect(); } }, { threshold: 0.25 }).observe(sec);
  const word = $('.rot-word'), words = (word.dataset.words || '').split('|').filter(Boolean);
  let i = 0;
  if (words.length > 1) setInterval(() => {
    word.classList.add('out');
    setTimeout(() => { i = (i + 1) % words.length; word.textContent = words[i]; word.classList.remove('out'); }, 350);
  }, 2400);
}

function setupVideos() {
  const vids = $$('video.lazy-video');
  // poster frames load shortly before the video scrolls into view
  const near = new IntersectionObserver(entries => entries.forEach(({ target: v, isIntersecting }) => {
    if (!isIntersecting) return;
    near.unobserve(v);
    if (v.dataset.poster) v.poster = v.dataset.poster;
  }), { rootMargin: '600px 0px' });
  vids.forEach(v => near.observe(v));
  // short, silent loops: they play by themselves while visible (no controls), also with "reduce motion"
  const io = new IntersectionObserver(entries => entries.forEach(({ target: v, isIntersecting }) => {
    if (isIntersecting) {
      const s = $('source', v);
      if (s && !s.src) { s.src = s.dataset.src; v.load(); }
      v.muted = true;
      v.play().catch(() => {});
    } else v.pause();
  }), { threshold: 0.35 });
  vids.forEach(v => io.observe(v));
}

/* ---------- open / closed indicator ---------- */

function setupOpenState() {
  const el = $('[data-open-state]');
  if (!el) return;
  const { dayIdx, minutes } = berlinNow();
  const h = site.hours, open = toMin(h.opens);
  const close = d => { const c = toMin(h.closes[DAYS[d]]); return c <= open ? c + 1440 : c; };
  const prev = (dayIdx + 6) % 7;
  const isOpen = (minutes >= open && minutes < close(dayIdx)) || minutes + 1440 < close(prev);
  if (isOpen) {
    const closesAt = minutes >= open ? h.closes[DAYS[dayIdx]] : h.closes[DAYS[prev]];
    el.textContent = `Jetzt geöffnet · bis ${closesAt} Uhr`;
  } else {
    el.textContent = `Heute ab ${h.opens} Uhr geöffnet`;
    el.classList.add('closed');
  }
}

/* ---------- structured data ---------- */

function injectJsonLd() {
  const v = site.venue, h = site.hours, l = links();
  const dayNames = { Mo: 'Monday', Di: 'Tuesday', Mi: 'Wednesday', Do: 'Thursday', Fr: 'Friday', Sa: 'Saturday', So: 'Sunday' };
  const data = {
    '@context': 'https://schema.org',
    '@type': 'BarOrPub',
    name: v.name,
    url: site.seo.siteUrl,
    image: new URL('assets/img/og-fame-lounge.jpg', site.seo.siteUrl).href,
    logo: new URL('assets/img/logo-full.svg', site.seo.siteUrl).href,
    telephone: v.phoneLink,
    email: v.email,
    address: { '@type': 'PostalAddress', streetAddress: v.street, postalCode: v.zip, addressLocality: v.city, addressCountry: 'DE' },
    openingHoursSpecification: DAYS.map(d => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: dayNames[d], opens: h.opens, closes: h.closes[d] })),
    servesCuisine: ['Pizza', 'Pasta', 'Halal'],
    acceptsReservations: true,
    hasMenu: new URL('#speisekarte', site.seo.siteUrl).href,
    priceRange: '€€',
    sameAs: [l.instagram, l.facebook, l.google],
  };
  const s = document.createElement('script');
  s.type = 'application/ld+json';
  s.textContent = JSON.stringify(data);
  document.head.appendChild(s);
}

/* ---------- motion ---------- */

function splitWords(el) {
  const walk = node => {
    [...node.childNodes].forEach(n => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(part => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
          const w = document.createElement('span'); w.className = 'w';
          const inner = document.createElement('span'); inner.textContent = part;
          w.appendChild(inner); frag.appendChild(w);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1) walk(n);
    });
  };
  walk(el);
  return $$('.w > span', el);
}

const loadScript = src => new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = src; s.onload = res; s.onerror = rej;
  document.head.appendChild(s);
});

function setupMotion() {
  if (reduceMotion) return;
  const start = async () => {
    try {
      await loadScript('assets/vendor/gsap.min.js');
      await Promise.all([loadScript('assets/vendor/ScrollTrigger.min.js'), finePointer ? loadScript('assets/vendor/lenis.min.js') : null]);
      startMotion();
    } catch (e) {
      console.warn('Animationen deaktiviert', e);
    }
  };
  if (finePointer) { start(); return; }
  // touch devices: load and set up scroll animations on the first interaction, so loading stays light
  const events = ['touchstart', 'scroll', 'pointerdown'];
  const go = () => { events.forEach(t => removeEventListener(t, go)); start(); };
  events.forEach(t => addEventListener(t, go, { passive: true }));
}

function startMotion() {
  const { gsap, ScrollTrigger, Lenis } = window;
  gsap.registerPlugin(ScrollTrigger);
  // elements already on screen stay as they are (no flash when animations start late)
  const below = el => el.getBoundingClientRect().top > innerHeight * 0.9;

  if (Lenis && finePointer) {
    const lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 0.9 });
    window.__lenis = lenis;
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  // (the hero entrance is pure CSS, see .hero-copy in style.css)

  // Reveals use IntersectionObserver + CSS transitions, not ScrollTrigger: sections with
  // content-visibility change height while rendering, and an observer never misses an element.
  const reveal = (els, cls, stagger) => {
    const io = new IntersectionObserver(entries => {
      entries.filter(e => e.isIntersecting).forEach((e, i) => {
        const el = e.target;
        io.unobserve(el);
        el.style.setProperty('--d', `${i * stagger}s`);
        el.classList.add('rv-in');
        // afterwards drop the delay so hover effects react instantly
        setTimeout(() => { el.classList.remove(cls, 'rv-in'); el.style.removeProperty('--d'); }, 1600 + i * stagger * 1000);
      });
    }, { rootMargin: '0px 0px -6% 0px' });
    els.forEach(el => { el.classList.add(cls); io.observe(el); });
  };

  // headings: word by word
  const heads = $$('.split').filter(below);
  heads.forEach(h => splitWords(h).forEach((w, i) => w.style.setProperty('--w', `${i * 0.055}s`)));
  reveal(heads, 'rv-words', 0);

  // cards and tiles: one after another with a soft spring
  reveal($$('.usp-list li, .tier, .cat-tile, .dish, .promo, .chip, .rating-card, .hours, .contact-form-wrap').filter(below), 'rv', 0.09);

  // parallax: photos move slower than the text around them
  $$('[data-parallax]').forEach(el => {
    const speed = parseFloat(el.dataset.parallax);
    const trigger = el.closest('section') ?? el;
    gsap.fromTo(el, { yPercent: -speed * 40 }, {
      yPercent: speed * 40, ease: 'none',
      scrollTrigger: { trigger, start: trigger.classList.contains('hero') ? 'top top' : 'top bottom', end: 'bottom top', scrub: true },
    });
  });

  // rating counter
  $$('[data-count]').forEach(el => {
    const to = parseFloat(el.dataset.count), o = { v: 0 };
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      el.textContent = '0,0';
      gsap.to(o, {
        v: to, duration: 1.8, ease: 'power3.out',
        onUpdate: () => { el.textContent = o.v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); },
      });
    });
    io.observe(el);
  });

  // images inside content may change height once loaded
  if (document.readyState === 'complete') ScrollTrigger.refresh();
  else addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
  // content-visibility sections get their real height when they render: keep trigger positions in sync
  let t;
  new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => ScrollTrigger.refresh(), 200); }).observe($('main'));
}

/* ---------- Three.js smoke (only on capable devices) ---------- */

function setupSmoke() {
  const host = $('#smoke');
  if (!host || reduceMotion) return;
  const nav = navigator;
  if (nav.connection?.saveData) return;
  if ((nav.deviceMemory ?? 8) < 4 || (nav.hardwareConcurrency ?? 4) < 4) return;
  const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
  if (!gl) return;

  const small = innerWidth < 768;
  let smoke = null, started = false;
  const start = async () => {
    if (started) return;
    started = true;
    try {
      const { initSmoke } = await import('./smoke.js');
      smoke = initSmoke(host, { count: small ? 18 : 34 });
      requestAnimationFrame(() => { host.classList.add('ready'); host.parentElement.classList.add('smoke-ready'); });
      new IntersectionObserver(([e]) => (e.isIntersecting ? smoke.start() : smoke.stop())).observe($('.hero'));
      document.addEventListener('visibilitychange', () => (document.hidden ? smoke.stop() : smoke.start()));
    } catch (e) {
      console.warn('Rauch-Effekt deaktiviert', e);
    }
  };
  if (small) {
    // phones: wait for the first interaction so the page itself loads first
    const once = () => { removeEventListener('touchstart', once); removeEventListener('scroll', once); start(); };
    addEventListener('touchstart', once, { passive: true, once: true });
    addEventListener('scroll', once, { passive: true, once: true });
  } else {
    const idle = window.requestIdleCallback ?? (cb => setTimeout(cb, 1200));
    if (document.readyState === 'complete') idle(start, { timeout: 2500 });
    else addEventListener('load', () => idle(start, { timeout: 2500 }), { once: true });
  }
}
