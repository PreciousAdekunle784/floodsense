export const FACTOR_INFO = {
  hand: {
    short: 'Height above drainage', source: 'Copernicus DEM GLO-90 → D8 flow paths',
    why: 'Vertical height of the ground above the nearest stream, measured along the path water would flow. Ground only a metre or two above a channel is reached first when water rises.',
    fmt: (D, i) => `${(D.hand[i] / 10).toFixed(1)} m`,
  },
  dist: {
    short: 'Distance to channel', source: 'DEM-derived drainage network (≥5 km² upstream)',
    why: 'Horizontal distance to the nearest drainage channel. Places next to streams receive overbank flow and backed-up drainage.',
    fmt: (D, i) => (D.dist[i] < 1000 ? `${D.dist[i]} m` : `${(D.dist[i] / 1000).toFixed(1)} km`),
  },
  slope: {
    short: 'Slope', source: 'Copernicus DEM GLO-90',
    why: 'Flat ground drains slowly, so water ponds; steep ground sheds water quickly downhill.',
    fmt: (D, i) => `${(D.slope[i] / 100).toFixed(1)}°`,
  },
  twi: {
    short: 'Wetness index (TWI)', source: 'ln(upslope area ÷ tan slope)',
    why: 'Combines how much land drains through a point with how flat it is — high values mark hollows and valley floors where water accumulates.',
    fmt: (D, i) => (D.twi[i] / 100).toFixed(1),
  },
  rain: {
    short: 'Mean annual rainfall', source: 'NASA GPM IMERG 2001–2020 (0.1°)',
    why: 'Long-term rainfall supply. It varies only gently across the state (≈1,200–1,900 mm), so it carries a low weight.',
    fmt: (D, i) => `${D.rain[i].toLocaleString()} mm/yr`,
  },
  lulc: {
    short: 'Land cover', source: 'ESA WorldCover 2021 (10 m)',
    why: 'Built-up surfaces turn rain into fast runoff; wetlands and mangroves are naturally inundated; forest intercepts and absorbs rain.',
    fmt: null,
  },
};

export const CLASS_MEANING = {
  1: 'Ground here sits well above nearby drainage and sheds water. Flooding is less likely, but blocked drains and extreme rain can still flood streets.',
  2: 'Mostly elevated or sloping ground with few characteristics associated with flooding. Local surface-water flooding remains possible.',
  3: 'Some flood-associated characteristics — gentle slopes, moderate proximity to streams or runoff-generating land cover.',
  4: 'Low-lying ground close to drainage channels. River overflow and runoff from surrounding land can reach this area.',
  5: 'Valley floors, floodplains and wetland margins only a little above a channel. These are typically the first places water collects.',
  6: 'Permanent water body (river, reservoir or lagoon) — excluded from the susceptibility classification.',
};

export const CLASS_ACTIONS = {
  1: ['Keep gutters and drains around your home clear of refuse.', 'Know the route to higher ground in case nearby low areas flood.'],
  2: ['Keep drains clear and avoid dumping waste in channels.', 'Store documents and valuables off the floor during the rainy season.'],
  3: ['Plan where you would go if water enters your street, and agree it with your household.', 'Raise electrical sockets and valuables where possible.', 'Follow NiMet and state agency announcements during heavy rain.'],
  4: ['Prepare an emergency bag (documents in waterproof bags, medicines, torch, phone power bank).', 'Identify higher ground you can reach on foot; do not wait for water to rise before leaving.', 'Watch for official notices on dam releases and river levels (Ogun–Osun River Basin Authority, NIHSA).'],
  5: ['Treat any river rise or prolonged heavy rain seriously — this is where water collects first.', 'Keep an emergency bag ready throughout the rainy season.', 'Know two routes to higher ground and where your household will meet.', 'If authorities advise relocation, follow it promptly.'],
  6: [],
};

export const DURING = [
  'If anyone is in danger, contact emergency services first — Nigeria’s national emergency number is 112.',
  'Never walk, swim or drive through flood water: 15 cm of moving water can knock an adult down and 60 cm can float a car.',
  'Switch off electricity at the mains if water is entering the building and it is safe to do so.',
  'Move to higher ground or an upper floor; take your emergency bag.',
  'Avoid contact with flood water — it is often contaminated with sewage and waste.',
];

export const OFFICIAL_SOURCES = [
  { name: 'Nigerian Hydrological Services Agency (NIHSA)', role: 'Publishes the Annual Flood Outlook and river-level information for Nigeria.' },
  { name: 'Nigerian Meteorological Agency (NiMet)', role: 'Official weather forecasts and severe-weather alerts, including the Seasonal Climate Prediction.' },
  { name: 'National Emergency Management Agency (NEMA)', role: 'Federal disaster response coordination.' },
  { name: 'Ogun State Emergency Management Agency (OGSEMA)', role: 'State-level emergency management and relief in Ogun State.' },
  { name: 'Ogun State Ministry of Environment', role: 'State flood alerts and relocation advisories for flood-prone communities.' },
  { name: 'Ogun–Osun River Basin Development Authority', role: 'Operates the Oyan Dam; issues notices about controlled water releases.' },
];

export const DOCUMENTED_CONTEXT = {
  summary: 'Public news reports describe recurring flooding along the Ogun River corridor downstream of the Oyan Dam — communities such as Isheri, Akute, Alagbole, Magboro and Warewa, and parts of Abeokuta — with state authorities issuing relocation advisories during controlled dam releases. The dam operator has disputed that releases are the sole cause.',
  sources: [
    { title: 'Ogun urges residents of flooded areas to relocate — The Guardian (NG)', url: 'https://guardian.ng/?p=2460035' },
    { title: 'Lagos, Ogun urge residents of low-lying areas to relocate over Oyan Dam release — The Guardian (NG)', url: 'https://guardian.ng/news/lagos-ogun-urge-residents-of-low-lying-areas-to-relocate-over-water-release-from-oyan-dam/' },
    { title: 'Isheri flooding not from Oyan Dam — Leadership', url: 'https://leadership.ng/isheri-flooding-not-from-oyan-dam' },
    { title: 'Ogun asks residents of flood-prone communities to relocate — TheCable', url: 'https://thecable.ng/ogun-asks-residents-of-flood-prone-communities-to-relocate' },
  ],
  note: 'Listed as context only. These communities are not plotted as incidents: FloodSense only maps incidents submitted and verified through its own workflow.',
};

export const INFO_TYPES = [
  { key: 'susceptibility', name: 'Flood susceptibility', what: 'Where terrain, drainage, land cover and rainfall make flooding more likely. A long-term property of the land — not a prediction that it will flood on any given day.', status: 'Modelled · prototype', tone: 'model' },
  { key: 'reports', name: 'Community reports', what: 'Flooding people say they have seen. Pending reports are unverified; only reports checked by a verifier are marked Verified.', status: 'Crowd-sourced', tone: 'crowd' },
  { key: 'observed', name: 'Observed water', what: 'Water detected in satellite imagery. FloodSense shows the JRC Landsat record (1984–2021) of where water has been seen — not a live flood extent.', status: 'Satellite record · historical', tone: 'obs' },
  { key: 'warnings', name: 'Forecasts & warnings', what: 'FloodSense does not issue forecasts or warnings. Follow NIHSA, NiMet and Ogun State agencies for official alerts.', status: 'Not provided', tone: 'none' },
];
