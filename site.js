// Site-wide settings. Change the values here and they update everywhere on the site.
window.SITE = {
  price: 29,                              // euros per month. Shown on every page (hero, pricing card, subscribe button)
  email: 'support@smalltenders.com',      // shown in the pricing card, footer and contact page
  checkoutUrl: '',                        // paste the Creem checkout link here to turn on the Subscribe button
  formEndpoint: ''                        // optional: a form service URL (e.g. Formspree). Empty = the contact form opens your email app
};

(function () {
  var S = window.SITE;
  // price: a plain number in SITE.price (e.g. 29), shown in the page language ("€29", "29 €" ...)
  function money(v) {
    if (typeof v !== 'number') return String(v);
    try { return new Intl.NumberFormat(document.documentElement.lang || 'en', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v); }
    catch (e) { return '€' + v; }
  }
  document.querySelectorAll('[data-site="price"]').forEach(function (n) { n.textContent = money(S.price); });
  // language dropdown
  document.querySelectorAll('.lang-select').forEach(function (sel) {
    sel.addEventListener('change', function () { if (sel.value) window.location.href = sel.value; });
  });
  document.querySelectorAll('[data-site="email"]').forEach(function (n) {
    n.textContent = S.email; n.setAttribute('href', 'mailto:' + S.email);
  });
  document.querySelectorAll('a[data-site="checkout"]').forEach(function (n) {
    if (S.checkoutUrl) { n.setAttribute('href', S.checkoutUrl); n.setAttribute('rel', 'noopener'); }
  });

  // nav: a soft shadow once the page has scrolled
  (function () {
    var nav = document.querySelector('.nav'); if (!nav) return;
    function on() { nav.classList.toggle('scrolled', window.scrollY > 8); }
    window.addEventListener('scroll', on, { passive: true }); on();
  })();
  // trade strip under the hero: one chip per trade (labels come from the page's own trade filter, so it is localised)
  (function () {
    var sel = document.getElementById('f-trade'), hero = document.querySelector('.hero');
    if (!sel || !hero) return;
    var ICON = window.stIcons = {
      electrical: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
      plumbing: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
      hvac: 'M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0M12 10V4a3 3 0 0 1 3 3M14 12h6a3 3 0 0 1-3 3M12 14v6a3 3 0 0 1-3-3M10 12H4a3 3 0 0 1 3-3',
      painting: 'M5 4h12a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM18 7h2v5h-8v3M11 15v6',
      building: 'M3 6h18v12H3zM3 12h18M9 6v6M15 12v6',
      cleaning: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
      roofing: 'M2 13L12 5l10 8M5 11v8h14v-8M12 15v4',
      flooring: 'M3 6h18v12H3zM3 10h18M3 14h18M9 6v4M15 10v4M9 14v4',
      windows: 'M4 4h16v16H4zM12 4v16M4 12h16',
      insulation: 'M3 8c3 0 3 3 6 3s3-3 6-3 3 3 6 3M3 14c3 0 3 3 6 3s3-3 6-3 3 3 6 3',
      facade: 'M5 21V4h14v17M9 8h2M13 8h2M9 12h2M13 12h2M9 16h2M13 16h2',
      groundworks: 'M15 4l5 5M9 10l5 5M5 19l5-5M3 21l2-6 4 4z',
      demolition: 'M4 20l8-8M10 4l10 10M12 6l6 6-3 3-6-6z',
      scaffolding: 'M5 3v18M19 3v18M5 8h14M5 14h14M5 20h14M5 8l14 6M5 14l14 6'
    };
    var strip = document.createElement('section'); strip.className = 'tradestrip';
    var wrap = document.createElement('div'); wrap.className = 'wrap';
    var list = document.createElement('ul'); list.className = 'ts-list';
    Array.prototype.forEach.call(sel.options, function (o) {
      if (!o.value || !ICON[o.value]) return;
      var li = document.createElement('li'), b = document.createElement('button'); b.type = 'button';
      var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); p.setAttribute('d', ICON[o.value]); svg.appendChild(p);
      b.appendChild(svg); b.appendChild(document.createTextNode(o.text.replace(/\s*\(.*\)\s*$/, '')));
      b.addEventListener('click', function () {
        sel.value = o.value; sel.dispatchEvent(new Event('change'));
        var c = document.getElementById('coverage'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      li.appendChild(b); list.appendChild(li);
    });
    wrap.appendChild(list); strip.appendChild(wrap);
    hero.parentNode.insertBefore(strip, hero.nextSibling);
  })();
  // contact form
  var form = document.getElementById('contact-form');
  if (!form) return;
  var status = document.getElementById('contact-status');
  function say(msg, ok) { status.textContent = msg; status.className = 'cf-status ' + (ok ? 'ok' : 'err'); status.hidden = false; }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = new FormData(form);
    if (d.get('website')) return; // honeypot: bots fill this in
    var name = String(d.get('name') || '').trim(), email = String(d.get('email') || '').trim(), msg = String(d.get('message') || '').trim();
    if (S.formEndpoint) {
      fetch(S.formEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ name: name, email: email, message: msg }) })
        .then(function (r) { if (!r.ok) throw new Error(); form.reset(); say(form.dataset.ok, true); })
        .catch(function () { say(form.dataset.fail.replace('{email}', S.email), false); });
    } else {
      var body = 'Name: ' + name + '\nEmail: ' + email + '\n\n' + msg;
      window.location.href = 'mailto:' + S.email + '?subject=' + encodeURIComponent('Message from ' + name) + '&body=' + encodeURIComponent(body);
      say(form.dataset.mailto.replace('{email}', S.email), true);
    }
  });
})();
