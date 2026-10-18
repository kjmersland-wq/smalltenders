// Click-to-load Google Map for the "Where we look" section.
// Nothing from Google is requested until a visitor clicks the button.
// Without a valid key (or if Google rejects it) the static tile map stays in place.

// Put your Google Maps JavaScript API key here (restrict it to smalltenders.com in Google Cloud).
const GOOGLE_MAPS_KEY = 'AIzaSyBgoNqkHj-teEQ4O3tqMhs8DEC-gtPbMEI';

(function () {
  var panel = document.getElementById('mappanel');
  if (!panel || !GOOGLE_MAPS_KEY || GOOGLE_MAPS_KEY === 'GOOGLE_MAPS_KEY') return;

  var tiles = panel.querySelector('.tilemap');
  var canvas = panel.querySelector('.gmap');
  var tip = panel.querySelector('.maptip');
  var btn = panel.querySelector('.mapload');
  var note = panel.querySelector('.mapnote');
  var labels = { show: panel.dataset.btn, back: panel.dataset.back };
  var COLORS = { 1: '#9a3b16', 2: '#e8bfa5', 3: '#fffdf8' };
  var info = {};
  tiles.querySelectorAll('a').forEach(function (a) {
    info[a.querySelector('b').textContent] = { href: a.getAttribute('href'), name: a.querySelector('span').textContent };
  });

  var map = null, loading = false, showingMap = false;
  btn.textContent = labels.show;
  btn.hidden = false;
  note.hidden = false;

  function showTiles() {
    showingMap = false;
    canvas.hidden = true; tip.hidden = true; tiles.hidden = false;
    btn.textContent = labels.show;
  }
  function showMap() {
    showingMap = true;
    tiles.hidden = true; canvas.hidden = false;
    btn.textContent = labels.back;
    if (map) google.maps.event.trigger(map, 'resize');
  }
  window.gm_authFailure = function () { map = null; loading = false; showTiles(); };

  window.__stMapReady = function () {
    var gm = google.maps;
    tiles.hidden = true; canvas.hidden = false; // the map needs a visible, sized container to fit its bounds
    map = new gm.Map(canvas, {
      center: { lat: 55, lng: 14 }, zoom: 4, minZoom: 3, maxZoom: 7,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false,
      gestureHandling: 'cooperative',
      restriction: { latLngBounds: { north: 75, south: 33, west: -35, east: 45 }, strictBounds: false },
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
    var fit = function () { map.fitBounds({ north: 71.5, south: 46, west: -24.5, east: 32 }, 0); };
    fit();
    gm.event.addListenerOnce(map, 'idle', fit);
    map.data.loadGeoJson(panel.dataset.src);
    map.data.setStyle(function (f) {
      return { fillColor: COLORS[f.getProperty('wave')], fillOpacity: 0.9, strokeColor: '#1c1914', strokeWeight: 1, clickable: true, cursor: 'pointer' };
    });
    map.data.addListener('mouseover', function (e) {
      var i = info[e.feature.getProperty('cc')];
      map.data.overrideStyle(e.feature, { strokeWeight: 2.5 });
      if (i) { tip.textContent = i.name; tip.hidden = false; }
    });
    map.data.addListener('mouseout', function (e) {
      map.data.revertStyle(e.feature); tip.hidden = true;
    });
    map.data.addListener('click', function (e) {
      var i = info[e.feature.getProperty('cc')];
      if (i) window.location.href = i.href;
    });
    loading = false;
    showMap();
  };

  btn.addEventListener('click', function () {
    if (showingMap) return showTiles();
    if (map) return showMap();
    if (loading) return;
    loading = true; btn.disabled = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(GOOGLE_MAPS_KEY) +
      '&callback=__stMapReady&loading=async&language=' + encodeURIComponent(document.documentElement.lang.split('-')[0]);
    s.onerror = function () { loading = false; btn.disabled = false; showTiles(); };
    s.onload = function () { btn.disabled = false; };
    document.head.appendChild(s);
  });
})();
