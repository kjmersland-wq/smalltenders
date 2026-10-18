// Fetches real, open tenders from TED (https://ted.europa.eu) and writes tenders.json + tenders.<lang>.json.
//
//   node scripts/fetch-tenders.mjs              # all countries
//   node scripts/fetch-tenders.mjs NO SE PL     # only these countries (ISO-2), other countries are kept as they are
//
// - Source: the public TED search API (no key needed). Every tender links to its own notice page:
//   https://ted.europa.eu/<lang>/notice/-/detail/<publication-number>
// - Only open competition notices (cn-*) in the building trades and cleaning are kept, and only the
//   ones whose stated value is small enough for a small firm (unknown values are kept).
// - Places are geocoded with Nominatim (OpenStreetMap); results are cached in scripts/geocache.json.
// - Titles come from the notice itself: in the page language when the notice has it, otherwise English
//   (or the original language). Nothing is translated or rewritten, except that SHOUTED titles are recased.
// - Be gentle: the script waits between requests (TED rate-limits quickly).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PER_COUNTRY = 7;          // how many tenders to keep per country
const MIN_DAYS_LEFT = 3;        // skip notices that close within this many days
const MAX_EUR = 3_000_000;      // "small firm" ceiling (rough conversion, only used for filtering)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COUNTRIES = { NO: 'NOR', SE: 'SWE', DK: 'DNK', FI: 'FIN', IS: 'ISL', PL: 'POL', DE: 'DEU', AT: 'AUT', CZ: 'CZE', SK: 'SVK', NL: 'NLD', BE: 'BEL', LT: 'LTU', LV: 'LVA', EE: 'EST', FR: 'FRA', ES: 'ESP', IT: 'ITA', PT: 'PRT', IE: 'IRL', GB: 'GBR', CH: 'CHE', UA: 'UKR', RS: 'SRB', RO: 'ROU', MD: 'MDA', MK: 'MKD', LU: 'LUX', HU: 'HUN', GR: 'GRC', CY: 'CYP', HR: 'HRV', BG: 'BGR', BA: 'BIH', AL: 'ALB', AD: 'AND', ME: 'MNE', SI: 'SVN', XK: 'XKX' };

// site language -> { file, locale for Intl, TED page language, TED language keys in title-proc }
const LANGS = {
  en: { file: 'tenders.json', loc: 'en', ted: 'en', keys: ['eng'] },
  no: { file: 'tenders.no.json', loc: 'nb', ted: 'en', keys: ['nob', 'nor', 'nno'] },
  da: { file: 'tenders.da.json', loc: 'da', ted: 'da', keys: ['dan'] },
  sv: { file: 'tenders.sv.json', loc: 'sv', ted: 'sv', keys: ['swe'] },
  fi: { file: 'tenders.fi.json', loc: 'fi', ted: 'fi', keys: ['fin'] },
  is: { file: 'tenders.is.json', loc: 'is', ted: 'en', keys: ['isl'] },
  pl: { file: 'tenders.pl.json', loc: 'pl', ted: 'pl', keys: ['pol'] },
  de: { file: 'tenders.de.json', loc: 'de', ted: 'de', keys: ['deu'] },
  at: { file: 'tenders.at.json', loc: 'de-AT', ted: 'de', keys: ['deu'] },
  cs: { file: 'tenders.cs.json', loc: 'cs', ted: 'cs', keys: ['ces'] },
  sk: { file: 'tenders.sk.json', loc: 'sk', ted: 'sk', keys: ['slk'] },
  nl: { file: 'tenders.nl.json', loc: 'nl', ted: 'nl', keys: ['nld'] },
  be: { file: 'tenders.be.json', loc: 'nl-BE', ted: 'nl', keys: ['nld'] },
  lt: { file: 'tenders.lt.json', loc: 'lt', ted: 'lt', keys: ['lit'] },
  ee: { file: 'tenders.ee.json', loc: 'et', ted: 'et', keys: ['est'] },
  lv: { file: 'tenders.lv.json', loc: 'lv', ted: 'lv', keys: ['lav'] },
  fr: { file: 'tenders.fr.json', loc: 'fr', ted: 'fr', keys: ['fra'] },
  es: { file: 'tenders.es.json', loc: 'es', ted: 'es', keys: ['spa'] },
  it: { file: 'tenders.it.json', loc: 'it', ted: 'it', keys: ['ita'] }
};

