// Country landing pages: fills in the counters and the recent tenders from tenders.json,
// so the page stays current when real tenders replace the data.
(function () {
  var cc = document.body.dataset.country, name = document.body.dataset.name || cc;
  var cards = document.getElementById('c-cards'), stats = document.getElementById('c-stats');
  if (!cc || !cards) return;

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
  function deadline(t) { return t.deadline ? new Date(t.deadline) : new Date(Date.now() + (t.deadlineDays || 0) * 86400000); }
  function daysLeft(t) { return Math.max(0, Math.ceil((deadline(t) - new Date()) / 86400000)); }
  function ageDays(t) {
    if (t.published) return Math.max(0, Math.floor((new Date() - new Date(t.published)) / 86400000));
    return typeof t.publishedDaysAgo === 'number' ? t.publishedDaysAgo : 999;
  }
  var CLOCK = 'M12 7v5l3 2';


  function card(t) {
    var a = el('article', 'tcard');
    var top = el('div', 'tc-top'); top.appendChild(el('span', 'chip', t.tradeName)); top.appendChild(el('span', 'tc-cc', t.city));
    a.appendChild(top);
    var h = el('h3'); var hl = el('a', 'c-title', t.title); hl.href = '/#map=' + cc + '/' + t.id; h.appendChild(hl); a.appendChild(h);
    a.appendChild(el('p', 'tc-where', t.city + ' · ' + t.region));
    var b = el('div', 'badges');
    b.appendChild(el('span', 'badge dl', daysLeft(t) + ' days left'));
    if (t.value) b.appendChild(el('span', 'badge', t.value));
    a.appendChild(b);
    var fit = el('p', 'fitbox'); fit.appendChild(el('b', '', 'Good fit')); fit.appendChild(document.createTextNode(' ' + t.fit)); a.appendChild(fit);
    var row = el('div', 'c-links');
    var url = t.link;                                               // exact notice page from tenders.json
    if (url) { var o = el('a', 'c-orig', 'Original notice · ' + (t.source || '') + ' ↗'); o.href = url; o.target = '_blank'; o.rel = 'noopener'; row.appendChild(o); }
    var m = el('a', 'c-open', 'Open on the map →'); m.href = '/#map=' + cc + '/' + t.id; row.appendChild(m);
    a.appendChild(row);
    return a;
  }
  fetch('/tenders.json').then(function (r) { return r.json(); }).then(function (j) {
    var list = (j.tenders || []).filter(function (t) { return t.country === cc; }).sort(function (a, b) { return deadline(a) - deadline(b); });
    if (!list.length) { cards.appendChild(el('p', 'empty', 'No entries for ' + name + ' right now. We add notices as we find them.')); return; }
    list.slice(0, 4).forEach(function (t) { cards.appendChild(card(t)); });
    if (stats) {
      var fresh = list.filter(function (t) { return ageDays(t) <= 7; }).length;
      [[list.length, 'open tenders'], [fresh, 'new this week']].forEach(function (s, i) {
        var a = el('a', 'stat'); a.href = '/#map=' + cc;
        a.appendChild(el('b', '', String(s[0]))); a.appendChild(el('span', '', s[1])); stats.appendChild(a);
        if (i === 0) stats.appendChild(el('i', 'stat-sep'));
      });
      stats.hidden = false;
    }
  }).catch(function () {
    cards.appendChild(el('p', 'empty', 'The tender list could not be loaded. Open the map to see the tenders.'));
  });
})();
