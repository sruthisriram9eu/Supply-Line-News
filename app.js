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

// Simple hand-drawn line icons per category — no stock photos, no AI images,
// no copyright concerns, loads instantly. White strokes on a colored circle.
const CATEGORY_ICONS = {
  strategy: '<path d="M3 17l5-5 4 4 7-8" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 8h4v4" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  procurement: '<path d="M6 7V5a3 3 0 016 0v2M4 7h12l-1 12H5L4 7z" stroke="white" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
  manufacturing: '<path d="M3 20V10l5 3v-3l5 3V6l5 3v11H3z" stroke="white" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
  logistics: '<path d="M3 16V8h8v8" stroke="white" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M11 11h4l3 3v2h-7" stroke="white" stroke-width="1.6" fill="none" stroke-linejoin="round"/><circle cx="7" cy="18" r="1.6" stroke="white" stroke-width="1.4" fill="none"/><circle cx="17" cy="18" r="1.6" stroke="white" stroke-width="1.4" fill="none"/>',
  storage_distribution: '<path d="M4 20V10l8-5 8 5v10H4z" stroke="white" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M4 10l8 5 8-5" stroke="white" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
  international_relations: '<circle cx="12" cy="12" r="8" stroke="white" stroke-width="1.6" fill="none"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16" stroke="white" stroke-width="1.4" fill="none"/>',
  sustainability: '<path d="M4 20c8 0 14-6 14-14-8 0-14 6-14 14z" stroke="white" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M4 20c2-5 5-8 9-10" stroke="white" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
  crm: '<circle cx="9" cy="9" r="3" stroke="white" stroke-width="1.5" fill="none"/><circle cx="16" cy="11" r="2.4" stroke="white" stroke-width="1.4" fill="none"/><path d="M4 19c0-3 2.5-5 5-5s5 2 5 5" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M13.5 15.2c2.3.3 4 2 4 3.8" stroke="white" stroke-width="1.4" fill="none" stroke-linecap="round"/>'
};

let items = [];
let state = { continent: "All", category: null, country: "All", q: "" };

const continentRow = document.getElementById('continentRow');
const categoryRow = document.getElementById('categoryRow');
const countrySelect = document.getElementById('countrySelect');
const searchInput = document.getElementById('searchInput');
const updatedLabel = document.getElementById('updatedLabel');

function countryOptionsFor(continent){
  const pool = continent === "All" ? items : items.filter(i => i.continent === continent);
  return ["All", ...Array.from(new Set(pool.map(i => i.country))).sort()];
}

function renderContinentPills(){
  const continents = ["All", ...Array.from(new Set(items.map(i => i.continent))).sort()];
  continentRow.innerHTML = continents.map(c => {
    const count = c === "All" ? items.length : items.filter(i => i.continent === c).length;
    const active = state.continent === c ? 'active' : '';
    return `<button class="pill ${active}" data-continent="${c}">${c}<span class="count">${count}</span></button>`;
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
  countrySelect.innerHTML = opts.map(c => `<option value="${c}" ${c===state.country?'selected':''}>${c === "All" ? "All countries" : c}</option>`).join('');
}

function fmtDate(iso){
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderFeed(){
  const filtered = items.filter(i => {
    if (state.continent !== "All" && i.continent !== state.continent) return false;
    if (state.category && i.category !== state.category) return false;
    if (state.country !== "All" && i.country !== state.country) return false;
    if (state.q && !(i.headline.toLowerCase().includes(state.q) || i.summary.toLowerCase().includes(state.q))) return false;
    return true;
  }).sort((a,b) => new Date(b.date) - new Date(a.date));

  const feed = document.getElementById('feed');
  const empty = document.getElementById('emptyState');
  const resultCount = document.getElementById('resultCount');

  resultCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'story' : 'stories'}`;

  if (filtered.length === 0){
    feed.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  feed.innerHTML = filtered.map(i => `
    <article class="item" style="border-left-color: var(--c-${i.category});">
      <div class="item-meta">
        <span class="tag-icon" style="background: var(--c-${i.category});">
          <svg viewBox="0 0 24 24">${CATEGORY_ICONS[i.category] || ''}</svg>
        </span>
        <span class="tag" style="color: var(--c-${i.category});">${CATEGORY_LABELS[i.category] || i.category}</span>
        <span class="geo">${i.continent} · ${i.country}</span>
        <span class="date">${fmtDate(i.date)}</span>
      </div>
      <h2>${i.headline}</h2>
      <p>${i.summary}</p>
      <a class="source-link" href="${i.sourceUrl}" target="_blank" rel="noopener noreferrer">Read at ${i.sourceName}</a>
    </article>
  `).join('');
}

function wireControls(){
  continentRow.addEventListener('click', e => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    state.continent = btn.dataset.continent;
    renderContinentPills();
    renderCountrySelect();
    renderFeed();
  });

  categoryRow.addEventListener('click', e => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    const val = btn.dataset.category;
    state.category = state.category === val ? null : val;
    renderCategoryPills();
    renderFeed();
  });

  countrySelect.addEventListener('change', () => {
    state.country = countrySelect.value;
    renderFeed();
  });

  searchInput.addEventListener('input', () => {
    state.q = searchInput.value.trim().toLowerCase();
    renderFeed();
  });
}

async function init(){
  try{
    const res = await fetch('data/news.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Could not load news.json');
    items = await res.json();
    const latest = items.reduce((max, i) => i.date > max ? i.date : max, items[0]?.date || '');
    updatedLabel.textContent = latest ? `Latest story: ${fmtDate(latest)}` : '';
  } catch(err){
    document.getElementById('feed').innerHTML = '';
    document.getElementById('emptyState').style.display = 'block';
    document.getElementById('emptyState').textContent =
      "Couldn't load the news data. If you're opening this file directly from your computer, that's expected — browsers block local file loading. View it through its GitHub Pages link instead.";
    updatedLabel.textContent = '';
    return;
  }
  renderContinentPills();
  renderCategoryPills();
  renderCountrySelect();
  wireControls();
  renderFeed();
}

init();
