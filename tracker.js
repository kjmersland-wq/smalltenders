(function() {
  const ENDPOINT = 'https://www.km-techlabs.com/api/collect';
  const SITE = document.currentScript?.getAttribute('data-site') || location.hostname;

  function getDevice() {
    const w = innerWidth;
    return w < 768 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop';
  }

  function send(event, extra = {}) {
    const payload = {
      site: SITE,
      event,
      path: location.pathname + location.search,
      referrer: document.referrer || null,
      title: document.title || null,
      device: getDevice(),
      lang: navigator.language || null,
      screen: `${screen.width}x${screen.height}`,
      ...extra,
      t: Date.now()
    };
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, body);
    else fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }

  send('pageview');

  document.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (a?.href && a.host !== location.host) send('outbound', { url: a.href });
  });
})();