// CPV prefixes -> trade; first match in this order wins (specific trades before the general "building").
const TRADES = [
  ['demolition', ['45110000', '45111000', '45111100']],
  ['groundworks', ['45112', '45111200', '45111210']],
  ['scaffolding', ['45262100']],
  ['roofing', ['45261']],
  ['facade', ['45443']],
  ['insulation', ['45320']],
  ['windows', ['45421', '45441', '44221']],
  ['flooring', ['45430']],
  ['painting', ['45442', '45440']],
  ['plumbing', ['45330', '45332']],
  ['hvac', ['45331']],
  ['electrical', ['4531']],
  ['cleaning', ['9091']],
  ['building', ['4521', '45200']]
];
const RATE_TO_EUR = { EUR: 1, NOK: 0.085, SEK: 0.088, DKK: 0.134, PLN: 0.23, CZK: 0.04, HUF: 0.0025, RON: 0.2, BGN: 0.51, GBP: 1.17, CHF: 1.05, ISK: 0.0065, HRK: 0.13, UAH: 0.022, RSD: 0.0085 };

// one neutral, translated sentence per language (shown after "Good fit")
const FIT = {
  en: 'for a small firm in this trade that can meet the scope and the deadline in the notice.',
  no: 'for et lite firma i dette faget som kan levere innenfor omfanget og fristen i kunngjøringen.',
  da: 'for en lille virksomhed i faget, som kan overholde omfanget og fristen i bekendtgørelsen.',
  sv: 'för ett litet företag i branschen som kan klara omfattningen och tidsfristen i annonsen.',
  fi: 'pienelle alan yritykselle, joka pystyy toteuttamaan työn ilmoituksen laajuudessa ja määräajassa.',
  is: 'fyrir lítið fyrirtæki í greininni sem getur staðið við umfang og frest auglýsingarinnar.',
  pl: 'dla małej firmy z tej branży, która sprosta zakresowi i terminowi z ogłoszenia.',
  de: 'für einen kleinen Betrieb dieses Gewerks, der Umfang und Frist der Bekanntmachung einhalten kann.',
  cs: 'pro malou firmu v oboru, která zvládne rozsah i lhůtu uvedené v oznámení.',
  sk: 'pre malú firmu v odbore, ktorá zvládne rozsah aj lehotu uvedené v oznámení.',
  nl: 'voor een klein bedrijf in dit vak dat de omvang en de deadline uit de aankondiging aankan.',
  lt: 'mažai įmonei šioje srityje, galinčiai įvykdyti skelbime nurodytą apimtį ir terminą.',
  ee: 'väikesele selle ala ettevõttele, kes saab hakkama teates toodud mahu ja tähtajaga.',
  lv: 'nelielam nozares uzņēmumam, kas var izpildīt paziņojumā norādīto apjomu un termiņu.',
  fr: 'pour une petite entreprise du métier qui peut respecter l’ampleur et le délai de l’avis.',
  es: 'para una pequeña empresa del oficio que pueda cumplir el alcance y el plazo del anuncio.',
  it: 'per una piccola impresa del settore che può rispettare l’entità e la scadenza dell’avviso.'
};
const NOT_STATED = { en: 'Value not stated', no: 'Verdi ikke oppgitt', da: 'Værdi ikke oplyst', sv: 'Värde ej angivet', fi: 'Arvoa ei ilmoitettu', is: 'Verðmæti ekki gefið upp', pl: 'Wartość nie podana', de: 'Wert nicht angegeben', cs: 'Hodnota neuvedena', sk: 'Hodnota neuvedená', nl: 'Waarde niet vermeld', lt: 'Vertė nenurodyta', ee: 'Väärtus pole märgitud', lv: 'Vērtība nav norādīta', fr: 'Valeur non indiquée', es: 'Valor no indicado', it: 'Valore non indicato' };
const VOCAB = JSON.parse(readFileSync(join(ROOT, 'scripts/vocab.json'), 'utf8'));
const vocabKey = (c) => (c === 'at' ? 'de' : c);

