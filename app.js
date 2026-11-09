const CATEGORY_ORDER = [
  "strategy", "procurement", "manufacturing", "logistics",
  "storage_distribution", "international_relations", "sustainability", "crm"
];

const CATEGORY_LABELS = {
  strategy: "Strategy",
  procurement: "Procurement",
  manufacturing: "Manufacturing & Lean",
  logistics: "Logistics",
  storage_distribution: "Storage & Distribution",
  international_relations: "Int'l Trade & Relations",
  sustainability: "Sustainability",
  crm: "Customer Relations"
};

const KIND_ORDER = ["research", "technology", "use_case"];
const KIND_LABELS = { research: "Research", technology: "Technology", use_case: "Use case" };

// NOTE: the data files sit at the top level of the repository (not in a data/ folder).
const NEWS_FILE = 'news.json';
const INNOVATION_FILE = 'innovation.json';

let items = [];
let innovation = [];
let view = 'news';
let state = { continent: "All", category: null, country: "All", q: "", kind: null };

const $ = id => document.getElementById(id);
const continentRow = $('continentRow');
const categoryRow = $('categoryRow');
const countrySelect = $('countrySelect');
const kindRow = $('kindRow');
const searchInput = $('searchInput');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '#');

function fmtDate(iso){
  const d = new Date(iso + "T00:00:00");
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

function matchesQuery(i){
  if (!state.q) return true;
  const hay = `${i.headline} ${i.summary} ${i.whyItMatters || ''}`.toLowerCase();
  return hay.includes(state.q);
}

/* ---------------- news view ---------------- */
function countryOptionsFor(continent){
  const pool = continent === "All" ? items : items.filter(i => i.continent === continent);
  return ["All", ...Array.from(new Set(pool.map(i => i.country))).sort()];
}

function renderContinentPills(){
  const continents = ["All", ...Array.from(new Set(items.map(i => i.continent))).sort()];
  continentRow.innerHTML = continents.map(c => {
    const count = c === "All" ? items.length : items.filter(i => i.continent === c).length;
    const active = state.continent === c ? 'active' : '';
    return `<button class="pill ${active}" data-continent="${esc(c)}">${esc(c)}<span class="count">${count}</span></button>`;
  }).join('');
}

function renderCategoryPills(){
  const present = CATEGORY_ORDER.filter(cat => items.some(i => i.category === cat));
  categoryRow.innerHTML = present.map(cat => {
    const count = items.filter(i => i.category === cat).length;
    const active = state.category === cat ? 'active' : '';
    return `<button class="pill ${active}" data-category="${cat}">${CATEGORY_LABELS[cat]}<span class="count">${count}</span></button>`;
  }).join('');
}

function renderCountrySelect(){
  const opts = countryOptionsFor(state.continent);
  if (!opts.includes(state.country)) state.country = "All";
  countrySelect.innerHTML = opts.map(c =>
    `<option value="${esc(c)}" ${c === state.country ? 'selected' : ''}>${c === "All" ? "All countries" : esc(c)}</option>`).join('');
}

function newsCard(i){
  const label = CATEGORY_LABELS[i.category] || i.category;
  return `
    <article class="item">
      <div class="item-top" style="border-top-color: var(--c-${esc(i.category)});">
        <span class="rubric" style="color: var(--c-${esc(i.category)});">${esc(label)}</span>
      </div>
      <div class="item-meta"><span>${esc(i.continent)} · ${esc(i.country)}</span><span>—</span><span>${fmtDate(i.date)}</span></div>
      <h2>${esc(i.headline)}</h2>
      <p>${esc(i.summary)}</p>
      <a class="source-link" href="${esc(safeUrl(i.sourceUrl))}" target="_blank" rel="noopener noreferrer">Read at ${esc(i.sourceName)}</a>
    </article>`;
}

function filteredNews(){
  return items.filter(i => {
    if (state.continent !== "All" && i.continent !== state.continent) return false;
    if (state.category && i.category !== state.category) return false;
    if (state.country !== "All" && i.country !== state.country) return false;
    return matchesQuery(i);
  }).sort((a, b) => new Date(b.date) - new Date(a.date));
}

/* ---------------- Future Watch view ---------------- */
function renderKindPills(){
  const present = KIND_ORDER.filter(k => innovation.some(i => i.kind === k));
  kindRow.innerHTML = ['all', ...present].map(k => {
    const isAll = k === 'all';
    const count = isAll ? innovation.length : innovation.filter(i => i.kind === k).length;
    const active = (isAll ? state.kind === null : state.kind === k) ? 'active' : '';
    return `<button class="pill ${active}" data-kind="${k}">${isAll ? 'All' : KIND_LABELS[k]}<span class="count">${count}</span></button>`;
  }).join('');
}

function innovationCard(i){
  const label = KIND_LABELS[i.kind] || i.kind;
  const badge = i.status === 'preprint' ? '<span class="badge">Preprint</span>' : '';
  return `
    <article class="item">
      <div class="item-top" style="border-top-color: var(--k-${esc(i.kind)});">
        <span class="rubric" style="color: var(--k-${esc(i.kind)});">${esc(label)}</span>
      </div>
      <div class="item-meta">${badge}<span>${esc(i.continent)} · ${esc(i.country)}</span><span>—</span><span>${fmtDate(i.date)}</span></div>
      <h2>${esc(i.headline)}</h2>
      <p>${esc(i.summary)}</p>
      <div class="why" style="border-left-color: var(--k-${esc(i.kind)});"><strong>Why it matters</strong>${esc(i.whyItMatters)}</div>
      <a class="source-link" href="${esc(safeUrl(i.sourceUrl))}" target="_blank" rel="noopener noreferrer">Read at ${esc(i.sourceName)}</a>
    </article>`;
}

function filteredInnovation(){
  return innovation.filter(i => {
    if (state.kind && i.kind !== state.kind) return false;
    return matchesQuery(i);
  }).sort((a, b) => new Date(b.date) - new Date(a.date));
}

/* ---------------- shared rendering ---------------- */
function render(){
  const isNews = view === 'news';
  $('newsControls').style.display = isNews ? '' : 'none';
  $('futureControls').style.display = isNews ? 'none' : '';
  $('futureIntro').style.display = isNews ? 'none' : '';
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));

  const list = isNews ? filteredNews() : filteredInnovation();
  const feed = $('feed');
  const empty = $('emptyState');
  const noun = isNews ? 'story' : 'item';
  $('resultCount').textContent = `${list.length} ${list.length === 1 ? noun : noun === 'story' ? 'stories' : 'items'}`;

  if (list.length === 0){
    feed.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = (!isNews && innovation.length === 0)
      ? "Future Watch fills in after the next scheduled update. The first batch of research and technology items will appear here."
      : "Nothing matches that combination. Try clearing a filter.";
    return;
  }
  empty.style.display = 'none';
  feed.innerHTML = list.map(isNews ? newsCard : innovationCard).join('');
}

