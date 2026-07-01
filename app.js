const restaurants = window.BUCKET_LIST_RESTAURANTS || [];
const cityMarkers = window.BUCKET_LIST_CITY_MARKERS || [];
const STORAGE_KEY = 'bucketListRestaurantsAppState.v5';
const URL_STATE_KEYS = ['q','sort','compact','tier','city','country','continent','type','booking','dress','english','dietary'];
const CLUSTER_ZOOM_THRESHOLD = 5;

const els = {
  search: document.getElementById('searchInput'),
  tier: document.getElementById('tierFilter'),
  city: document.getElementById('cityFilter'),
  country: document.getElementById('countryFilter'),
  continent: document.getElementById('continentFilter'),
  type: document.getElementById('typeFilter'),
  booking: document.getElementById('bookingFilter'),
  dress: document.getElementById('dressFilter'),
  english: document.getElementById('englishFilter'),
  dietary: document.getElementById('dietaryFilter'),
  sort: document.getElementById('sortFilter'),
  reset: document.getElementById('resetBtn'),
  cardsList: document.getElementById('cardsList'),
  cards: Array.from(document.querySelectorAll('.restaurant-card')),
  hotspots: Array.from(document.querySelectorAll('.hotspot')),
  cityCards: Array.from(document.querySelectorAll('.city-card')),
  visible: document.getElementById('summaryVisible'),
  splus: document.getElementById('summarySPlus'),
  s: document.getElementById('summaryS'),
  sminus: document.getElementById('summarySMinus'),
  unranked: document.getElementById('summaryUnranked'),
  citiesSummary: document.getElementById('summaryCities'),
  empty: document.getElementById('emptyState'),
  activeFilters: document.getElementById('activeFilterChips'),
  compactModeBtn: document.getElementById('compactModeBtn'),
  shareStateBtn: document.getElementById('shareStateBtn'),
  appStatus: document.getElementById('appStatus'),
  mapTitle: document.getElementById('mapDetailTitle'),
  mapMeta: document.getElementById('mapDetailMeta'),
  mapBody: document.getElementById('mapDetailBody'),
  openVisibleCities: document.getElementById('openVisibleCities'),
  switchToCityTab: document.getElementById('switchToCityTab'),
  leafletMap: document.getElementById('leafletMap'),
  fitMapBtn: document.getElementById('fitMapBtn'),
  zoomSelectedMapBtn: document.getElementById('zoomSelectedMapBtn'),
  mapCityZoomButtons: document.getElementById('mapCityZoomButtons'),
  graphicArea: document.getElementById('graphicArea'),
  auditSummary: document.getElementById('auditSummary'),
  auditIssues: document.getElementById('auditIssues'),
  auditRecheckBtn: document.getElementById('auditRecheckBtn'),
  detailDrawer: document.getElementById('restaurantDetailDrawer'),
  detailContent: document.getElementById('restaurantDetailContent')
};

const defaultState = Object.freeze({
  search: '',
  filters: Object.freeze({tier:[], city:[], country:[], continent:[], type:[], booking:[], dress:[], english:[], dietary:[]}),
  sort: 'rank',
  compact: false
});
let appState = cloneDefaultState();
let visibleRestaurants = restaurants.slice();
let restaurantMap = null;
let markerLayer = null;
let clusterLayer = null;
let leafletMarkers = [];
let selectedMapCity = '';
let mapHasBeenShown = false;
let hasHydratedFromSavedState = false;
let lastValidationIssues = [];
const memoryStorage = new Map();
const safeStorage = {
  get(key) {
    try { return window.localStorage?.getItem(key) ?? memoryStorage.get(key) ?? null; }
    catch (error) { return memoryStorage.get(key) ?? null; }
  },
  set(key, value) {
    memoryStorage.set(key, value);
    try { window.localStorage?.setItem(key, value); return true; }
    catch (error) { console.warn('Falling back to in-memory app state:', error); return false; }
  },
  remove(key) {
    memoryStorage.delete(key);
    try { window.localStorage?.removeItem(key); }
    catch (error) {}
  }
};

const filterConfigs = [
  {key:'tier', label:'Tier', el:els.tier, values:item => [item.tier]},
  {key:'city', label:'City', el:els.city, values:item => [item.city]},
  {key:'country', label:'Country', el:els.country, values:item => [item.country]},
  {key:'continent', label:'Continent', el:els.continent, values:item => [item.continent]},
  {key:'type', label:'Cuisine', el:els.type, values:item => (item.cuisine_categories && item.cuisine_categories.length ? item.cuisine_categories : [item.type_group || item.type])},
  {key:'booking', label:'Booking', el:els.booking, values:item => [item.booking_difficulty]},
  {key:'dress', label:'Dress', el:els.dress, values:item => [item.dress_code]},
  {key:'english', label:'English', el:els.english, values:item => [item.english_friendliness]},
  {key:'dietary', label:'Dietary', el:els.dietary, values:item => [item.dietary_flexibility]}
].filter(cfg => cfg.el);

const configByKey = new Map(filterConfigs.map(cfg => [cfg.key, cfg]));
const restaurantByRank = new Map(restaurants.map(r => [String(r.rank), r]));
const restaurantById = new Map(restaurants.map(r => [String(r.id || r.rank), r]));
const cardByRank = new Map();
const cardById = new Map();
const hotspotByRank = new Map();
const hotspotById = new Map();
const cityLinkCache = new Map();

function cloneDefaultState() {
  return {
    search: defaultState.search,
    filters: Object.fromEntries(Object.entries(defaultState.filters).map(([key, values]) => [key, values.slice()])),
    sort: defaultState.sort,
    compact: defaultState.compact
  };
}
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function googleMapsSearchLink(query) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
}
function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function slugify(value) {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}
function unique(values) {
  return [...new Set((values || []).filter(value => value != null && String(value).trim()).map(value => String(value).trim()))];
}
function debounce(fn, delay = 120) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
function setStatus(message, persistent = false) {
  if (!els.appStatus) return;
  els.appStatus.textContent = message || '';
  if (!persistent && message) {
    clearTimeout(setStatus._timer);
    setStatus._timer = setTimeout(() => {
      const suffix = lastValidationIssues.length ? 'Data check warnings: ' + lastValidationIssues.length : 'Data check OK';
      els.appStatus.textContent = suffix + ' • saved locally';
    }, 1600);
  }
}

