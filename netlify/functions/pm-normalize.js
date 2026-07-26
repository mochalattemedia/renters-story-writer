/**
 * pm-normalize.js  ·  pn-v4
 * Renters.com  ·  PM Feed Sync (Element Z)
 *
 * Reads a property manager's rental syndication XML feed and flattens it to
 * canonical per-UNIT records ready for the diff engine.
 *
 * Targets the industry-standard rental listing feed schema that property
 * management software emits for syndication. Handles both flat listings
 * (single family, individual units) and community listings with floorplan
 * and unit-level nesting.
 *
 * Deliberately self-contained. Does not import feed-probe.js.
 *
 * CHANGELOG
 *   pn-v4  2026-07-25  Version stamped on every response including errors.
 *                      Bare URL now returns a ready/usage payload instead of
 *                      a 400, so deployed version can be checked in a browser.
 *   pn-v3  2026-07-25  Vendor-neutral comments throughout. No third-party
 *                      names in source except the literal wire-format root
 *                      tag, which is a data match, not a dependency.
 *   pn-v2  2026-07-25  Hardened root detection. An HTML error page parsed as
 *                      valid XML with zero listings, which downstream would
 *                      read as "PM has no inventory" and delist everything.
 *                      Unrecognized roots now hard-reject.
 *   pn-v1  2026-07-25  Initial build. Flat + community shapes, floorplan
 *                      inheritance, ListingTag extraction, deposit string
 *                      parsing, dual external keys, per-unit issue codes.
 *
 * ENDPOINTS
 *   GET  ?url=<feedUrl>[&summary=1][&limit=N][&token=...]
 *   POST { url } | { xml }
 *
 * ENV (optional)
 *   PM_FEED_TOKEN   if set, required as ?token= . If unset, no auth.
 */

'use strict';

const { XMLParser } = require('fast-xml-parser');
const crypto = require('crypto');

const NORM_VERSION = 'pn-v4';
const PHOTO_CAP = 10;
const FETCH_TIMEOUT_MS = 25000;

/* ------------------------------------------------------------------ *
 * primitives
 * ------------------------------------------------------------------ */