function wireControls(){
  $('tabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    view = btn.dataset.view;
    render();
    window.scrollTo({ top: 0 });
  });

  continentRow.addEventListener('click', e => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    state.continent = btn.dataset.continent;
    renderContinentPills();
    renderCountrySelect();
    render();
  });

  categoryRow.addEventListener('click', e => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    state.category = state.category === btn.dataset.category ? null : btn.dataset.category;
    renderCategoryPills();
    render();
  });

  kindRow.addEventListener('click', e => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    state.kind = btn.dataset.kind === 'all' ? null : btn.dataset.kind;
    renderKindPills();
    render();
  });

  countrySelect.addEventListener('change', () => {
    state.country = countrySelect.value;
    render();
  });

  searchInput.addEventListener('input', () => {
    state.q = searchInput.value.trim().toLowerCase();
    render();
  });
}

async function loadJSON(path){
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return res.json();
}

async function init(){
  try{
    items = await loadJSON(NEWS_FILE);
  } catch(err){
    $('emptyState').style.display = 'block';
    $('emptyState').textContent =
      "Couldn't load the news data. If you're opening this file directly from your computer, that's expected: browsers block local file loading. View it through your GitHub Pages link instead.";
    $('updatedLabel').textContent = '';
    return;
  }
  try{
    innovation = await loadJSON(INNOVATION_FILE);   // may not exist until the first update runs
  } catch(err){
    innovation = [];
  }

  const latest = [...items, ...innovation].reduce((max, i) => (i.date > max ? i.date : max), '');
  $('updatedLabel').textContent = latest ? `Latest story: ${fmtDate(latest)}` : '';
  $('newsTabCount').textContent = items.length;
  $('futureTabCount').textContent = innovation.length;

  renderContinentPills();
  renderCategoryPills();
  renderCountrySelect();
  renderKindPills();
  wireControls();
  render();
}

init();
