// "Where we look": Google map with a three-level flow.
//   overview -> click a country -> country (zoom, markers, list) -> click a tender -> detail panel
// The side panel and the list work without Google too (the tiles open the same views).
// The map itself loads as the section nears the screen, unless the visitor chose the simple tiles.

// Put your Google Maps JavaScript API key here (restrict it to smalltenders.com in Google Cloud).
const GOOGLE_MAPS_KEY = 'AIzaSyBgoNqkHj-teEQ4O3tqMhs8DEC-gtPbMEI';

(function () {
  var stage = document.getElementById('mapstage');
  var panel = document.getElementById('mappanel');
  var side = document.getElementById('mapside');
  if (!stage || !panel || !side) return;

  var D = stage.dataset;
  var tiles = panel.querySelector('.tilemap');
  var canvas = panel.querySelector('.gmap');
  var tip = panel.querySelector('.maptip');
  var btn = panel.querySelector('.mapload');
  var note = panel.querySelector('.mapnote');
  var legendEl = panel.querySelector('.tradelegend');
  var views = {};
  side.querySelectorAll('[data-view]').forEach(function (v) { views[v.dataset.view] = v; });

  // one neutral colour for every European country; the chosen country gets a stronger outline and fill
  var LAND = { fill: '#e2d8c3', pick: '#cdbd9c', line: '#8f8372' };
  var TRADE = { electrical: '#1d5fa8', plumbing: '#1b7f8e', hvac: '#6b4aa0', painting: '#c28a00', building: '#4d6b2f', cleaning: '#a23a6b',
    roofing: '#3f4a56', flooring: '#8d6e63', windows: '#4fa3d9', insulation: '#e58fb0', facade: '#7f8c8d', groundworks: '#9ccc65', demolition: '#e53935', scaffolding: '#ff7043' };
  var EUROPE = { north: 71.5, south: 35.5, west: -24.5, east: 42 };
  var PRIORITY = ['NO', 'SE', 'DK', 'FI', 'IS', 'PL', 'DE'];   // "Now" and "Next" first, then the rest alphabetically
  var selC = document.getElementById('f-country');
  var selT = document.getElementById('f-trade');
  var cnt = document.getElementById('f-count');
  var names = {};
  try { names = JSON.parse(D.names || '{}'); } catch (e) { names = {}; }
  var native = {}, hrefOf = {};
  tiles.querySelectorAll('a').forEach(function (a) {
    var cc = a.querySelector('b').textContent;
    native[cc] = a.querySelector('span').textContent;
    hrefOf[cc] = a.getAttribute('href');
  });

  var tenders = [];
  var byId = {};
  var map = null, loading = false, mapOn = false, infoTip = null;
  var markers = {};          // tender id -> marker
  var bounds = {};           // country code -> LatLngBounds
  var state = { level: 'overview', cc: null, id: null, trade: '', newOnly: false };
  var camT = null;

  // the filters and the map share one calm card
  var mf = document.querySelector('.mapfilters');
  if (mf && !document.querySelector('.mapcard')) {
    var card = document.createElement('div'); card.className = 'mapcard';
    stage.parentNode.insertBefore(card, mf); card.appendChild(mf); card.appendChild(stage);
  }
  // "clear" button: appears as soon as a filter or a country is active
  var CLEAR = { en: 'Clear', nb: 'Nullstill', da: 'Nulstil', sv: 'Rensa', fi: 'Tyhjennä', is: 'Hreinsa', pl: 'Wyczyść', de: 'Zurücksetzen', cs: 'Vymazat', sk: 'Vymazať', nl: 'Wissen', lt: 'Išvalyti', et: 'Tühjenda', lv: 'Notīrīt', fr: 'Effacer', es: 'Borrar', it: 'Azzera' };
  var clr = null;
  if (cnt) {
    var lg = (document.documentElement.lang || 'en').toLowerCase();
    clr = document.createElement('button'); clr.type = 'button'; clr.className = 'clear'; clr.hidden = true;
    clr.textContent = CLEAR[lg] || CLEAR[lg.split('-')[0]] || CLEAR.en;
    cnt.parentNode.insertBefore(clr, cnt.nextSibling);
    clr.addEventListener('click', function () { state.newOnly = false; state.trade = ''; go('overview'); });
  }
  function updateClear() { if (clr) clr.hidden = !(state.cc || state.trade || state.newOnly); }

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
  function fill(t, o) { return t.replace(/\{(\w+)\}/g, function (_, k) { return o[k]; }); }
  function pref(v) { try { if (v) localStorage.setItem('st-map-pref', v); return localStorage.getItem('st-map-pref'); } catch (e) { return null; } }
  function cname(cc) { return names[cc] || native[cc] || cc; }
  function lang() { return document.documentElement.lang || 'en'; }
  function deadlineDate(t) {
    var d = t.deadline ? new Date(t.deadline) : new Date(Date.now() + (t.deadlineDays || 0) * 86400000);
    return d;
  }
  function daysLeft(t) { return Math.max(0, Math.ceil((deadlineDate(t) - new Date()) / 86400000)); }
  function fmt(t) { return new Intl.DateTimeFormat(lang(), { day: 'numeric', month: 'short', year: 'numeric' }).format(deadlineDate(t)); }

  // ---------- state ----------
  function go(level, cc, id) {
    state.level = level; state.cc = cc || null; state.id = id || null;
    render();
    try {
      var h = level === 'overview' ? '#coverage' : '#map=' + cc + (id ? '/' + id : '');
      history.replaceState(null, '', h);
    } catch (e) { /* file:// or sandbox */ }
  }

  function render() {
    stage.dataset.level = state.level;
    Object.keys(views).forEach(function (k) {
      var show = k === state.level, v = views[k];
      if (show && v.hidden) { v.hidden = false; v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); } else v.hidden = !show;
    });
    tiles.querySelectorAll('li').forEach(function (li) {
      li.classList.toggle('sel', !!state.cc && li.querySelector('b').textContent === state.cc);
    });
    if (selC) selC.value = state.cc && selC.querySelector('option[value="' + state.cc + '"]') ? state.cc : '';
    if (selT) selT.value = state.trade;
    if (state.level === 'overview') renderOverview();
    if (state.level === 'country') renderCountry();
    if (state.level === 'tender') renderTender();
    if (cnt) { var n = scoped().length; cnt.textContent = countText(n); }
    renderNewPill();
    updateClear();
    applyMap();
    if (state.level !== 'overview' && window.matchMedia('(max-width: 900px)').matches) {
      side.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    var f = views[state.level]; if (f && f.hasAttribute('tabindex') && state.level !== 'overview') f.focus({ preventScroll: true });
  }

  // small line icon for a trade (shared from site.js); falls back to a coloured dot
  function tradeIcon(trade) {
    var color = TRADE[trade] || '#1c1914', d = window.stIcons && window.stIcons[trade];
    if (!d) { var dot = el('i'); dot.style.background = color; return dot; }
    var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'tl-ico'); svg.style.color = color;
    p.setAttribute('d', d); svg.appendChild(p); return svg;
  }
  // link to the original notice. Real notices carry their own URL in tenders.json (t.link);
  // until then the portal's address is used as an easy-to-replace placeholder.
  var PORTAL = { Doffin: 'https://www.doffin.no', TED: 'https://ted.europa.eu', Hilma: 'https://www.hankintailmoitukset.fi' };
  function noticeUrl(t) { return t.link || PORTAL[t.source] || ''; }
  function matches(t) {
    if (state.newOnly && !(window.stTenders && window.stTenders.isNew && window.stTenders.isNew(t))) return false;
    return !state.trade || t.trade === state.trade;
  }
  function order(a, b) {
    var pa = PRIORITY.indexOf(a.country), pb = PRIORITY.indexOf(b.country);
    if (pa < 0) pa = 99; if (pb < 0) pb = 99;
    if (pa !== pb) return pa - pb;
    if (a.country !== b.country) return cname(a.country).localeCompare(cname(b.country));
    return deadlineDate(a) - deadlineDate(b);
  }
  // the tenders that match the trade filter (and the country, when one is chosen)
  function scoped() {
    return tenders.filter(function (t) { return matches(t) && (state.level === 'overview' || !state.cc || t.country === state.cc); }).sort(order);
  }
  function countText(n) {
    var w = n === 1 ? D.countOne : D.countMany;
    return w.indexOf('{n}') > -1 ? w.replace('{n}', n) : n + ' ' + w;
  }

  // one list used by the overview and the country view; markers and list stay in sync
  function fillList(ul, list, withCountry) {
    ul.textContent = '';
    list.forEach(function (t) {
      var li = el('li'), b = el('button'); b.type = 'button'; b.dataset.id = t.id; li.style.setProperty('--tc', TRADE[t.trade] || '#cdbd9c');
      var top = el('span', 'tl-top');
      top.appendChild(tradeIcon(t.trade)); top.appendChild(el('b', '', withCountry ? t.city + ' · ' + cname(t.country) : t.city + ' · ' + t.region));
      b.appendChild(top);
      b.appendChild(el('span', 'tl-title', t.title));
      b.appendChild(el('small', '', t.tradeName + ' · ' + D.deadline + ' ' + fmt(t) + ' · ' + t.value));
      b.addEventListener('click', function () { go('tender', t.country, t.id); });
      b.addEventListener('mouseenter', function () { hot(t.id, true); });
      b.addEventListener('mouseleave', function () { hot(t.id, false); });
      b.addEventListener('focus', function () { hot(t.id, true); });
      b.addEventListener('blur', function () { hot(t.id, false); });
      li.appendChild(b);
      var url = noticeUrl(t);
      if (url) {
        var a = el('a', 'tl-link', D.original + ' · ' + (t.source || '') + ' ↗');
        a.href = url; a.target = '_blank'; a.rel = 'noopener';
        li.appendChild(a);
      }
      ul.appendChild(li);
    });
  }

  function renderOverview() {
    var ul = views.overview.querySelector('.tlist'); if (!ul) return;
    var list = scoped();
    fillList(ul, list, true);
    var empty = views.overview.querySelector('.ms-empty');
    if (empty) { empty.hidden = list.length > 0; }
  }

  // country pages exist for the main markets
  var LANDING = { NO: 'norway', SE: 'sweden', DK: 'denmark', FI: 'finland', PL: 'poland', DE: 'germany' };
  var COUNTRY_PAGE = { en: 'Country page', nb: 'Landsside', da: 'Landeside', sv: 'Landssida', fi: 'Maasivu', is: 'Landssíða', pl: 'Strona kraju', de: 'Länderseite', cs: 'Stránka země', sk: 'Stránka krajiny', nl: 'Landpagina', lt: 'Šalies puslapis', et: 'Riigi leht', lv: 'Valsts lapa', fr: 'Page du pays', es: 'Página del país', it: 'Pagina del paese' };
  function landingLabel() { var l = lang().toLowerCase(); return COUNTRY_PAGE[l] || COUNTRY_PAGE[l.split('-')[0]] || COUNTRY_PAGE.en; }
  function renderCountry() {
    var v = views.country, cc = state.cc, list = scoped();
    v.querySelector('.back').textContent = '← ' + D.backAll;
    v.querySelector('.ms-country').textContent = cname(cc);
    v.querySelector('.ms-count').textContent = list.length ? countText(list.length) : '';
    var ul = v.querySelector('.tlist');
    fillList(ul, list, false);
    var more = v.querySelector('.cp-more'); more.textContent = '';
    if (!list.length) {
      var hasOthers = state.trade && tenders.some(function (t) { return t.country === cc; });
      more.appendChild(el('span', 'empty', fill(hasOthers ? (D.noneFilter || D.none) : D.none, { country: cname(cc) })));
    }
    if (LANDING[cc]) {   // the country page (English) for the main markets
      var lp = el('a', 'cp-landing', cname(cc) + ': ' + landingLabel() + (lang().toLowerCase().indexOf('en') === 0 ? '' : ' (EN)') + ' →'); lp.href = '/countries/' + LANDING[cc] + '/';
      more.appendChild(lp); more.appendChild(document.createElement('br'));
    }
    if (hrefOf[cc]) {
      var a = el('a', '', D.openPage); a.href = hrefOf[cc];
      if (!list.length) more.appendChild(document.createElement('br'));
      more.appendChild(a);
    }
  }

  function renderTender() {
    var t = byId[state.id], v = views.tender;
    if (!t) return go('country', state.cc);
    v.querySelector('.back').textContent = '← ' + fill(D.backCountry, { country: cname(t.country) });
    var d = v.querySelector('.tdetail'); d.textContent = '';
    var top = el('div', 'tc-top');
    var chip = el('span', 'chip', t.tradeName); chip.style.borderLeft = '4px solid ' + (TRADE[t.trade] || '#1c1914');
    top.appendChild(chip); top.appendChild(el('span', 'tc-cc', cname(t.country)));
    d.appendChild(top);
    d.appendChild(el('h3', '', t.title));
    var dl = el('dl', 'td-dl');
    [[D.where, t.city + ', ' + t.region + ', ' + cname(t.country)],
     [D.deadline, fmt(t) + ' (' + fill(D.daysLeft, { n: daysLeft(t) }) + ')'],
     [D.value, t.value]].forEach(function (r) {
      var row = el('div'); row.appendChild(el('dt', '', r[0])); row.appendChild(el('dd', '', r[1])); dl.appendChild(row);
    });
    d.appendChild(dl);
    var fit = el('p', 'fitbox'); fit.appendChild(el('b', '', D.fit)); fit.appendChild(document.createTextNode(' ' + t.fit)); d.appendChild(fit);
    var foot = el('p', 'td-link');
    var url = noticeUrl(t);
    if (url) {
      var l = el('a', 'btn', D.original + ' ↗'); l.href = url; l.target = '_blank'; l.rel = 'noopener'; foot.appendChild(l);
    }
    if (t.source) foot.appendChild(el('span', 'tc-from', (url ? ' ' : '') + t.source));
    d.appendChild(foot);
  }

  side.addEventListener('click', function (e) {
    var b = e.target.closest('.back'); if (!b) return;
    if (b.dataset.back === 'overview') go('overview'); else go('country', state.cc);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || state.level === 'overview') return;
    if (state.level === 'tender') go('country', state.cc); else go('overview');
  });

  // tiles (fallback map) open the same views
  tiles.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault(); go('country', a.querySelector('b').textContent);
    });
  });

  // ---------- map ----------
  var haveKey = GOOGLE_MAPS_KEY && GOOGLE_MAPS_KEY !== 'GOOGLE_MAPS_KEY';

  function icon(t, big) {
    var gm = google.maps;
    var small = state.level === 'overview';
    return { path: gm.SymbolPath.CIRCLE, scale: big ? 13 : small ? 6 : 9, fillColor: TRADE[t.trade] || '#1c1914', fillOpacity: 1, strokeColor: big ? '#1c1914' : '#ffffff', strokeWeight: big ? 3 : small ? 1.5 : 2.5 };
  }
  // marker hover lights up the matching list item and brings it into view (inside the panel only)
  function listHot(id, on) {
    var b = side.querySelector('.tlist button[data-id="' + id + '"]'); if (!b) return;
    b.classList.toggle('on', on); if (b.parentNode) b.parentNode.classList.toggle('on', on);
    if (on && b.offsetParent) {
      var r = b.getBoundingClientRect(), br = side.getBoundingClientRect();
      if (r.top < br.top + 8 || r.bottom > br.bottom - 8) side.scrollTo({ top: side.scrollTop + (r.top - br.top) - side.clientHeight / 3, behavior: 'smooth' });
    }
  }
  function hot(id, on) {
    var m = markers[id]; if (!m || !map) return;
    m.setIcon(icon(byId[id], on || state.id === id)); m.setZIndex(on || state.id === id ? 10 : 1);
  }

  // zoom level that fits a bounding box in the map canvas (Web Mercator maths, so we do not depend on fitBounds timing)
  function zoomFor(b, pad) {
    var W = Math.max(100, canvas.offsetWidth - 2 * pad), H = Math.max(100, canvas.offsetHeight - 2 * pad);
    var ne = b.getNorthEast(), sw = b.getSouthWest();
    var y = function (lat) { var s = Math.sin(lat * Math.PI / 180); return Math.log((1 + s) / (1 - s)) / 2; };
    var latFrac = Math.max(0.0001, (y(ne.lat()) - y(sw.lat())) / Math.PI);
    var dLng = ne.lng() - sw.lng(); if (dLng < 0) dLng += 360;
    var lngFrac = Math.max(0.0001, dLng / 360);
    var z = Math.min(Math.log(H / 256 / latFrac) / Math.LN2, Math.log(W / 256 / lngFrac) / Math.LN2);
    return Math.max(3, Math.min(9, Math.floor(z + (W > 460 ? 0.35 : 0)))); // small screens: never crop the country
  }

  // glide to a country (or back to Europe): pan first, then zoom, then settle exactly on the centre
  var camTok = 0;
  function smoothFit(b) {
    clearTimeout(camT);
    var gm = google.maps, tok = ++camTok;
    var bb = b || new gm.LatLngBounds({ lat: EUROPE.south, lng: EUROPE.west }, { lat: EUROPE.north, lng: EUROPE.east });
    var center = bb.getCenter(), z = null;
    camT = setTimeout(function () {
      if (tok !== camTok || !canvas.offsetWidth) return;
      z = zoomFor(bb, b ? 28 : 0);
      map.panTo(center);
      camT = setTimeout(function () {
        if (tok !== camTok) return;
        map.setZoom(z);
        gm.event.addListenerOnce(map, 'idle', function () { if (tok === camTok) map.setCenter(center); });
      }, 520);
    }, 30);
  }
  function applyMap() {
    if (!map || !mapOn) return;
    var gm = google.maps;
    map.data.setStyle(function (f) {
      var cc = f.getProperty('cc'), on = !state.cc || cc === state.cc;
      var picked = !!state.cc && cc === state.cc;
      return { fillColor: picked ? LAND.pick : LAND.fill, fillOpacity: on ? 0.9 : 0.4, strokeColor: picked ? '#1c1914' : LAND.line, strokeWeight: picked ? 3 : 1, clickable: true, cursor: 'pointer' };
    });
    tenders.forEach(function (t) {
      var m = markers[t.id]; if (!m) return;
      var vis = matches(t) && (state.level === 'overview' || t.country === state.cc);
      if (vis && !m.getVisible() && state.level === 'country') { m.setVisible(true); m.setAnimation(gm.Animation.DROP); } else m.setVisible(vis);
      m.setIcon(icon(t, state.id === t.id)); m.setZIndex(state.id === t.id ? 10 : 1);
    });
    gm.event.trigger(map, 'resize');
    if (state.level === 'overview') smoothFit(null);
    else if (state.level === 'country' && bounds[state.cc]) smoothFit(bounds[state.cc]);
    else if (state.level === 'tender' && byId[state.id]) {
      var t = byId[state.id]; map.panTo({ lat: t.lat, lng: t.lng });
    }
  }

  function showTiles() { mapOn = false; canvas.hidden = true; tip.hidden = true; tiles.hidden = false; btn.textContent = panel.dataset.btn; }
  function showMap() {
    mapOn = true; tiles.hidden = true; canvas.hidden = false; btn.textContent = panel.dataset.back;
    if (map) { google.maps.event.trigger(map, 'resize'); applyMap(); }
  }
  window.gm_authFailure = function () { map = null; loading = false; showTiles(); };

  window.__stMapReady = function () {
    var gm = google.maps;
    tiles.hidden = true; canvas.hidden = false; mapOn = true; // the map needs a visible, sized container
    map = new gm.Map(canvas, {
      center: { lat: 55, lng: 14 }, zoom: 4, minZoom: 3, maxZoom: 9,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false,
      gestureHandling: 'cooperative',
      restriction: { latLngBounds: { north: 85, south: 20, west: -60, east: 70 }, strictBounds: false },
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'road', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
        { featureType: 'administrative.locality', stylers: [{ visibility: 'off' }] },
        { featureType: 'administrative.province', stylers: [{ visibility: 'off' }] },
        { featureType: 'landscape', stylers: [{ color: '#ece5d6' }] },
        { featureType: 'water', stylers: [{ color: '#c9d3d1' }] },
        { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#b8ad99' }] }
      ]
    });
    var fit = function () { map.fitBounds(EUROPE, 0); };
    fit(); gm.event.addListenerOnce(map, 'idle', function () { applyMap(); });

    map.data.loadGeoJson(D.src, null, function (features) {
      features.forEach(function (f) {
        var b = new gm.LatLngBounds();
        // skip far-off parts (Svalbard belongs to Norway but would zoom the view out to the Arctic)
        f.getGeometry().forEachLatLng(function (ll) { if (ll.lat() < 72) b.extend(ll); });
        bounds[f.getProperty('cc')] = b;
      });
      applyMap();
    });
    map.data.setStyle({ fillColor: LAND.fill, fillOpacity: 0.9, strokeColor: LAND.line, strokeWeight: 1 });
    map.data.addListener('mouseover', function (e) {
      var cc = e.feature.getProperty('cc');
      if (cc !== state.cc) map.data.overrideStyle(e.feature, { strokeWeight: 2.5 });
      tip.textContent = cname(cc); tip.hidden = false;
    });
    map.data.addListener('mouseout', function (e) { map.data.revertStyle(e.feature); tip.hidden = true; });
    map.data.addListener('click', function (e) { go('country', e.feature.getProperty('cc')); });

    tenders.forEach(function (t) {
      if (typeof t.lat !== 'number') return;
      var m = new gm.Marker({ map: map, position: { lat: t.lat, lng: t.lng }, title: t.city + ' · ' + t.title, icon: icon(t, false), visible: false });
      markers[t.id] = m;
      m.addListener('click', function () { go('tender', t.country, t.id); });
      m.addListener('mouseover', function () { hot(t.id, true); listHot(t.id, true); });
      m.addListener('mouseout', function () { hot(t.id, false); listHot(t.id, false); });
    });
    if (legendEl) {
      var seen = {};
      tenders.forEach(function (t) { seen[t.trade] = t.tradeName; });
      legendEl.textContent = '';
      Object.keys(seen).forEach(function (k) {
        var li = document.createElement('li'), dot = document.createElement('i'); dot.style.background = TRADE[k] || '#1c1914';
        li.appendChild(dot); li.appendChild(document.createTextNode(seen[k])); legendEl.appendChild(li);
      });
      legendEl.hidden = !Object.keys(seen).length;
    }
    loading = false;
    showMap();
  };

  function loadMap() {
    if (map) return showMap();
    if (loading) return;
    loading = true; btn.disabled = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(GOOGLE_MAPS_KEY) +
      '&callback=__stMapReady&loading=async&language=' + encodeURIComponent(lang().split('-')[0]);
    s.onerror = function () { loading = false; btn.disabled = false; showTiles(); };
    s.onload = function () { btn.disabled = false; };
    document.head.appendChild(s);
  }

  // "new this week" filter: a small pill next to the count, set from the hero counter
  function renderNewPill() {
    if (!cnt) return;
    var pill = document.getElementById('f-new');
    if (!state.newOnly) { if (pill) pill.remove(); return; }
    if (!pill) {
      pill = document.createElement('button'); pill.type = 'button'; pill.id = 'f-new'; pill.className = 'pill';
      pill.addEventListener('click', function () { state.newOnly = false; render(); });
      cnt.parentNode.insertBefore(pill, cnt.nextSibling);
    }
    pill.textContent = ((window.stLabels && window.stLabels.fresh) || 'new this week') + ' ✕';
  }
  window.stMap = {
    setNew: function (on) { state.newOnly = !!on; state.trade = ''; go('overview'); },
    reset: function () { state.newOnly = false; state.trade = ''; go('overview'); },
    view: function () { return map ? { center: map.getCenter().toJSON(), zoom: map.getZoom(), cc: state.cc } : null; }
  };
  // ---------- start ----------
  (window.stTendersReady || Promise.resolve([])).then(function (list) {
    tenders = list; list.forEach(function (t) { byId[t.id] = t; });
    if (selC) selC.addEventListener('change', function () { selC.value ? go('country', selC.value) : go('overview'); });
    if (selT) selT.addEventListener('change', function () {
      state.trade = selT.value;
      if (state.level === 'tender' && byId[state.id] && !matches(byId[state.id])) go('country', state.cc); else render();
    });
    var m = /^#map=([A-Z]{2})(?:\/(\w+))?$/.exec(location.hash);
    if (m) go(m[2] && byId[m[2]] ? 'tender' : 'country', m[1], m[2] && byId[m[2]] ? m[2] : null);
    if (haveKey) startMap(); else render();
  });

  function startMap() {
    btn.textContent = panel.dataset.btn; btn.hidden = false; note.hidden = false;
    btn.addEventListener('click', function () {
      if (mapOn) { pref('tiles'); return showTiles(); }
      pref('map'); loadMap();
    });
    render();
    if (pref() === 'tiles') return;
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); loadMap(); } }, { rootMargin: '400px 0px' });
      io.observe(panel);
    } else loadMap();
  }
})();