function prepareRestaurantData() {
  const seenIds = new Set();
  restaurants.forEach(r => {
    if (!r.id) r.id = slugify([r.name, r.city, r.rank].filter(Boolean).join(' '));
    if (seenIds.has(r.id)) r.id = slugify([r.name, r.city, r.rank].filter(Boolean).join(' '));
    seenIds.add(r.id);
    restaurantById.set(String(r.id), r);
    restaurantByRank.set(String(r.rank), r);
    r.cuisine_categories = Array.isArray(r.cuisine_categories) && r.cuisine_categories.length ? r.cuisine_categories : unique(String(r.type_group || r.type || '').split('|'));
    r.price_sort_value = getPriceSortValueFromData(r);
    r.search_blob = normalizeSearchText([
      r.id, r.rank, r.name, r.city, r.country, r.continent, r.tier, r.type, r.type_group, r.description,
      r.booking_difficulty, r.booking_note, r.price_label, r.price_note, r.price_original,
      r.dress_code, r.dress_code_note, r.english_friendliness, r.english_friendliness_note,
      r.dietary_flexibility, r.dietary_flexibility_note,
      ...(r.cuisine_categories || []), r.search_text
    ].filter(Boolean).join(' '));
    r.search_tokens = new Set(r.search_blob.split(/[^a-z0-9]+/).filter(Boolean));
  });
}
function getPriceSortValueFromData(item) {
  const direct = Number(item.price_sort_usd);
  if (Number.isFinite(direct) && direct > 0 && direct < 999999) return direct;
  const fallback = Number(String(item.price_label || '').replace(/[^0-9.]/g, ''));
  if (Number.isFinite(fallback) && fallback > 0 && fallback < 999999) return fallback;
  return Number.POSITIVE_INFINITY;
}
function cacheDomLookups() {
  els.cards.forEach(card => {
    const rank = card.dataset.rank;
    const restaurant = restaurantByRank.get(String(rank));
    if (restaurant) {
      card.dataset.restaurantId = restaurant.id;
      card.id = 'restaurant-' + restaurant.id;
      cardById.set(restaurant.id, card);
      const actions = card.querySelector('.actions');
      if (actions && !actions.querySelector('[data-detail-rank]')) {
        const detailButton = document.createElement('button');
        detailButton.type = 'button';
        detailButton.className = 'action detail-button';
        detailButton.dataset.detailRank = String(rank);
        detailButton.textContent = 'Details';
        actions.appendChild(detailButton);
      }
    }
    if (rank) cardByRank.set(String(rank), card);
  });
  els.hotspots.forEach(hotspot => {
    const rank = hotspot.dataset.rank;
    const restaurant = restaurantByRank.get(String(rank));
    if (restaurant) {
      hotspot.dataset.restaurantId = restaurant.id;
      hotspotById.set(restaurant.id, hotspot);
    }
    if (rank) hotspotByRank.set(String(rank), hotspot);
  });
  els.cityCards.forEach(card => {
    const city = card.dataset.cityCard;
    if (!city) return;
    const links = Array.from(card.querySelectorAll('.mini-link')).map(link => {
      const rankMatch = link.textContent.match(/#(\d+)/);
      const rank = rankMatch ? rankMatch[1] : '';
      const restaurant = restaurantByRank.get(String(rank));
      link.dataset.rank = rank;
      if (restaurant) link.dataset.restaurantId = restaurant.id;
      return {link, rank, id: restaurant?.id || ''};
    });
    cityLinkCache.set(city, links);
  });
}
function valuesForFilter(item, key) {
  const cfg = configByKey.get(key);
  if (!cfg) return [];
  return unique(cfg.values(item));
}
function selectedValuesForFilter(cfg) {
  return (appState.filters[cfg.key] || []).slice();
}
function setSelectedValues(cfg, values) {
  appState.filters[cfg.key] = unique(values);
  Array.from(cfg.el.options).forEach(option => {
    option.selected = !!option.value && appState.filters[cfg.key].includes(option.value);
  });
  updateMultiFilterUI(cfg);
}
function syncFilterSelectOptionsFromData() {
  filterConfigs.forEach(cfg => {
    const placeholder = (cfg.el.querySelector('option[value=""]') || cfg.el.options[0] || {}).textContent || cfg.label || 'All';
    const values = unique(restaurants.flatMap(item => valuesForFilter(item, cfg.key)));
    const existingOrder = Array.from(cfg.el.options).map(option => option.value).filter(Boolean);
    const existingSet = new Set(existingOrder);
    const ordered = existingOrder.filter(value => values.includes(value)).concat(values.filter(value => !existingSet.has(value)).sort((a, b) => a.localeCompare(b, undefined, {sensitivity:'base'})));
    cfg.el.innerHTML = '<option value="">' + escapeHTML(placeholder) + '</option>' + ordered.map(value => '<option value="' + escapeHTML(value) + '">' + escapeHTML(value) + '</option>').join('');
  });
}
function readStateFromControls() {
  const next = cloneDefaultState();
  next.search = els.search ? els.search.value.trim() : '';
  next.sort = els.sort ? els.sort.value || 'rank' : 'rank';
  next.compact = !!(els.cardsList && els.cardsList.classList.contains('compact')) || !!appState.compact;
  filterConfigs.forEach(cfg => {
    next.filters[cfg.key] = Array.from(cfg.el.selectedOptions || []).map(option => option.value).filter(Boolean);
  });
  appState = sanitizeState(next);
  return appState;
}
function sanitizeState(state) {
  const clean = cloneDefaultState();
  clean.search = String(state?.search || '').trim();
  clean.sort = state?.sort && els.sort && Array.from(els.sort.options).some(opt => opt.value === state.sort) ? state.sort : 'rank';
  clean.compact = !!state?.compact;
  filterConfigs.forEach(cfg => {
    const allowed = new Set(Array.from(cfg.el.options).map(option => option.value).filter(Boolean));
    clean.filters[cfg.key] = unique((state?.filters?.[cfg.key] || []).filter(value => allowed.has(value)));
  });
  return clean;
}
function applyStateToControls(state) {
  appState = sanitizeState(state);
  if (els.search) els.search.value = appState.search;
  if (els.sort) els.sort.value = appState.sort;
  filterConfigs.forEach(cfg => {
    Array.from(cfg.el.options).forEach(option => {
      option.selected = !!option.value && appState.filters[cfg.key].includes(option.value);
    });
  });
  updateCompactMode();
  updateAllMultiFilterUIs();
}
function stateHasURLParams() {
  const params = new URLSearchParams(window.location.search);
  return URL_STATE_KEYS.some(key => params.has(key));
}
function loadStateFromURL() {
  const params = new URLSearchParams(window.location.search);
  const state = cloneDefaultState();
  state.search = params.get('q') || '';
  state.sort = params.get('sort') || 'rank';
  state.compact = params.get('compact') === '1';
  filterConfigs.forEach(cfg => {
    state.filters[cfg.key] = params.getAll(cfg.key);
  });
  return sanitizeState(state);
}
function loadStateFromStorage() {
  try {
    const raw = safeStorage.get(STORAGE_KEY);
    if (!raw) return null;
    return sanitizeState(JSON.parse(raw));
  } catch (error) {
    console.warn('Could not load saved app state:', error);
    return null;
  }
}
function persistState() {
  try {
    safeStorage.set(STORAGE_KEY, JSON.stringify(appState));
  } catch (error) {
    console.warn('Could not save app state:', error);
  }
}
function writeStateToURL() {
  try {
    const url = new URL(window.location.href);
    URL_STATE_KEYS.forEach(key => url.searchParams.delete(key));
    if (appState.search) url.searchParams.set('q', appState.search);
    if (appState.sort && appState.sort !== 'rank') url.searchParams.set('sort', appState.sort);
    if (appState.compact) url.searchParams.set('compact', '1');
    filterConfigs.forEach(cfg => appState.filters[cfg.key].forEach(value => url.searchParams.append(cfg.key, value)));
    history.replaceState(null, '', url.toString());
  } catch (error) {
    // Some file:// contexts can block history updates. The app still works and localStorage still persists.
  }
}
function stateForDisplay() {
  const params = new URLSearchParams();
  if (appState.search) params.set('q', appState.search);
  if (appState.sort && appState.sort !== 'rank') params.set('sort', appState.sort);
  if (appState.compact) params.set('compact', '1');
  filterConfigs.forEach(cfg => appState.filters[cfg.key].forEach(value => params.append(cfg.key, value)));
  const url = new URL(window.location.href);
  URL_STATE_KEYS.forEach(key => url.searchParams.delete(key));
  params.forEach((value, key) => url.searchParams.append(key, value));
  return url.toString();
}

function matchesFilters(item, ignoreKey) {
  const q = normalizeSearchText(appState.search);
  if (ignoreKey !== 'search' && q) {
    const tokens = q.split(/[^a-z0-9]+/).filter(Boolean);
    if (tokens.length && !tokens.every(token => item.search_blob.includes(token) || item.search_tokens?.has(token))) return false;
  }
  for (const cfg of filterConfigs) {
    if (cfg.key === ignoreKey) continue;
    const selected = selectedValuesForFilter(cfg);
    if (!selected.length) continue;
    const itemValues = valuesForFilter(item, cfg.key);
    if (cfg.mode === 'avoid') {
      if (selected.some(value => itemValues.includes(value))) return false;
    } else if (cfg.mode === 'all') {
      if (!selected.every(value => itemValues.includes(value))) return false;
    } else if (!selected.some(value => itemValues.includes(value))) {
      return false;
    }
  }
  return true;
}
function updateMultiFilterUI(cfg) {
  const control = cfg.multiControl;
  if (!control) return;
  const selected = selectedValuesForFilter(cfg);
  const button = control.querySelector('.multi-filter-button');
  const countLabel = control.querySelector('.multi-filter-count');
  const empty = control.querySelector('.multi-filter-empty');
  const visibleOptions = [];
  control.querySelectorAll('.multi-filter-option').forEach(label => {
    const value = label.dataset.value;
    const option = Array.from(cfg.el.options).find(opt => opt.value === value);
    const isHidden = !option || option.hidden || option.disabled;
    label.classList.toggle('hidden', isHidden);
    const checkbox = label.querySelector('input[type="checkbox"]');
    if (checkbox) {
      checkbox.checked = selected.includes(value);
      checkbox.disabled = isHidden;
    }
    if (!isHidden) visibleOptions.push(value);
  });
  if (empty) empty.classList.toggle('show', visibleOptions.length === 0);
  const selectedLabels = selected.map(value => {
    const option = Array.from(cfg.el.options).find(opt => opt.value === value);
    return option ? option.textContent.trim() : value;
  });
  if (button) {
    if (!selectedLabels.length) button.textContent = cfg.placeholder;
    else if (selectedLabels.length <= 2) button.textContent = selectedLabels.join(', ');
    else button.textContent = selectedLabels.length + ' selected';
  }
  if (countLabel) countLabel.textContent = selectedLabels.length ? selectedLabels.length + ' selected' : 'Any';
}
function updateAllMultiFilterUIs() {
  filterConfigs.forEach(updateMultiFilterUI);
}
function updateFilterOptions() {
  for (let pass = 0; pass < 3; pass++) {
    let cleared = false;
    for (const cfg of filterConfigs) {
      const selected = selectedValuesForFilter(cfg);
      Array.from(cfg.el.options).forEach(option => {
        if (!option.value) {
          option.hidden = false;
          option.disabled = false;
          option.style.display = '';
          return;
        }
        let possible;
        if (cfg.mode === 'all') {
          const requiredValues = selected.filter(value => value !== option.value).concat(option.value);
          possible = restaurants.some(item => matchesFilters(item, cfg.key) && requiredValues.every(value => valuesForFilter(item, cfg.key).includes(value)));
        } else {
          possible = restaurants.some(item => matchesFilters(item, cfg.key) && valuesForFilter(item, cfg.key).includes(option.value));
        }
        option.hidden = !possible;
        option.style.display = possible ? '' : 'none';
        option.disabled = !possible;
        if (!possible && option.selected) {
          option.selected = false;
          cleared = true;
        }
      });
    }
    if (cleared) readStateFromControls();
    if (!cleared) break;
  }
  updateAllMultiFilterUIs();
}
function sortItems(items) {
  const tierOrder = {'S+': 0, 'S': 1, 'S-': 2, 'Unranked': 3};
  const mode = appState.sort || 'rank';
  const byText = key => (a, b) => String(a[key] || '').localeCompare(String(b[key] || ''), undefined, {sensitivity:'base'}) || a.rank - b.rank;
  const sorted = items.slice();
  if (mode === 'name') sorted.sort(byText('name'));
  else if (mode === 'city') sorted.sort((a, b) => a.city.localeCompare(b.city, undefined, {sensitivity:'base'}) || a.rank - b.rank);
  else if (mode === 'country') sorted.sort((a, b) => a.country.localeCompare(b.country, undefined, {sensitivity:'base'}) || a.city.localeCompare(b.city, undefined, {sensitivity:'base'}) || a.rank - b.rank);
  else if (mode === 'tier') sorted.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || a.rank - b.rank);
  else if (mode === 'description') sorted.sort(byText('type'));
  else if (mode === 'difficulty') sorted.sort((a, b) => (b.booking_score || 0) - (a.booking_score || 0) || a.rank - b.rank);
  else if (mode === 'price') sorted.sort((a, b) => a.price_sort_value - b.price_sort_value || a.rank - b.rank);
  else if (mode === 'dress') sorted.sort(byText('dress_code'));
  else if (mode === 'english') sorted.sort((a, b) => (b.english_score || 0) - (a.english_score || 0) || a.rank - b.rank);
  else if (mode === 'dietary') sorted.sort((a, b) => (b.dietary_flexibility_score || 0) - (a.dietary_flexibility_score || 0) || a.rank - b.rank);
  else sorted.sort((a, b) => a.rank - b.rank);
  return sorted;
}
function reorderCards(visibleSet) {
  if (!els.cardsList) return;
  const fragment = document.createDocumentFragment();
  visibleRestaurants.concat(restaurants.filter(r => !visibleSet.has(String(r.rank))).sort((a, b) => a.rank - b.rank)).forEach(r => {
    const card = cardByRank.get(String(r.rank));
    if (card) fragment.appendChild(card);
  });
  els.cardsList.appendChild(fragment);
}
function renderActiveFilterChips() {
  if (!els.activeFilters) return;
  const chips = [];
  if (appState.search) chips.push({type:'search', key:'search', value:'Search: ' + appState.search});
  filterConfigs.forEach(cfg => {
    (appState.filters[cfg.key] || []).forEach(value => chips.push({type:'filter', key:cfg.key, value:cfg.label + ': ' + value, raw:value}));
  });
  if (appState.sort && appState.sort !== 'rank') {
    const sortLabel = els.sort?.selectedOptions?.[0]?.textContent?.replace(/^Sort:\s*/,'') || appState.sort;
    chips.push({type:'sort', key:'sort', value:'Sort: ' + sortLabel});
  }
  if (appState.compact) chips.push({type:'compact', key:'compact', value:'Compact list'});
  if (!chips.length) {
    els.activeFilters.innerHTML = '<span class="active-filter-empty">No active filters</span>';
    return;
  }
  els.activeFilters.innerHTML = chips.map(chip => '<button type="button" class="active-filter-chip" data-chip-type="' + escapeHTML(chip.type) + '" data-chip-key="' + escapeHTML(chip.key) + '" data-chip-value="' + escapeHTML(chip.raw || '') + '">' + escapeHTML(chip.value) + ' <span aria-hidden="true">×</span></button>').join('');
}
function updateCompactMode() {
  if (!els.cardsList) return;
  els.cardsList.classList.toggle('compact', !!appState.compact);
  if (els.compactModeBtn) {
    els.compactModeBtn.setAttribute('aria-pressed', appState.compact ? 'true' : 'false');
    els.compactModeBtn.textContent = appState.compact ? 'Full cards' : 'Compact list';
  }
}
function applyFilters(options = {}) {
  readStateFromControls();
  updateFilterOptions();
  readStateFromControls();
  visibleRestaurants = sortItems(restaurants.filter(item => matchesFilters(item)));
  const visibleSet = new Set(visibleRestaurants.map(r => String(r.rank)));
  const visibleCitySet = new Set(visibleRestaurants.map(r => r.city));
  reorderCards(visibleSet);
  const counts = {'S+':0, 'S':0, 'S-':0, 'Unranked':0};
  visibleRestaurants.forEach(r => { counts[r.tier] = (counts[r.tier] || 0) + 1; });
  els.cards.forEach(card => card.classList.toggle('hidden', !visibleSet.has(card.dataset.rank)));
  els.hotspots.forEach(hs => hs.classList.toggle('hidden', !visibleSet.has(hs.dataset.rank)));
  els.cityCards.forEach(card => {
    const city = card.dataset.cityCard;
    const cityVisible = visibleCitySet.has(city);
    card.classList.toggle('hidden', !cityVisible);
    const links = cityLinkCache.get(city) || [];
    links.forEach(({link, rank}) => { link.style.display = visibleSet.has(String(rank)) ? '' : 'none'; });
  });
  if (els.visible) els.visible.textContent = visibleRestaurants.length + ' shown';
  if (els.splus) els.splus.textContent = 'S+: ' + counts['S+'];
  if (els.s) els.s.textContent = 'S: ' + counts['S'];
  if (els.sminus) els.sminus.textContent = 'S-: ' + counts['S-'];
  if (els.unranked) els.unranked.textContent = 'Unranked: ' + counts['Unranked'];
  if (els.citiesSummary) els.citiesSummary.textContent = visibleCitySet.size + ' ' + (visibleCitySet.size === 1 ? 'city' : 'cities');
  if (els.empty) els.empty.classList.toggle('show', visibleRestaurants.length === 0);
  updateCompactMode();
  renderActiveFilterChips();
  renderMapCityZoomButtons();
  updateMap();
  if (options.persist !== false) persistState();
  if (options.updateUrl !== false) writeStateToURL();
  if (hasHydratedFromSavedState && options.status !== false) setStatus('Updated');
}
const scheduleApplyFilters = debounce(() => applyFilters(), 140);

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === 'tab-' + tabName));
  if (tabName === 'map') {
    ensureInteractiveMap();
    setTimeout(() => {
      if (restaurantMap) {
        restaurantMap.invalidateSize();
        if (!mapHasBeenShown) {
          fitMapToVisible(false);
          mapHasBeenShown = true;
        }
      }
    }, 80);
  }
}
function setupMultiFilters() {
  filterConfigs.forEach(cfg => {
    const source = cfg.el;
    source.multiple = true;
    source.classList.add('multi-source');
    cfg.placeholder = (source.querySelector('option[value=""]') || source.options[0] || {}).textContent || cfg.label || 'All';
    source.querySelectorAll('option[value=""]').forEach(option => option.selected = false);
    const control = document.createElement('div');
    control.className = 'multi-filter';
    control.dataset.filterKey = cfg.key;
    control.innerHTML = '<button class="multi-filter-button" type="button" aria-expanded="false"></button><div class="multi-filter-menu" role="group" aria-label="' + escapeHTML(cfg.placeholder) + '"><div class="multi-filter-actions"><span class="multi-filter-count">Any</span><button class="multi-filter-clear" type="button">Clear</button></div><div class="multi-filter-options"></div><div class="multi-filter-empty">No options match the other filters.</div></div>';
    source.insertAdjacentElement('afterend', control);
    cfg.multiControl = control;
    const optionsWrap = control.querySelector('.multi-filter-options');
    Array.from(source.options).filter(option => option.value).forEach(option => {
      const label = document.createElement('label');
      label.className = 'multi-filter-option';
      label.dataset.value = option.value;
      label.innerHTML = '<input type="checkbox" value="' + escapeHTML(option.value) + '"><span>' + escapeHTML(option.textContent.trim()) + '</span>';
      optionsWrap.appendChild(label);
    });
    const button = control.querySelector('.multi-filter-button');
    button.addEventListener('click', () => {
      const willOpen = !control.classList.contains('open');
      document.querySelectorAll('.multi-filter.open').forEach(other => {
        if (other !== control) {
          other.classList.remove('open');
          const otherButton = other.querySelector('.multi-filter-button');
          if (otherButton) otherButton.setAttribute('aria-expanded', 'false');
        }
      });
      control.classList.toggle('open', willOpen);
      button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    control.querySelector('.multi-filter-clear').addEventListener('click', event => {
      event.stopPropagation();
      setSelectedValues(cfg, []);
      applyFilters();
    });
    optionsWrap.addEventListener('change', event => {
      const checkbox = event.target.closest('input[type="checkbox"]');
      if (!checkbox) return;
      const selected = selectedValuesForFilter(cfg);
      if (checkbox.checked) selected.push(checkbox.value);
      else {
        const selectedIndex = selected.indexOf(checkbox.value);
        if (selectedIndex >= 0) selected.splice(selectedIndex, 1);
      }
      setSelectedValues(cfg, selected);
      applyFilters();
    });
    updateMultiFilterUI(cfg);
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.multi-filter')) {
      document.querySelectorAll('.multi-filter.open').forEach(control => {
        control.classList.remove('open');
        const button = control.querySelector('.multi-filter-button');
        if (button) button.setAttribute('aria-expanded', 'false');
      });
    }
  });
}
function addMetadataTag(card, className, text) {
  const titleRow = card.querySelector('.card-title-row');
  if (!titleRow) return;
  const baseClass = String(className || '').split(/\s+/)[0];
  if (baseClass && titleRow.querySelector('.' + baseClass)) return;
  const tag = document.createElement('span');
  tag.className = className;
  tag.textContent = text;
  titleRow.appendChild(tag);
}
function addMetadataLine(card, className, prefix, text) {
  if (!text || card.querySelector('.' + className)) return;
  const cardMain = card.querySelector('.card-main');
  if (!cardMain) return;
  const line = document.createElement('div');
  line.className = className;
  line.textContent = prefix + text;
  const actions = cardMain.querySelector('.actions');
  if (actions) cardMain.insertBefore(line, actions);
  else cardMain.appendChild(line);
}
function hydrateMetadataCards() {
  restaurants.forEach(r => {
    const card = cardByRank.get(String(r.rank));
    if (!card) return;
    card.dataset.search = [card.dataset.search || '', r.search_blob].join(' ').trim();
    card.dataset.city = r.city || card.dataset.city || '';
    card.dataset.country = r.country || card.dataset.country || '';
    card.dataset.continent = r.continent || card.dataset.continent || '';
    card.dataset.tier = r.tier || card.dataset.tier || '';
    card.dataset.booking = r.booking_difficulty || card.dataset.booking || '';
    card.dataset.dressCode = r.dress_code || card.dataset.dressCode || '';
    card.dataset.englishFriendliness = r.english_friendliness || card.dataset.englishFriendliness || '';
    card.dataset.dietaryFlexibility = r.dietary_flexibility || card.dataset.dietaryFlexibility || '';
    card.dataset.priceSort = Number.isFinite(r.price_sort_value) ? r.price_sort_value : '';
    if (r.dress_code) {
      addMetadataTag(card, 'dress-tag ' + slugify(r.dress_code), r.dress_code);
      addMetadataLine(card, 'dress-line', 'Dress code: ', r.dress_code_note || r.dress_code);
    }
    if (r.english_friendliness) {
      addMetadataTag(card, 'english-tag ' + slugify(r.english_friendliness), r.english_friendliness);
      addMetadataLine(card, 'english-line', 'English friendliness: ', r.english_friendliness_note || r.english_friendliness);
    }
    if (r.dietary_flexibility) {
      addMetadataTag(card, 'dietary-tag ' + slugify(r.dietary_flexibility), r.dietary_flexibility);
      addMetadataLine(card, 'dietary-line', 'Dietary flexibility: ', r.dietary_flexibility_note || r.dietary_flexibility);
    }
  });
}

function tierClass(tier) {
  return tier === 'S+' ? 'splus' : tier === 'S' ? 's' : tier === 'S-' ? 'sminus' : 'unranked';
}
function roundedCoordKey(r) {
  return [Number(r.lat).toFixed(7), Number(r.lon).toFixed(7)].join('|');
}
const coordinateGroups = restaurants.reduce((acc, r) => {
  const key = roundedCoordKey(r);
  if (!acc[key]) acc[key] = [];
  acc[key].push(r);
  return acc;
}, {});
Object.values(coordinateGroups).forEach(group => group.sort((a,b) => a.rank - b.rank));
function displayLatLngForRestaurant(r) {
  const lat = Number(r.lat), lon = Number(r.lon);
  const group = coordinateGroups[roundedCoordKey(r)] || [r];
  if (group.length <= 1) return [lat, lon];
  const idx = group.findIndex(item => item.rank === r.rank);
  const angle = (idx / group.length) * Math.PI * 2;
  const radius = 0.012 + Math.min(group.length, 12) * 0.0025;
  const lonAdjust = Math.cos(lat * Math.PI / 180) || 1;
  return [lat + Math.sin(angle) * radius, lon + (Math.cos(angle) * radius) / lonAdjust];
}
function mapIconForRestaurant(r) {
  return L.divIcon({
    className: 'restaurant-marker-icon',
    html: '<span class="map-pin ' + tierClass(r.tier) + '">' + r.rank + '</span>',
    iconSize: [31, 31],
    iconAnchor: [15.5, 15.5],
    popupAnchor: [0, -17]
  });
}
function clusterIconForCity(cluster) {
  return L.divIcon({
    className: 'restaurant-cluster-icon',
    html: '<span class="map-cluster-pin"><b>' + cluster.count + '</b><em>' + escapeHTML(cluster.city) + '</em></span>',
    iconSize: [74, 38],
    iconAnchor: [37, 19],
    popupAnchor: [0, -18]
  });
}
function popupHTML(r) {
  const mapHref = r.maps || googleMapsSearchLink(r.name + ' ' + r.city + ' ' + r.country + ' restaurant');
  return '<div class="map-popup">'
    + '<div class="map-popup-title">#' + r.rank + ' ' + escapeHTML(r.name) + '</div>'
    + '<div class="map-popup-meta">' + escapeHTML(r.city) + ', ' + escapeHTML(r.country) + ' • ' + escapeHTML(r.tier) + ' • ' + escapeHTML(r.booking_difficulty || '') + (r.dress_code ? ' • ' + escapeHTML(r.dress_code) : '') + (r.english_friendliness ? ' • ' + escapeHTML(r.english_friendliness) : '') + (r.dietary_flexibility ? ' • ' + escapeHTML(r.dietary_flexibility) : '') + '</div>'
    + '<div class="map-popup-meta">' + escapeHTML(r.type || r.description || '') + (r.price_label ? ' • ' + escapeHTML(r.price_label) : '') + '</div>'
    + (r.english_friendliness ? '<div class="map-popup-meta">English friendliness: ' + escapeHTML(r.english_friendliness) + '</div>' : '')
    + (r.dietary_flexibility ? '<div class="map-popup-meta">Dietary flexibility: ' + escapeHTML(r.dietary_flexibility) + '</div>' : '')
    + '<div class="map-popup-actions"><a class="primary" href="' + escapeHTML(mapHref) + '" target="_blank" rel="noopener noreferrer">Open in Google Maps</a><button type="button" data-popup-rank="' + Number(r.rank) + '">Show card</button></div>'
    + '</div>';
}
function restaurantsForCity(city, source) {
  return sortItems((source || restaurants).filter(r => r.city === city));
}
function countsFor(items) {
  return items.reduce((acc, r) => { acc.total++; acc[r.tier] = (acc[r.tier] || 0) + 1; return acc; }, {total:0, 'S+':0, 'S':0, 'S-':0, 'Unranked':0});
}
function mapCityClusters(source) {
  const cities = new Map();
  (source || []).forEach(r => {
    if (!cities.has(r.city)) cities.set(r.city, {city:r.city, country:r.country, count:0, bestRank:Number.POSITIVE_INFINITY, latSum:0, lonSum:0});
    const entry = cities.get(r.city);
    const [lat, lon] = displayLatLngForRestaurant(r);
    entry.count += 1;
    entry.bestRank = Math.min(entry.bestRank, Number(r.rank) || Number.POSITIVE_INFINITY);
    entry.latSum += lat;
    entry.lonSum += lon;
  });
  return Array.from(cities.values()).map(entry => ({...entry, lat: entry.latSum / entry.count, lon: entry.lonSum / entry.count})).sort((a, b) => b.count - a.count || a.bestRank - b.bestRank || a.city.localeCompare(b.city, undefined, {sensitivity:'base'}));
}
function renderMapCityZoomButtons() {
  if (!els.mapCityZoomButtons) return;
  if (!visibleRestaurants.length) {
    els.mapCityZoomButtons.innerHTML = '<span class="map-shortcuts-empty">No visible city clusters</span>';
    return;
  }
  const limit = 14;
  let clusters = mapCityClusters(visibleRestaurants).slice(0, limit);
  if (selectedMapCity && !clusters.some(cluster => cluster.city === selectedMapCity)) {
    const selectedCluster = mapCityClusters(restaurants).find(cluster => cluster.city === selectedMapCity);
    if (selectedCluster) clusters = [selectedCluster].concat(clusters).slice(0, limit);
  }
  els.mapCityZoomButtons.innerHTML = clusters.map(cluster => '<button class="city-zoom-btn' + (cluster.city === selectedMapCity ? ' active' : '') + '" type="button" data-city="' + escapeHTML(cluster.city) + '" title="Zoom to ' + escapeHTML(cluster.city) + '">' + escapeHTML(cluster.city) + ' <span>(' + cluster.count + ')</span></button>').join('');
}
function renderCityDetail(city) {
  selectedMapCity = city;
  renderMapCityZoomButtons();
  const cityItems = restaurantsForCity(city, restaurants);
  const filteredItems = restaurantsForCity(city, visibleRestaurants);
  const shownItems = filteredItems.length ? filteredItems : cityItems;
  const first = cityItems[0] || filteredItems[0];
  if (!first || !els.mapTitle || !els.mapBody) return;
  const counts = countsFor(filteredItems.length ? filteredItems : cityItems);
  const contextNote = filteredItems.length ? '' : '<div class="map-help" style="margin:0 0 12px;">No restaurants in this city match the current filters; showing the full city list.</div>';
  els.mapTitle.textContent = city;
  const cityCountries = [...new Set(cityItems.map(r => r.country))].join(' / ');
  const cityContinents = [...new Set(cityItems.map(r => r.continent))].join(' / ');
  els.mapMeta.textContent = cityCountries + ' • ' + cityContinents + ' • ' + shownItems.length + ' restaurant' + (shownItems.length === 1 ? '' : 's') + (filteredItems.length && filteredItems.length !== cityItems.length ? ' shown by current filters' : '');
  els.mapBody.className = '';
  const cityMapsHref = googleMapsSearchLink(city + ' ' + first.country + ' restaurants');
  const tierPills = '<div class="detail-pills"><span class="city-pill">S+: ' + counts['S+'] + '</span><span class="city-pill">S: ' + counts['S'] + '</span><span class="city-pill">S-: ' + counts['S-'] + '</span><span class="city-pill">Unranked: ' + counts['Unranked'] + '</span><span class="city-pill">' + counts.total + ' shown</span></div>';
  const actions = '<div class="map-context-actions"><button class="city-filter-btn" type="button" data-map-action="filter-city" data-city="' + escapeHTML(city) + '">Show in list</button><button class="city-filter-btn" type="button" data-map-action="zoom-city" data-city="' + escapeHTML(city) + '">Zoom here</button><a class="action primary" href="' + escapeHTML(cityMapsHref) + '" target="_blank" rel="noopener noreferrer">Open city in Google Maps</a></div>';
  const links = shownItems.map(r => {
    const mapHref = r.maps || googleMapsSearchLink(r.name + ' ' + r.city + ' ' + r.country + ' restaurant');
    return '<a class="mini-link" href="' + escapeHTML(mapHref) + '" target="_blank" rel="noopener noreferrer">#' + r.rank + ' ' + escapeHTML(r.name) + ' <span>(' + escapeHTML(r.tier) + ' · ' + escapeHTML(r.booking_difficulty || '') + (r.price_label ? ' · ' + escapeHTML(r.price_label) : '') + (r.dress_code ? ' · ' + escapeHTML(r.dress_code) : '') + (r.english_friendliness ? ' · English: ' + escapeHTML(r.english_friendliness) : '') + ')</span></a>';
  }).join('');
  els.mapBody.innerHTML = tierPills + actions + contextNote + '<div class="city-restaurants">' + links + '</div>';
}
function ensureInteractiveMap() {
  if (restaurantMap) return true;
  initInteractiveMap();
  return !!restaurantMap;
}
function initInteractiveMap() {
  if (!els.leafletMap || restaurantMap) return;
  if (!window.L) {
    els.mapTitle.textContent = 'Map library could not load';
    els.mapMeta.textContent = 'The restaurant list and Google Maps links still work.';
    els.mapBody.className = 'map-placeholder';
    els.mapBody.textContent = 'Leaflet was not available. Check the browser connection or content blockers, then reload.';
    return;
  }
  restaurantMap = L.map(els.leafletMap, {zoomControl:true, scrollWheelZoom:true, worldCopyJump:true});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'&copy; OpenStreetMap contributors'}).addTo(restaurantMap);
  markerLayer = L.layerGroup();
  clusterLayer = L.layerGroup();
  leafletMarkers = restaurants.map(r => {
    const marker = L.marker(displayLatLngForRestaurant(r), {icon: mapIconForRestaurant(r), title:'#' + r.rank + ' ' + r.name});
    marker._restaurant = r;
    marker.bindPopup(popupHTML(r), {maxWidth:320});
    marker.on('click', () => renderCityDetail(r.city));
    marker.on('popupopen', event => {
      const button = event.popup.getElement()?.querySelector('[data-popup-rank]');
      if (button) button.addEventListener('click', () => flashCard(button.dataset.popupRank));
    });
    markerLayer.addLayer(marker);
    return marker;
  });
  restaurantMap.on('zoomend', updateMapLayerMode);
  updateMap();
  fitMapToVisible(false);
}
function activeMapMarkers() {
  const visibleRanks = new Set(visibleRestaurants.map(r => Number(r.rank)));
  return leafletMarkers.filter(marker => visibleRanks.has(Number(marker._restaurant.rank)));
}
function fitMarkers(markers, animate) {
  if (!restaurantMap) return;
  if (!markers.length) {
    restaurantMap.setView([25, 10], 2, {animate: !!animate});
    return;
  }
  if (markers.length === 1) {
    restaurantMap.setView(markers[0].getLatLng(), 12, {animate: !!animate});
    return;
  }
  const bounds = L.latLngBounds(markers.map(marker => marker.getLatLng()));
  restaurantMap.fitBounds(bounds.pad(0.18), {maxZoom:12, animate: !!animate});
}
function fitMapToVisible(animate) {
  if (!ensureInteractiveMap()) return;
  fitMarkers(activeMapMarkers(), animate);
}
function zoomMapToCity(city, animate) {
  if (!ensureInteractiveMap()) return;
  const cityMarkers = activeMapMarkers().filter(marker => marker._restaurant.city === city);
  const fallbackMarkers = leafletMarkers.filter(marker => marker._restaurant.city === city);
  fitMarkers(cityMarkers.length ? cityMarkers : fallbackMarkers, animate);
  renderCityDetail(city);
}
window.zoomMapToCity = zoomMapToCity;
function zoomMapToSelected(animate) {
  if (!ensureInteractiveMap()) return;
  const cityCfg = configByKey.get('city');
  const selectedCities = cityCfg ? selectedValuesForFilter(cityCfg) : [];
  if (selectedCities.length === 1) {
    zoomMapToCity(selectedCities[0], animate);
    return;
  }
  if (selectedMapCity) {
    zoomMapToCity(selectedMapCity, animate);
    return;
  }
  fitMapToVisible(animate);
}
function rebuildClusterLayer() {
  if (!clusterLayer || !window.L) return;
  clusterLayer.clearLayers();
  mapCityClusters(visibleRestaurants).forEach(cluster => {
    const marker = L.marker([cluster.lat, cluster.lon], {icon: clusterIconForCity(cluster), title: cluster.city + ' (' + cluster.count + ')'});
    marker.bindTooltip(cluster.city + ' — ' + cluster.count + ' visible restaurant' + (cluster.count === 1 ? '' : 's'));
    marker.on('click', () => zoomMapToCity(cluster.city, true));
    clusterLayer.addLayer(marker);
  });
}
function updateRestaurantMarkerLayer(visibleRanks) {
  if (!markerLayer) return;
  leafletMarkers.forEach(marker => {
    const visible = visibleRanks.has(Number(marker._restaurant.rank));
    const onLayer = markerLayer.hasLayer(marker);
    if (visible && !onLayer) markerLayer.addLayer(marker);
    if (!visible && onLayer) markerLayer.removeLayer(marker);
  });
}
function updateMapLayerMode() {
  if (!restaurantMap || !markerLayer || !clusterLayer) return;
  const showClusters = restaurantMap.getZoom() < CLUSTER_ZOOM_THRESHOLD && visibleRestaurants.length > 12;
  if (showClusters) {
    if (restaurantMap.hasLayer(markerLayer)) restaurantMap.removeLayer(markerLayer);
    if (!restaurantMap.hasLayer(clusterLayer)) restaurantMap.addLayer(clusterLayer);
  } else {
    if (restaurantMap.hasLayer(clusterLayer)) restaurantMap.removeLayer(clusterLayer);
    if (!restaurantMap.hasLayer(markerLayer)) restaurantMap.addLayer(markerLayer);
  }
}
function updateMap() {
  if (!restaurantMap || !markerLayer) return;
  const visibleRanks = new Set(visibleRestaurants.map(r => Number(r.rank)));
  updateRestaurantMarkerLayer(visibleRanks);
  rebuildClusterLayer();
  updateMapLayerMode();
  if (selectedMapCity) {
    const stillVisible = visibleRestaurants.some(r => r.city === selectedMapCity);
    if (stillVisible || restaurants.some(r => r.city === selectedMapCity)) renderCityDetail(selectedMapCity);
  }
  if (document.getElementById('tab-map')?.classList.contains('active')) restaurantMap.invalidateSize();
}
function flashCard(rank) {
  const card = cardByRank.get(String(rank));
  if (!card) return;
  switchTab('explore');
  card.scrollIntoView({behavior:'smooth', block:'center'});
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 1300);
}
window.flashCardFromMap = flashCard;
window.applyCityFromMap = function(city) {
  const cfg = configByKey.get('city');
  if (cfg) setSelectedValues(cfg, [city]);
  switchTab('explore');
  applyFilters();
};