// ---------- TED ----------
async function ted(body, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch('https://api.ted.europa.eu/v3/notices/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    if (r.status === 429) { await sleep(8000 * (i + 1)); continue; }
    throw new Error('TED ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }
  throw new Error('TED: too many retries');
}
const FIELDS = ['publication-number', 'title-proc', 'buyer-name', 'buyer-city', 'place-of-performance-city-lot', 'place-of-performance-country-lot', 'deadline-receipt-tender-date-lot', 'estimated-value-proc', 'estimated-value-lot', 'estimated-value-cur-proc', 'estimated-value-cur-lot', 'classification-cpv', 'publication-date', 'notice-type', 'buyer-name', 'buyer-contact-point', 'organisation-email-buyer', 'organisation-tel-buyer', 'buyer-internet-address', 'description-proc'];
const first = (v) => (Array.isArray(v) ? v.find(Boolean) : v);
const day = (s) => (s ? String(s).slice(0, 10) : null);

function contactOf(n) {
  const email = [].concat(n['organisation-email-buyer'] || []).find((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  const c = { name: first(n['buyer-contact-point']), email, phone: first(n['organisation-tel-buyer']), web: first(n['buyer-internet-address']) };
  for (const k of Object.keys(c)) if (!c[k]) delete c[k];
  return Object.keys(c).length ? c : null;
}
function tradeOf(cpvs) {
  for (const [trade, prefixes] of TRADES) if ((cpvs || []).some((c) => prefixes.some((p) => String(c).startsWith(p)))) return trade;
  return null;
}
function valueOf(n) {
  const raw = first(n['estimated-value-proc']) ?? first(n['estimated-value-lot']);
  const cur = first(n['estimated-value-cur-proc']) ?? first(n['estimated-value-cur-lot']) ?? (raw ? 'EUR' : null);
  const amount = raw == null ? null : Number(raw);
  return amount > 0 ? { amount, cur } : null;
}
const toEur = (v) => (v ? v.amount * (RATE_TO_EUR[v.cur] ?? 1) : 0);

async function fetchCountry(cc) {
  const q = `publication-date>=${new Date(Date.now() - 75 * 864e5).toISOString().slice(0, 10).replace(/-/g, '')} AND place-of-performance-country-lot=${COUNTRIES[cc]} AND notice-type=cn-standard AND (classification-cpv=45* OR classification-cpv=9091*)`;
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const j = await ted({ query: q, fields: FIELDS, limit: 100, page, scope: 'ACTIVE' });
    out.push(...(j.notices || []));
    if ((j.notices || []).length < 100) break;
    await sleep(2500);
  }
  const today = Date.now() + MIN_DAYS_LEFT * 864e5;
  const ok = [];
  for (const n of out) {
    const trade = tradeOf(n['classification-cpv']);
    const dl = day(first(n['deadline-receipt-tender-date-lot']));
    const v = valueOf(n);
    const title = n['title-proc'];
    if (!trade || !dl || !title || new Date(dl).getTime() < today) continue;
    if (v && toEur(v) > MAX_EUR) continue;
    const place = first(n['place-of-performance-city-lot']);
    const buyerCity = n['buyer-city'] && Object.values(n['buyer-city']).flat().find(Boolean);
    ok.push({ id: n['publication-number'], cc, trade, deadline: dl, published: day(n['publication-date']), value: v, titles: title, buyer: n['buyer-name'], desc: n['description-proc'], contact: contactOf(n), city: (typeof place === 'string' ? place : buyerCity) || null });
  }
  // spread over trades, newest first, a few per trade at most
  ok.sort((a, b) => (b.published || '').localeCompare(a.published || ''));
  const byTrade = {};
  for (const t of ok) (byTrade[t.trade] ||= []).push(t);
  const picked = [];
  for (let round = 0; picked.length < PER_COUNTRY && round < 3; round++) {
    for (const trade of Object.keys(byTrade)) { const t = byTrade[trade][round]; if (t && picked.length < PER_COUNTRY && t.city) picked.push(t); }
  }
  return picked;
}

// ---------- geocoding ----------
const GEO_FILE = join(ROOT, 'scripts/geocache.json');
const geo = existsSync(GEO_FILE) ? JSON.parse(readFileSync(GEO_FILE, 'utf8')) : {};
async function geocode(city, cc) {
  const key = cc + '|' + city.toLowerCase();
  if (key in geo) return geo[key];
  await sleep(1200);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&accept-language=en&countrycodes=${cc.toLowerCase()}&q=${encodeURIComponent(city)}`;
  const r = await fetch(url, { headers: { 'user-agent': 'smalltenders.com tender fetcher (support@smalltenders.com)' } });
  let res = null;
  if (r.ok) {
    const j = await r.json();
    if (j[0]) { const a = j[0].address || {}; res = { lat: +(+j[0].lat).toFixed(3), lng: +(+j[0].lon).toFixed(3), region: a.state || a.county || a.region || a.province || '' }; }
  }
  geo[key] = res; writeFileSync(GEO_FILE, JSON.stringify(geo, null, 1));
  return res;
}

// ---------- text helpers ----------
function tidy(s) {
  s = String(s).replace(/\s+/g, ' ').replace(/^[\s\-–:]+|[\s\-–:]+$/g, '');
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (letters.length > 6 && letters === letters.toUpperCase()) s = s.toLowerCase().replace(/^\p{L}/u, (c) => c.toUpperCase());
  if (s.length > 130) s = s.slice(0, 127).replace(/\s+\S*$/, '') + '…';
  return s;
}
function titleFor(titles, keys) {
  for (const k of keys) if (titles[k]) return tidy(Array.isArray(titles[k]) ? titles[k][0] : titles[k]);
  const e = titles.eng || Object.values(titles)[0];
  return tidy(Array.isArray(e) ? e[0] : e);
}
// text of a multilingual TED field in the page language, else English, else whatever there is
function textFor(map, keys) {
  if (!map) return '';
  if (typeof map === 'string') return map;
  for (const k of [...keys, 'eng']) if (map[k]) return [].concat(map[k]).find(Boolean) || '';
  return [].concat(Object.values(map)[0] || []).find(Boolean) || '';
}
function shortText(s, max = 320) {
  s = String(s || '').replace(/^\s*(Bakgrunn|Background|Beskrivelse av oppdraget)\s*\n+/i, '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max), dot = cut.lastIndexOf('. ');
  return (dot > max * 0.5 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, '') + '…');
}
function cityName(c) { const s = c.trim(); return s === s.toUpperCase() && s.length > 3 ? s.toLowerCase().replace(/(^|[\s\-])\p{L}/gu, (m) => m.toUpperCase()) : s; }
function money(v, loc, code) {
  if (!v) return NOT_STATED[vocabKey(code)] || NOT_STATED.en;
  try { return new Intl.NumberFormat(loc, { style: 'currency', currency: v.cur || 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(v.amount); }
  catch { return `${Math.round(v.amount).toLocaleString(loc)} ${v.cur || ''}`.trim(); }
}

// ---------- main ----------
const only = process.argv.slice(2).map((s) => s.toUpperCase());
const wanted = only.length ? only : Object.keys(COUNTRIES);
const keep = {};            // previous entries of countries we are not refreshing
if (only.length) { for (const t of JSON.parse(readFileSync(join(ROOT, 'tenders.json'), 'utf8')).tenders) if (!only.includes(t.country)) (keep[t.country] ||= []).push(t.id); }

const found = [];
for (const cc of wanted) {
  try {
    const list = await fetchCountry(cc);
    let n = 0;
    for (const t of list) {
      const g = await geocode(cityName(t.city), cc);
      if (!g) continue;
      t.g = g; t.cityName = cityName(t.city); found.push(t); n++;
    }
    console.log(cc, 'kept', n, 'of', list.length);
  } catch (e) { console.log(cc, 'skipped:', e.message); }
  await sleep(2500);
}

const dn = (loc) => new Intl.DisplayNames([loc], { type: 'region' });
for (const [code, L] of Object.entries(LANGS)) {
  const file = join(ROOT, L.file);
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { tenders: [] };
  const old = only.length ? prev.tenders.filter((t) => !only.includes(t.country)) : [];
  const V = VOCAB[vocabKey(code)];
  const names = dn(L.loc);
  const fresh = found.map((t) => ({
    id: t.id,
    country: t.cc,
    countryName: names.of(t.cc) || t.cc,
    city: t.cityName,
    region: t.g.region || t.cityName,
    lat: t.g.lat,
    lng: t.g.lng,
    trade: t.trade,
    tradeName: V.tradeName[t.trade],
    title: titleFor(t.titles, L.keys),
    buyer: tidy(textFor(t.buyer, L.keys)),
    description: shortText(textFor(t.desc, L.keys)),
    contact: t.contact || undefined,
    deadline: t.deadline,
    value: money(t.value, L.loc, code),
    source: 'TED',
    fit: FIT[vocabKey(code)] || FIT.en,
    link: `https://ted.europa.eu/${L.ted}/notice/-/detail/${t.id}`,
    published: t.published
  }));
  const note = 'Open tenders from TED (ted.europa.eu), fetched with scripts/fetch-tenders.mjs. ' +
    "'link' is the notice page on TED. Titles are the notice's own (page language where the notice has it, otherwise English or the original language).";
  writeFileSync(file, JSON.stringify({ _note: note, _fetched: new Date().toISOString().slice(0, 10), tenders: [...old, ...fresh] }, null, 1));
}
console.log('done:', found.length, 'tenders in', Object.keys(LANGS).length, 'files');
