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