function linkOrEmpty(label, href, primary = false) {
  if (!href) return '';
  return '<a class="action' + (primary ? ' primary' : '') + '" href="' + escapeHTML(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(label) + '</a>';
}
function openRestaurantDetails(rankOrId) {
  const restaurant = restaurantByRank.get(String(rankOrId)) || restaurantById.get(String(rankOrId));
  if (!restaurant || !els.detailDrawer || !els.detailContent) return;
  const cuisine = (restaurant.cuisine_categories || []).join(', ') || restaurant.type || restaurant.type_group || '';
  els.detailContent.innerHTML = '<h2 class="detail-title" id="restaurantDetailTitle">#' + escapeHTML(restaurant.rank) + ' ' + escapeHTML(restaurant.name) + '</h2>'
    + '<p class="detail-subtitle">' + escapeHTML([restaurant.city, restaurant.country, restaurant.continent].filter(Boolean).join(' · ')) + '</p>'
    + '<div class="detail-links">'
    + linkOrEmpty('Google Maps', restaurant.maps || googleMapsSearchLink(restaurant.name + ' ' + restaurant.city), true)
    + linkOrEmpty('Website', restaurant.website)
    + linkOrEmpty('Reserve', restaurant.reservation)
    + linkOrEmpty('Michelin', restaurant.michelin)
    + linkOrEmpty('Instagram', restaurant.instagram)
    + '</div>'
    + '<section class="detail-section"><h4>Planning basics</h4><dl class="detail-kv">'
    + '<dt>Tier</dt><dd>' + escapeHTML(restaurant.tier || '') + '</dd>'
    + '<dt>Cuisine</dt><dd>' + escapeHTML(cuisine) + '</dd>'
    + '<dt>Price</dt><dd>' + escapeHTML(restaurant.price_label || '') + (restaurant.price_original ? ' <span class="dot">•</span> ' + escapeHTML(restaurant.price_original) : '') + '</dd>'
    + '<dt>Booking</dt><dd>' + escapeHTML(restaurant.booking_difficulty || '') + (restaurant.booking_note ? ' — ' + escapeHTML(restaurant.booking_note) : '') + '</dd>'
    + '<dt>Dress code</dt><dd>' + escapeHTML(restaurant.dress_code || '') + (restaurant.dress_code_note ? ' — ' + escapeHTML(restaurant.dress_code_note) : '') + '</dd>'
    + '<dt>English</dt><dd>' + escapeHTML(restaurant.english_friendliness || '') + (restaurant.english_friendliness_note ? ' — ' + escapeHTML(restaurant.english_friendliness_note) : '') + '</dd>'
    + '<dt>Dietary</dt><dd>' + escapeHTML(restaurant.dietary_flexibility || '') + (restaurant.dietary_flexibility_note ? ' — ' + escapeHTML(restaurant.dietary_flexibility_note) : '') + '</dd>'
    + '</dl></section>'
    + '<section class="detail-section"><h4>Data</h4><dl class="detail-kv">'
    + '<dt>Stable ID</dt><dd>' + escapeHTML(restaurant.id || '') + '</dd>'
    + '<dt>Coordinates</dt><dd>' + escapeHTML(restaurant.lat) + ', ' + escapeHTML(restaurant.lon) + '</dd>'
    + '<dt>Price note</dt><dd>' + escapeHTML(restaurant.price_note || '') + '</dd>'
    + '<dt>Data basis</dt><dd>' + escapeHTML(restaurant.dietary_flexibility_basis || restaurant.english_friendliness_basis || restaurant.dress_code_basis || 'Best-effort; verify before booking.') + '</dd>'
    + '</dl></section>';
  els.detailDrawer.classList.add('open');
  els.detailDrawer.setAttribute('aria-hidden', 'false');
  els.detailDrawer.querySelector('.detail-close')?.focus({preventScroll:true});
}
function closeRestaurantDetails() {
  if (!els.detailDrawer) return;
  els.detailDrawer.classList.remove('open');
  els.detailDrawer.setAttribute('aria-hidden', 'true');
}
function renderAuditScreen(issues = lastValidationIssues) {
  if (!els.auditSummary || !els.auditIssues) return;
  const cities = new Set(restaurants.map(r => r.city)).size;
  const websites = restaurants.filter(r => r.website).length;
  const coords = restaurants.filter(r => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon))).length;
  const allIds = restaurants.filter(r => r.id).length;
  const stat = (label, value) => '<div class="audit-stat"><b>' + escapeHTML(value) + '</b><span>' + escapeHTML(label) + '</span></div>';
  els.auditSummary.innerHTML = [
    stat('restaurants in JSON', restaurants.length),
    stat('generated DOM cards', cardByRank.size),
    stat('cities', cities),
    stat('stable IDs', allIds + '/' + restaurants.length),
    stat('valid coordinates', coords + '/' + restaurants.length),
    stat('website links', websites + '/' + restaurants.length),
    stat('audit warnings', issues.length)
  ].join('');
  if (!issues.length) {
    els.auditIssues.innerHTML = '<span class="audit-ok">Data check OK. No structural warnings found.</span>';
  } else {
    els.auditIssues.innerHTML = '<span class="audit-warning">Warnings:</span>\n' + issues.map((issue, index) => (index + 1) + '. ' + escapeHTML(issue)).join('\n');
  }
}

