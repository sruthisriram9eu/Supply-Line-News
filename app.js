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
        <span class="tag tag-${i.category}">${CATEGORY_LABELS[i.category] || i.category}</span>
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