function arr(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function get(obj, names) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const n of names) {
    const v = obj[n];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  const lower = {};
  for (const k of Object.keys(obj)) lower[k.toLowerCase()] = obj[k];
  for (const n of names) {
    const v = lower[n.toLowerCase()];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function txt(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'object') {
    if (v['#text'] !== undefined && v['#text'] !== null) {
      const s = String(v['#text']).trim();
      return s === '' ? null : s;
    }
    return null;
  }
  const s = String(v).trim();
  return s === '' ? null : s;
}

function num(v) {
  const t = txt(v);
  if (t === null) return null;
  const n = parseFloat(t.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function bool(v) {
  const t = txt(v);
  if (t === null) return null;
  const s = t.toLowerCase();
  if (s === 'true' || s === 'yes' || s === '1' || s === 'y') return true;
  if (s === 'false' || s === 'no' || s === '0' || s === 'n') return false;
  return null;
}

function firstDefined(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
  return null;
}

function sha(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* ------------------------------------------------------------------ *
 * tags, photos, deposits
 * ------------------------------------------------------------------ */

// Spec has typos such as "HEATING _SYSTEM". Strip all whitespace.
function normTagType(t) {
  return String(t || '').replace(/\s+/g, '').toUpperCase();
}

function collectTags(node, keys) {
  const out = {};
  for (const key of keys) {
    for (const t of arr(get(node, [key]))) {
      if (!t || typeof t !== 'object') continue;
      const type = normTagType(t['@_type']);
      if (!type) continue;
      const vals = arr(get(t, ['tag'])).map(txt).filter(Boolean);
      if (!vals.length) continue;
      if (!out[type]) out[type] = [];
      out[type].push(...vals);
    }
  }
  return out;
}

function tagOne(tags, type) {
  const v = tags[type];
  return v && v.length ? v[0] : null;
}

function tagBool(tags, type) {
  const v = tagOne(tags, type);
  return v === null ? null : bool(v);
}

function collectPhotos(node, keys) {
  const out = [];
  for (const key of keys) {
    for (const p of arr(get(node, [key]))) {
      let url = null;
      if (p && typeof p === 'object') {
        url = p['@_source'] || txt(get(p, ['source'])) || txt(p);
      } else {
        url = txt(p);
      }
      if (!url) continue;
      url = String(url).trim();
      if (!/^https?:\/\//i.test(url)) continue;
      out.push({
        url,
        label: p && typeof p === 'object' ? txt(get(p, ['label'])) : null,
        caption: p && typeof p === 'object' ? txt(get(p, ['caption'])) : null
      });
    }
  }
  return out;
}

function dedupePhotos(list) {
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (seen.has(p.url)) continue;
    seen.add(p.url);
    out.push({ ...p, order: out.length + 1 });
  }
  return out;
}

/**
 * Real feeds violate the spec here. Sample feeds have been observed sending
 * "1x monthly rent" where the spec calls for a Number. Handle both, and
 * record whether the value was derived rather than stated.
 */
function parseDeposit(raw, rent) {
  const t = txt(raw);
  if (t === null) return { deposit: null, depositRaw: null, depositDerived: false };

  if (/^[$\s]*[\d,]+(\.\d+)?[\s]*$/.test(t)) {
    return { deposit: num(t), depositRaw: t, depositDerived: false };
  }
  const mult = t.match(/(\d+(?:\.\d+)?)\s*x\s*(?:the\s*)?(?:monthly\s*)?rent/i);
  if (mult && rent) {
    return {
      deposit: Math.round(parseFloat(mult[1]) * rent * 100) / 100,
      depositRaw: t,
      depositDerived: true
    };
  }
  if (/first\s*month/i.test(t) && rent) {
    return { deposit: rent, depositRaw: t, depositDerived: true };
  }
  if (/none|no deposit|\$?0\b/i.test(t)) {
    return { deposit: 0, depositRaw: t, depositDerived: true };
  }
  const n = num(t);
  return { deposit: n, depositRaw: t, depositDerived: n !== null };
}

/* ------------------------------------------------------------------ *
 * field extraction
 * ------------------------------------------------------------------ */

const F = {
  beds: ['numBedrooms', 'bedrooms', 'beds', 'NumBedrooms', 'Bedrooms'],
  fullBaths: ['numFullBaths', 'fullBaths', 'bathrooms', 'baths', 'NumFullBaths', 'Bathrooms'],
  halfBaths: ['numHalfBaths', 'halfBaths', 'NumHalfBaths'],
  sqft: ['squareFeet', 'sqft', 'squareFootage', 'SquareFeet'],
  dateAvailable: ['dateAvailable', 'availableDate', 'DateAvailable', 'availability'],
  price: ['price', 'rent', 'Rent', 'marketRent', 'Price'],
  lowPrice: ['lowPrice', 'LowPrice'],
  highPrice: ['highPrice', 'HighPrice'],
  priceFrequency: ['priceFrequency', 'pricingFrequency', 'PriceFrequency'],
  deposit: ['deposit', 'Deposit', 'securityDeposit', 'SecurityDeposit'],
  hoa: ['HOA-Fee', 'HOAFee', 'hoaFee'],
  unitNumber: ['unitNumber', 'unit', 'UnitNumber', 'Unit'],
  unitFloor: ['unitFloorNumber', 'floor', 'UnitFloorNumber'],
  description: ['description', 'Description'],
  name: ['name', 'Name'],
  applicationFee: ['applicationFee', 'ApplicationFee', 'appFee']
};

function unitFields(node) {
  if (!node) return {};
  return {
    beds: num(get(node, F.beds)),
    fullBaths: num(get(node, F.fullBaths)),
    halfBaths: num(get(node, F.halfBaths)),
    sqft: num(get(node, F.sqft)),
    dateAvailable: txt(get(node, F.dateAvailable)),
    price: num(get(node, F.price)),
    lowPrice: num(get(node, F.lowPrice)),
    highPrice: num(get(node, F.highPrice)),
    priceFrequency: txt(get(node, F.priceFrequency)),
    depositRaw: get(node, F.deposit),
    hoa: num(get(node, F.hoa)),
    applicationFee: num(get(node, F.applicationFee))
  };
}

function listingCommon(listing, companies) {
  const companyId = listing['@_companyId'] ? String(listing['@_companyId']) : null;
  const company = companies[companyId] || companies._default || {};

  const streetNode = get(listing, ['street', 'Street', 'address', 'Address']);
  const street = txt(streetNode);
  const streetHidden =
    streetNode && typeof streetNode === 'object'
      ? bool(streetNode['@_hide']) === true
      : false;

  const tags = collectTags(listing, ['ListingTag', 'listingTag']);

  return {
    listingId: listing['@_id'] ? String(listing['@_id']) : null,
    listingType: listing['@_type'] ? String(listing['@_type']) : null,
    propertyTypeRaw: listing['@_propertyType'] ? String(listing['@_propertyType']) : null,
    companyId,
    companyName: company.name || null,

    propertyName: txt(get(listing, F.name)),
    street,
    streetHidden,
    city: txt(get(listing, ['city', 'City'])),
    state: txt(get(listing, ['state', 'State'])),
    zip: txt(get(listing, ['zip', 'Zip', 'zipcode', 'postalCode'])),
    country: txt(get(listing, ['country', 'Country'])) || 'US',
    lat: num(get(listing, ['latitude', 'Latitude', 'lat'])),
    lon: num(get(listing, ['longitude', 'Longitude', 'lng', 'lon'])),

    lastUpdated: txt(get(listing, ['lastUpdated', 'LastUpdated', 'modifiedDate'])),
    contactName: txt(get(listing, ['contactName'])),
    contactEmail: txt(get(listing, ['contactEmail'])),
    contactPhone: txt(get(listing, ['contactPhone'])),

    description: txt(get(listing, F.description)),
    terms: txt(get(listing, ['terms', 'Terms'])),
    leaseTerm: txt(get(listing, ['leaseTerm', 'LeaseTerm'])),
    website: txt(get(listing, ['website'])),
    virtualTourUrl: txt(get(listing, ['virtualTourUrl'])),
    isFurnished: bool(get(listing, ['isFurnished', 'furnished'])),
    smokingAllowed: bool(get(listing, ['smokingAllowed'])),
    numUnits: num(get(listing, ['numUnits'])),

    yearBuilt: num(tagOne(tags, 'YEAR_BUILT')),
    laundry: tagOne(tags, 'LAUNDRY'),
    parkingType: tagOne(tags, 'PARKING_TYPE'),
    parkingSpaces: num(tagOne(tags, 'PARKING_SPACES')),
    heatingSystem: tagOne(tags, 'HEATING_SYSTEM'),
    heatingFuel: tagOne(tags, 'HEATING_FUEL'),
    coolingSystem: tagOne(tags, 'COOLING_SYSTEM'),
    floorCovering: tagOne(tags, 'FLOOR_COVERING'),
    architectureStyle: tagOne(tags, 'ARCHITECTURE_STYLE'),
    schoolDistrict: tagOne(tags, 'SCHOOL_DISTRICT'),
    dogsAllowed: tagBool(tags, 'DOGS_ALLOWED'),
    smallDogsAllowed: tagBool(tags, 'SMALL_DOGS_ALLOWED'),
    largeDogsAllowed: tagBool(tags, 'LARGE_DOGS_ALLOWED'),
    catsAllowed: tagBool(tags, 'CATS_ALLOWED'),
    propertyAmenities: tags.PROPERTY_AMENITY || [],
    modelAmenities: tags.MODEL_AMENITY || [],
    rentIncludes: tags.RENT_INCLUDES || [],

    listingPhotos: collectPhotos(listing, ['ListingPhoto', 'listingPhoto', 'Photo']),
    _tags: tags
  };
}

/* ------------------------------------------------------------------ *
 * record assembly
 * ------------------------------------------------------------------ */

function buildRecord(common, u, extra) {
  const issues = [];

  const rent = firstDefined(u.price, u.lowPrice, u.highPrice);
  const freqRaw = u.priceFrequency;
  const freq = freqRaw ? freqRaw.trim().toUpperCase() : null;
  const monthly = !freq || freq === 'MONTH' || freq === 'MONTHLY';
  if (freq && !monthly) issues.push('NON_MONTHLY_PRICE:' + freq);

  const dep = parseDeposit(u.depositRaw, rent);
  if (dep.depositDerived) issues.push('DEPOSIT_DERIVED');

  const fullBaths = u.fullBaths;
  const halfBaths = u.halfBaths || 0;
  const bathsTotal =
    fullBaths === null || fullBaths === undefined ? null : fullBaths + halfBaths * 0.5;

  if (halfBaths > 0) issues.push('HAS_HALF_BATH');
  if (u.beds === null || u.beds === undefined) issues.push('MISSING_BEDS');
  if (fullBaths === null || fullBaths === undefined) issues.push('MISSING_BATHS');
  if (u.sqft === null || u.sqft === undefined) issues.push('MISSING_SQFT');
  if (rent === null) issues.push('MISSING_RENT');
  if (!common.street) issues.push('MISSING_STREET');
  if (common.streetHidden) issues.push('STREET_HIDDEN');
  if (!common.zip) issues.push('MISSING_ZIP');
  if (!common.lastUpdated) issues.push('MISSING_LASTUPDATED');
  if (common.yearBuilt === null) issues.push('MISSING_YEAR_BUILT');

  const photos = dedupePhotos([...(extra.photos || []), ...common.listingPhotos]);
  if (!photos.length) issues.push('NO_PHOTOS');

  const unitNumber = extra.unitNumber || null;
  const modelId = extra.modelId || null;

  const externalKey = [common.companyId || 'nc', common.listingId || 'nl', modelId || 'flat']
    .map((s) => String(s).replace(/[|:]/g, '-'))
    .join('::');

  const addressKey = sha(
    [slug(common.street), slug(unitNumber), slug(common.zip)].join('|')
  );

  if (!common.listingId) issues.push('MISSING_LISTING_ID');

  return {
    externalKey,
    addressKey,
    shape: extra.shape,

    companyId: common.companyId,
    companyName: common.companyName,
    listingId: common.listingId,
    modelId,
    parentModelId: extra.parentModelId || null,
    unitNumber,
    unitFloor: extra.unitFloor || null,

    propertyName: common.propertyName,
    modelName: extra.modelName || null,

    street: common.street,
    streetHidden: common.streetHidden,
    city: common.city,
    state: common.state,
    zip: common.zip,
    country: common.country,
    lat: common.lat,
    lon: common.lon,

    beds: u.beds ?? null,
    fullBaths: fullBaths ?? null,
    halfBaths,
    bathsTotal,
    sqft: u.sqft ?? null,
    yearBuilt: common.yearBuilt,

    rent,
    rentFrequency: freq || 'MONTH',
    rentIsMonthly: monthly,
    deposit: dep.deposit,
    depositRaw: dep.depositRaw,
    depositDerived: dep.depositDerived,
    applicationFee: u.applicationFee ?? null,
    hoa: u.hoa ?? null,

    dateAvailable: u.dateAvailable || null,
    leaseTerm: common.leaseTerm,
    propertyTypeRaw: common.propertyTypeRaw,
    listingType: common.listingType,
    isFurnished: common.isFurnished,
    smokingAllowed: common.smokingAllowed,

    description: extra.description || common.description,
    terms: common.terms,
    virtualTourUrl: common.virtualTourUrl,

    dogsAllowed: common.dogsAllowed,
    smallDogsAllowed: common.smallDogsAllowed,
    largeDogsAllowed: common.largeDogsAllowed,
    catsAllowed: common.catsAllowed,
    laundry: common.laundry,
    parkingType: common.parkingType,
    parkingSpaces: common.parkingSpaces,
    heatingSystem: common.heatingSystem,
    heatingFuel: common.heatingFuel,
    coolingSystem: common.coolingSystem,
    floorCovering: common.floorCovering,
    architectureStyle: common.architectureStyle,
    schoolDistrict: common.schoolDistrict,
    amenities: [
      ...new Set([
        ...common.propertyAmenities,
        ...common.modelAmenities,
        ...(extra.amenities || [])
      ])
    ],
    rentIncludes: [...new Set([...common.rentIncludes, ...(extra.rentIncludes || [])])],

    photos,
    photosForImport: photos.slice(0, PHOTO_CAP),
    photoCount: photos.length,

    contactName: common.contactName,
    contactEmail: common.contactEmail,
    contactPhone: common.contactPhone,

    lastUpdated: common.lastUpdated,
    issues,
    importable: !issues.some((i) =>
      ['MISSING_BEDS', 'MISSING_BATHS', 'MISSING_RENT', 'MISSING_LISTING_ID'].includes(i)
    )
  };
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

function normalizeFeed(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    isArray: (name) =>
      [
        'Company',
        'Listing',
        'Model',
        'ListingPhoto',
        'ModelPhoto',
        'ListingTag',
        'ModelTag',
        'openHouse',
        'ListingSpecialOffer',
        'ListingPermission'
      ].includes(name)
  });

  const doc = parser.parse(xml);
  const rootKey = Object.keys(doc).find((k) => k !== '?xml');
  // Literal root element name used by the wire format itself. This is a
  // string match against incoming feed data, not a vendor dependency.
  const rootNamed = /^hotpadsitems$/i.test(rootKey || '');
  let root = doc[rootKey];

  // An HTML error page parses cleanly and yields zero listings, which would
  // read downstream as "this PM has no inventory" and delist everything.
  // Refuse anything we cannot positively identify as a listing feed.
  if (root === undefined || root === null) root = {};
  if (typeof root !== 'object') root = {};

  const hasFeedShape =
    root.Listing !== undefined ||
    root.listing !== undefined ||
    root.Company !== undefined ||
    root.company !== undefined;

  if (!rootNamed && !hasFeedShape) {
    throw new Error(
      'UNRECOGNIZED_FEED_ROOT: root <' + (rootKey || '?') + '> is not a listing feed'
    );
  }

  const companies = {};
  for (const c of arr(root.Company || root.company)) {
    const id = c['@_id'] ? String(c['@_id']) : null;
    const rec = {
      id,
      name: txt(get(c, ['name'])),
      website: txt(get(c, ['website'])),
      city: txt(get(c, ['city'])),
      state: txt(get(c, ['state'])),
      logo: (get(c, ['CompanyLogo']) || {})['@_source'] || null
    };
    companies[id || '_default'] = rec;
    if (!companies._default) companies._default = rec;
  }

  const units = [];
  const listings = arr(root.Listing || root.listing);

  for (const listing of listings) {
    const common = listingCommon(listing, companies);
    const models = arr(get(listing, ['Model', 'model']));

    const floorplans = {};
    const unitModels = [];
    for (const m of models) {
      const type = String(m['@_type'] || '').toLowerCase();
      const id = m['@_id'] ? String(m['@_id']) : null;
      if (type === 'unit') unitModels.push(m);
      else if (id) floorplans[id.trim()] = m;
    }

    // ---- community with unit-level availability
    if (unitModels.length) {
      for (const m of unitModels) {
        const parentId = String(m['@_parentModelId'] || '').trim();
        const parent = floorplans[parentId] || null;

        const pf = unitFields(parent);
        const uf = unitFields(m);

        const merged = {
          beds: firstDefined(uf.beds, pf.beds),
          fullBaths: firstDefined(uf.fullBaths, pf.fullBaths),
          halfBaths: firstDefined(uf.halfBaths, pf.halfBaths),
          sqft: firstDefined(uf.sqft, pf.sqft),
          dateAvailable: firstDefined(uf.dateAvailable, pf.dateAvailable),
          price: firstDefined(uf.price, pf.price),
          lowPrice: firstDefined(uf.lowPrice, pf.lowPrice),
          highPrice: firstDefined(uf.highPrice, pf.highPrice),
          priceFrequency: firstDefined(uf.priceFrequency, pf.priceFrequency),
          depositRaw: firstDefined(uf.depositRaw, pf.depositRaw),
          hoa: firstDefined(uf.hoa, pf.hoa),
          applicationFee: firstDefined(uf.applicationFee, pf.applicationFee)
        };

        const mTags = {
          ...collectTags(parent || {}, ['ModelTag', 'modelTag']),
          ...collectTags(m, ['ModelTag', 'modelTag'])
        };

        units.push(
          buildRecord(common, merged, {
            shape: 'community',
            modelId: m['@_id'] ? String(m['@_id']) : null,
            parentModelId: parentId || null,
            unitNumber: txt(get(m, F.unitNumber)),
            unitFloor: txt(get(m, F.unitFloor)),
            modelName: firstDefined(txt(get(m, F.name)), txt(get(parent, F.name))),
            description: firstDefined(txt(get(m, F.description)), txt(get(parent, F.description))),
            amenities: [...(mTags.AMENITY || []), ...(mTags.AMENITY_SELECT || [])],
            rentIncludes: mTags.RENT_INCLUDES || [],
            photos: [
              ...collectPhotos(m, ['ModelPhoto', 'ModelLayout']),
              ...collectPhotos(parent || {}, ['ModelPhoto', 'ModelLayout'])
            ]
          })
        );
      }
      continue;
    }

    // ---- community, floorplans only (no unit-level availability)
    const fpIds = Object.keys(floorplans);
    if (fpIds.length) {
      for (const id of fpIds) {
        const m = floorplans[id];
        const mTags = collectTags(m, ['ModelTag', 'modelTag']);
        units.push(
          buildRecord(common, unitFields(m), {
            shape: 'floorplan',
            modelId: id,
            parentModelId: null,
            unitNumber: null,
            unitFloor: null,
            modelName: txt(get(m, F.name)),
            description: txt(get(m, F.description)),
            amenities: [...(mTags.AMENITY || []), ...(mTags.AMENITY_SELECT || [])],
            rentIncludes: mTags.RENT_INCLUDES || [],
            photos: collectPhotos(m, ['ModelPhoto', 'ModelLayout'])
          })
        );
      }
      continue;
    }

    // ---- flat: single family / individual unit
    units.push(
      buildRecord(common, unitFields(listing), {
        shape: 'flat',
        modelId: null,
        parentModelId: null,
        unitNumber: txt(get(listing, F.unitNumber)),
        unitFloor: null,
        modelName: null,
        description: null,
        amenities: [],
        rentIncludes: [],
        photos: []
      })
    );
  }

  // ---- summary
  const issueCounts = {};
  for (const u of units) {
    for (const i of u.issues) {
      const key = i.split(':')[0];
      issueCounts[key] = (issueCounts[key] || 0) + 1;
    }
  }

  const keyCounts = {};
  for (const u of units) keyCounts[u.externalKey] = (keyCounts[u.externalKey] || 0) + 1;
  const duplicateKeys = Object.keys(keyCounts).filter((k) => keyCounts[k] > 1);

  const shapes = {};
  for (const u of units) shapes[u.shape] = (shapes[u.shape] || 0) + 1;

  return {
    version: NORM_VERSION,
    generatedAt: new Date().toISOString(),
    companies: Object.values(companies).filter((c) => c.id),
    summary: {
      listings: listings.length,
      units: units.length,
      shapes,
      importable: units.filter((u) => u.importable).length,
      blocked: units.filter((u) => !u.importable).length,
      totalPhotos: units.reduce((a, u) => a + u.photoCount, 0),
      photosAfterCap: units.reduce((a, u) => a + u.photosForImport.length, 0),
      duplicateKeys,
      issueCounts
    },
    units
  };
}

/* ------------------------------------------------------------------ *
 * fetch + handler
 * ------------------------------------------------------------------ */

async function fetchFeed(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Renters.com-FeedSync/' + NORM_VERSION }
    });
    if (!res.ok) throw new Error('Feed HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const json = (code, body) => ({
  statusCode: code,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'X-Function-Version': NORM_VERSION
  },
  body: JSON.stringify({ version: NORM_VERSION, ...body }, null, 2)
});

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    let body = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch (_) {
        body = {};
      }
    }

    const required = process.env.PM_FEED_TOKEN;
    if (required && q.token !== required) return json(401, { ok: false, error: 'bad token' });

    const url = body.url || q.url;
    const xml = body.xml || null;

    // Bare URL: deploy check. Confirms the function loaded and its deps
    // resolved, and reports which version is live.
    if (!url && !xml) {
      return json(200, {
        ok: true,
        status: 'ready',
        deps: { xmlParser: 'loaded' },
        usage: {
          summary: '?url=<feedUrl>&summary=1',
          sample: '?url=<feedUrl>&limit=3',
          full: '?url=<feedUrl>',
          post: 'POST { url } or { xml }'
        }
      });
    }

    const raw = xml || (await fetchFeed(url));
    const result = normalizeFeed(raw);

    if (q.summary === '1') {
      return json(200, {
        ok: true,
        version: result.version,
        source: url || 'inline',
        bytes: raw.length,
        companies: result.companies,
        summary: result.summary
      });
    }

    const limit = parseInt(q.limit || '0', 10);
    return json(200, {
      ok: true,
      ...result,
      units: limit > 0 ? result.units.slice(0, limit) : result.units
    });
  } catch (err) {
    return json(500, { ok: false, version: NORM_VERSION, error: String(err.message || err) });
  }
};

exports.normalizeFeed = normalizeFeed;
exports.fetchFeed = fetchFeed;
exports.NORM_VERSION = NORM_VERSION;
