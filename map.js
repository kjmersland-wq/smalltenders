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

  var COLORS = { 1: '#9a3b16', 2: '#e8bfa5', 3: '#fffdf8' };
  var TRADE = { electrical: '#1d5fa8', plumbing: '#1b7f8e', hvac: '#6b4aa0', painting: '#c28a00', building: '#4d6b2f', cleaning: '#a23a6b' };
  var EUROPE = { north: 71.5, south: 46, west: -24.5, east: 32 };
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
  var state = { level: 'overview', cc: null, id: null };

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
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== state.level; });
    tiles.querySelectorAll('li').forEach(function (li) {
      li.classList.toggle('sel', !!state.cc && li.querySelector('b').textContent === state.cc);
    });
    if (state.level === 'country') renderCountry();
    if (state.level === 'tender') renderTender();
    applyMap();
    if (state.level !== 'overview' && window.matchMedia('(max-width: 900px)').matches) {
      side.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    var f = views[state.level]; if (f && f.hasAttribute('tabindex') && state.level !== 'overview') f.focus({ preventScroll: true });
  }

  function listFor(cc) { return tenders.filter(function (t) { return t.country === cc; }); }

  function renderCountry() {
    var v = views.country, cc = state.cc, list = listFor(cc);
    v.querySelector('.back').textContent = '← ' + D.backAll;
    v.querySelector('.ms-country').textContent = cname(cc);
    var cw = list.length === 1 ? D.countOne : D.countMany;
    v.querySelector('.ms-count').textContent = list.length ? (cw.indexOf('{n}') > -1 ? cw.replace('{n}', list.length) : list.length + ' ' + cw) : '';
    var ul = v.querySelector('.tlist'); ul.textContent = '';
    list.forEach(function (t) {
      var li = el('li'), b = el('button'); b.type = 'button'; b.dataset.id = t.id;
      var top = el('span', 'tl-top');
      var dot = el('i'); dot.style.background = TRADE[t.trade] || '#1c1914';
      top.appendChild(dot); top.appendChild(el('b', '', t.city + ' · ' + t.region));
      b.appendChild(top);
      b.appendChild(el('span', 'tl-title', t.title));
      b.appendChild(el('small', '', t.tradeName + ' · ' + D.deadline + ' ' + fmt(t) + ' · ' + t.value));
      b.addEventListener('click', function () { go('tender', cc, t.id); });
      b.addEventListener('mouseenter', function () { hot(t.id, true); });
      b.addEventListener('mouseleave', function () { hot(t.id, false); });
      b.addEventListener('focus', function () { hot(t.id, true); });
      b.addEventListener('blur', function () { hot(t.id, false); });
      li.appendChild(b); ul.appendChild(li);
    });
    var more = v.querySelector('.cp-more'); more.textContent = '';
    if (!list.length) more.appendChild(el('span', 'empty', fill(D.none, { country: cname(cc) })));
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
    if (t.link) {
      var l = el('a', 'btn', D.original + ' ↗'); l.href = t.link; l.target = '_blank'; l.rel = 'noopener'; foot.appendChild(l);
    } else foot.appendChild(el('span', 'tc-src', D.sample));
    if (t.source) foot.appendChild(el('span', 'tc-from', ' · ' + t.source));
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
    return { path: gm.SymbolPath.CIRCLE, scale: big ? 13 : 9, fillColor: TRADE[t.trade] || '#1c1914', fillOpacity: 1, strokeColor: big ? '#1c1914' : '#ffffff', strokeWeight: big ? 3 : 2.5 };
  }
  function hot(id, on) {
    var m = markers[id]; if (!m || !map) return;
    m.setIcon(icon(byId[id], on || state.id === id)); m.setZIndex(on || state.id === id ? 10 : 1);
  }

  function applyMap() {
    if (!map || !mapOn) return;
    var gm = google.maps;
    map.data.setStyle(function (f) {
      var cc = f.getProperty('cc'), on = !state.cc || cc === state.cc;
      return { fillColor: COLORS[f.getProperty('wave')], fillOpacity: on ? 0.9 : 0.22, strokeColor: '#1c1914', strokeWeight: state.cc && cc === state.cc ? 3 : 1, clickable: true, cursor: 'pointer' };
    });
    tenders.forEach(function (t) {
      var m = markers[t.id]; if (!m) return;
      m.setVisible(state.level !== 'overview' && t.country === state.cc);
      m.setIcon(icon(t, state.id === t.id)); m.setZIndex(state.id === t.id ? 10 : 1);
    });
    gm.event.trigger(map, 'resize');
    if (state.level === 'overview') map.fitBounds(EUROPE, 0);
    else if (state.level === 'country' && bounds[state.cc]) map.fitBounds(bounds[state.cc], 28);
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
    map.data.setStyle({ fillColor: '#fffdf8', fillOpacity: 0.9, strokeColor: '#1c1914', strokeWeight: 1 });
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
      m.addListener('mouseover', function () { hot(t.id, true); });
      m.addListener('mouseout', function () { hot(t.id, false); });
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

  // ---------- start ----------
  (window.stTendersReady || Promise.resolve([])).then(function (list) {
    tenders = list; list.forEach(function (t) { byId[t.id] = t; });
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