function validateRestaurantData() {
  const issues = [];
  const seenRanks = new Set();
  const seenIds = new Set();
  const validTiers = new Set(['S+','S','S-','Unranked']);
  const knownValues = Object.fromEntries(filterConfigs.map(cfg => [cfg.key, new Set(restaurants.flatMap(item => valuesForFilter(item, cfg.key)))]));
  restaurants.forEach((r, index) => {
    const prefix = r.rank ? '#' + r.rank + ' ' + (r.name || '(unnamed)') : 'Row ' + (index + 1);
    if (!r.id) issues.push(prefix + ': missing stable id');
    if (r.id && seenIds.has(String(r.id))) issues.push(prefix + ': duplicate stable id ' + r.id);
    if (r.id) seenIds.add(String(r.id));
    if (!r.rank || !Number.isFinite(Number(r.rank))) issues.push(prefix + ': missing numeric rank');
    if (seenRanks.has(String(r.rank))) issues.push(prefix + ': duplicate rank');
    seenRanks.add(String(r.rank));
    ['name','city','country','continent','tier'].forEach(key => { if (!r[key]) issues.push(prefix + ': missing ' + key); });
    if (!validTiers.has(r.tier)) issues.push(prefix + ': unknown tier ' + r.tier);
    if (!Number.isFinite(Number(r.lat)) || !Number.isFinite(Number(r.lon))) issues.push(prefix + ': invalid coordinates');
    ['booking_difficulty','dress_code','english_friendliness','dietary_flexibility'].forEach(key => { if (!r[key]) issues.push(prefix + ': missing ' + key); });
    if (!cardByRank.has(String(r.rank))) issues.push(prefix + ': no matching card DOM node');
    if (r.id && !cardById.has(String(r.id))) issues.push(prefix + ': no matching stable-id card DOM node');
    ['maps','website','reservation','michelin','instagram'].forEach(key => {
      if (r[key] && !/^https?:\/\//i.test(String(r[key]))) issues.push(prefix + ': suspicious ' + key + ' URL');
    });
  });
  if (restaurants.length !== cardByRank.size) issues.push('Restaurant/card count mismatch: data has ' + restaurants.length + ', DOM has ' + cardByRank.size);
  lastValidationIssues = issues;
  if (issues.length) console.warn('Bucket List Restaurants data validation warnings:', issues);
  else console.info('Bucket List Restaurants data validation passed:', {version: APP_VERSION, restaurants: restaurants.length, cities: new Set(restaurants.map(r => r.city)).size});
  setStatus((issues.length ? 'Data check warnings: ' + issues.length : 'Data check OK') + ' • saved locally', true);
  renderAuditScreen(issues);
  return issues;
}

function setupEventHandlers() {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  if (els.search) els.search.addEventListener('input', scheduleApplyFilters);
  if (els.sort) els.sort.addEventListener('change', () => applyFilters());
  if (els.reset) els.reset.addEventListener('click', () => {
    applyStateToControls(cloneDefaultState());
    selectedMapCity = '';
    safeStorage.remove(STORAGE_KEY);
    applyFilters();
    setStatus('Filters reset');
  });
  if (els.compactModeBtn) els.compactModeBtn.addEventListener('click', () => {
    appState.compact = !appState.compact;
    updateCompactMode();
    applyFilters();
  });
  if (els.shareStateBtn) els.shareStateBtn.addEventListener('click', async () => {
    const url = stateForDisplay();
    try {
      await navigator.clipboard.writeText(url);
      setStatus('Share link copied');
    } catch (error) {
      setStatus('Share link ready in address bar');
      writeStateToURL();
    }
  });
  if (els.activeFilters) els.activeFilters.addEventListener('click', event => {
    const chip = event.target.closest('.active-filter-chip');
    if (!chip) return;
    const type = chip.dataset.chipType;
    const key = chip.dataset.chipKey;
    const value = chip.dataset.chipValue;
    if (type === 'search' && els.search) els.search.value = '';
    else if (type === 'sort' && els.sort) els.sort.value = 'rank';
    else if (type === 'compact') appState.compact = false;
    else if (type === 'filter') {
      const cfg = configByKey.get(key);
      if (cfg) setSelectedValues(cfg, selectedValuesForFilter(cfg).filter(item => item !== value));
    }
    updateCompactMode();
    applyFilters();
  });
  if (els.graphicArea) {
    els.graphicArea.addEventListener('contextmenu', event => {
      const hotspot = event.target.closest('.hotspot');
      if (!hotspot) return;
      event.preventDefault();
      flashCard(hotspot.dataset.rank);
    });
    els.graphicArea.addEventListener('pointerover', event => {
      const hotspot = event.target.closest('.hotspot');
      if (!hotspot) return;
      const card = cardByRank.get(String(hotspot.dataset.rank));
      if (card) card.classList.add('flash');
    });
    els.graphicArea.addEventListener('pointerout', event => {
      const hotspot = event.target.closest('.hotspot');
      if (!hotspot || hotspot.contains(event.relatedTarget)) return;
      const card = cardByRank.get(String(hotspot.dataset.rank));
      if (card) card.classList.remove('flash');
    });
  }
  document.querySelectorAll('[data-city-jump]').forEach(btn => btn.addEventListener('click', () => {
    const cfg = configByKey.get('city');
    if (cfg) setSelectedValues(cfg, [btn.dataset.cityJump]);
    switchTab('explore');
    applyFilters();
    els.cardsList?.scrollIntoView({behavior:'smooth', block:'start'});
  }));
  if (els.openVisibleCities) els.openVisibleCities.addEventListener('click', () => {
    const cities = [...new Set(visibleRestaurants.map(r => r.city + ', ' + r.country))];
    cities.slice(0, 12).forEach(city => window.open(googleMapsSearchLink(city), '_blank', 'noopener'));
  });
  if (els.switchToCityTab) els.switchToCityTab.addEventListener('click', () => switchTab('cities'));
  if (els.cardsList) els.cardsList.addEventListener('click', event => {
    const detail = event.target.closest('[data-detail-rank]');
    if (!detail) return;
    openRestaurantDetails(detail.dataset.detailRank);
  });
  if (els.detailDrawer) els.detailDrawer.addEventListener('click', event => {
    if (event.target.closest('[data-detail-close]')) closeRestaurantDetails();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeRestaurantDetails(); });
  if (els.auditRecheckBtn) els.auditRecheckBtn.addEventListener('click', () => validateRestaurantData());
  if (els.fitMapBtn) els.fitMapBtn.addEventListener('click', () => fitMapToVisible(true));
  if (els.zoomSelectedMapBtn) els.zoomSelectedMapBtn.addEventListener('click', () => zoomMapToSelected(true));
  if (els.mapCityZoomButtons) els.mapCityZoomButtons.addEventListener('click', event => {
    const btn = event.target.closest('[data-city]');
    if (!btn) return;
    zoomMapToCity(btn.dataset.city, true);
  });
  if (els.mapBody) els.mapBody.addEventListener('click', event => {
    const action = event.target.closest('[data-map-action]');
    if (!action) return;
    const city = action.dataset.city;
    if (action.dataset.mapAction === 'filter-city') window.applyCityFromMap(city);
    if (action.dataset.mapAction === 'zoom-city') zoomMapToCity(city, true);
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(window.location.protocol)) return;
  navigator.serviceWorker.register('service-worker.js').catch(error => console.warn('Service worker registration skipped:', error));
}

function bootApp() {
  prepareRestaurantData();
  cacheDomLookups();
  syncFilterSelectOptionsFromData();
  setupMultiFilters();
  hydrateMetadataCards();
  const state = stateHasURLParams() ? loadStateFromURL() : (loadStateFromStorage() || cloneDefaultState());
  hasHydratedFromSavedState = !stateHasURLParams() && !!loadStateFromStorage();
  applyStateToControls(state);
  setupEventHandlers();
  validateRestaurantData();
  applyFilters({persist:false, updateUrl:false, status:false});
  registerServiceWorker();
}
bootApp();