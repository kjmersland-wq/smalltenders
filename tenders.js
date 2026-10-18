// Tender data, cards, filters and the per-country panel.
// Server-rendered cards in the page stay as the fallback if this script or tenders.json fails.
(function () {
  var box = document.getElementById('tenders');
  var selC = document.getElementById('f-country');
  var selT = document.getElementById('f-trade');
  var count = document.getElementById('f-count');
  var panel = document.getElementById('countrypanel');
  var T = (box && box.dataset) || {};
  var P = (panel && panel.dataset) || {};
  var all = [];
  var resolveReady;
  var api = window.stTenders = { all: all, ready: new Promise(function (r) { resolveReady = r; }) };
  window.stTendersReady = api.ready;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }
  function daysLeft(t) {
    if (typeof t.deadlineDays === 'number') return t.deadlineDays;
    if (!t.deadline) return null;
    return Math.max(0, Math.ceil((new Date(t.deadline) - new Date()) / 86400000));
  }
  function card(t) {
    var a = el('article', 'tcard');
    var top = el('div', 'tc-top');
    top.appendChild(el('span', 'chip', t.tradeName));
    top.appendChild(el('span', 'tc-cc', t.countryName));
    a.appendChild(top);
    a.appendChild(el('h3', '', t.title));
    a.appendChild(el('p', 'tc-where', (t.city ? t.city + ' · ' : '') + t.region));
    var b = el('div', 'badges');
    var d = daysLeft(t);
    if (d !== null) b.appendChild(el('span', 'badge dl', (T.daysLeft || P.daysLeft || '{n} days left').replace('{n}', d)));
    if (t.value) b.appendChild(el('span', 'badge', t.value));
    a.appendChild(b);
    var fit = el('p', 'fitbox');
    fit.appendChild(el('b', '', T.fit || P.fit || 'Good fit'));
    fit.appendChild(document.createTextNode(' ' + t.fit));
    a.appendChild(fit);
    var foot = el('p', 'tc-src');
    if (t.link) {
      var l = el('a', '', T.original || P.original || 'View the original notice');
      l.href = t.link; l.rel = 'noopener'; l.target = '_blank';
      foot.appendChild(l);
    } else {
      foot.textContent = T.sample || P.sample || 'Sample entry. The link to the original notice comes with the live list.';
    }
    if (t.source) foot.appendChild(el('span', 'tc-from', ' · ' + t.source));
    a.appendChild(foot);
    return a;
  }
  api.card = card;
  api.daysLeft = daysLeft;

  // ---- filtered list in "A peek at an issue"
  function render() {
    var c = selC.value, tr = selT.value;
    var list = all.filter(function (t) { return (!c || t.country === c) && (!tr || t.trade === tr); });
    box.textContent = '';
    list.forEach(function (t) { box.appendChild(card(t)); });
    if (!list.length) box.appendChild(el('p', 'empty', T.empty || 'Nothing matches those filters yet.'));
    var w = list.length === 1 ? (T.one || 'entry') : (T.many || 'entries');
    count.textContent = w.indexOf('{n}') > -1 ? w.replace('{n}', list.length) : list.length + ' ' + w;
  }

  // ---- panel for one country (opened from the map or the tiles)
  var tileHref = {};
  var tiles = document.querySelectorAll('.tilemap a');
  var names = {};
  try { names = JSON.parse(P.names || '{}'); } catch (e) { names = {}; }
  tiles.forEach(function (a) { tileHref[a.querySelector('b').textContent] = a.getAttribute('href'); });

  api.showCountry = function (cc) {
    if (!panel) return;
    var list = all.filter(function (t) { return t.country === cc; });
    var name = names[cc] || cc;
    panel.textContent = '';
    var head = el('div', 'cp-head');
    head.appendChild(el('h3', '', name));
    var close = el('button', 'cp-close', P.close || 'Close');
    close.type = 'button';
    close.addEventListener('click', function () { panel.hidden = true; });
    head.appendChild(close);
    panel.appendChild(head);
    if (list.length) {
      var grid = el('div', 'cards cp-cards');
      list.forEach(function (t) { grid.appendChild(card(t)); });
      panel.appendChild(grid);
    } else {
      panel.appendChild(el('p', 'empty', (P.none || 'No entries for {country} yet. We start in the Nordics and add countries step by step.').replace('{country}', name)));
    }
    if (tileHref[cc]) {
      var more = el('p', 'cp-more');
      var l = el('a', '', P.open || 'Read this page in the local language');
      l.href = tileHref[cc];
      more.appendChild(l);
      panel.appendChild(more);
    }
    panel.hidden = false;
    if (panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // tiles (the fallback map) open the same panel
  tiles.forEach(function (a) {
    a.addEventListener('click', function (e) {
      if (!panel || !all.length) return; // no data yet: let the link work as a normal link
      e.preventDefault();
      api.showCountry(a.querySelector('b').textContent);
    });
  });

  // ---- live counters in the hero: open tenders and new this week
  var LABELS = {
    en: ['open tenders', 'new this week', 'example data'], nb: ['åpne anbud', 'nye denne uken', 'eksempeldata'], da: ['åbne udbud', 'nye denne uge', 'eksempeldata'],
    sv: ['öppna upphandlingar', 'nya den här veckan', 'exempeldata'], fi: ['avointa hankintaa', 'uutta tällä viikolla', 'esimerkkitietoja'], is: ['opin útboð', 'ný í þessari viku', 'sýnigögn'],
    pl: ['otwartych przetargów', 'nowych w tym tygodniu', 'dane przykładowe'], de: ['offene Ausschreibungen', 'neu diese Woche', 'Beispieldaten'], cs: ['otevřených zakázek', 'nových tento týden', 'ukázková data'],
    sk: ['otvorených zákaziek', 'nových tento týždeň', 'ukážkové údaje'], nl: ['open aanbestedingen', 'nieuw deze week', 'voorbeeldgegevens'], lt: ['atvirų pirkimų', 'naujų šią savaitę', 'pavyzdiniai duomenys'],
    et: ['avatud hanget', 'uut sel nädalal', 'näidisandmed'], lv: ['atvērti iepirkumi', 'jauni šonedēļ', 'parauga dati'], fr: ['marchés ouverts', 'nouveaux cette semaine', 'données d’exemple'],
    es: ['licitaciones abiertas', 'nuevas esta semana', 'datos de ejemplo'], it: ['appalti aperti', 'nuovi questa settimana', 'dati di esempio']
  };
  var lang = (document.documentElement.lang || 'en').toLowerCase();
  var L = LABELS[lang] || LABELS[lang.split('-')[0]] || LABELS.en;
  api.labels = { open: L[0], fresh: L[1], example: L[2] };
  window.stLabels = api.labels;

  function ageDays(t) {
    if (t.published) return Math.max(0, Math.floor((new Date() - new Date(t.published)) / 86400000));
    return typeof t.publishedDaysAgo === 'number' ? t.publishedDaysAgo : 999;
  }
  api.isOpen = function (t) { return t.deadline ? new Date(t.deadline) >= new Date() : true; };
  api.isNew = function (t) { return ageDays(t) <= 7; };

  function buildStats() {
    var host = document.querySelector('.hero .hero-grid > div'); if (!host || document.querySelector('.hero-stats')) return;
    var open = all.filter(api.isOpen), fresh = open.filter(api.isNew);
    var box = el('div', 'hero-stats');
    function stat(n, label, onclick) {
      var a = el('a', 'stat'); a.href = '#coverage';
      a.appendChild(el('b', '', String(n))); a.appendChild(el('span', '', label));
      a.addEventListener('click', function (e) { e.preventDefault(); onclick(); var c = document.getElementById('coverage'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      return a;
    }
    box.appendChild(stat(open.length, L[0], function () { if (window.stMap) window.stMap.reset(); }));
    box.appendChild(el('i', 'stat-sep'));
    box.appendChild(stat(fresh.length, L[1], function () { if (window.stMap) window.stMap.setNew(true); }));
    if (open.length && open.every(function (t) { return t.sample; })) box.appendChild(el('small', 'stat-note', L[2]));
    host.appendChild(box);
  }

  var stage = document.getElementById('mapstage');
  fetch((stage && stage.dataset.tenders) || (box && box.dataset.src) || (panel && panel.dataset.src) || '/tenders.json').then(function (r) { return r.json(); }).then(function (j) {
    var list = j.tenders || [];
    list.forEach(function (t) { all.push(t); });
    if (box && selC && selT && all.length) {
      selC.addEventListener('change', render);
      selT.addEventListener('change', render);
      render();
    }
    buildStats();
    resolveReady(all);
  }).catch(function () { resolveReady([]); /* keep the server-rendered cards */ });
})();
