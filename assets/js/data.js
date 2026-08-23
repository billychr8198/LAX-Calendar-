/* =============================================================
   LAX MISSION CONTROL — static data
   Routes, airlines, terminal map hotspots, photos, videos.
   ============================================================= */
(function (root) {
  'use strict';

  /* ---------- Airlines (logo files live in assets/img/airlines) ---------- */
  var AIRLINES = {
    'aer-lingus':      { name: 'Aer Lingus',              code: 'EI' },
    'aeromexico':      { name: 'Aeroméxico',              code: 'AM' },
    'air-canada':      { name: 'Air Canada',              code: 'AC' },
    'air-china':       { name: 'Air China',               code: 'CA' },
    'air-france':      { name: 'Air France',              code: 'AF' },
    'air-new-zealand': { name: 'Air New Zealand',         code: 'NZ' },
    'alaska':          { name: 'Alaska Airlines',         code: 'AS' },
    'ana':             { name: 'All Nippon Airways',      code: 'NH' },
    'american':        { name: 'American Airlines',       code: 'AA' },
    'british-airways': { name: 'British Airways',         code: 'BA' },
    'cathay-pacific':  { name: 'Cathay Pacific',          code: 'CX' },
    'china-southern':  { name: 'China Southern Airlines', code: 'CZ' },
    'copa':            { name: 'Copa Airlines',           code: 'CM' },
    'delta':           { name: 'Delta Air Lines',         code: 'DL' },
    'egyptair':        { name: 'EgyptAir',                code: 'MS' },
    'el-al':           { name: 'El Al',                   code: 'LY' },
    'emirates':        { name: 'Emirates',                code: 'EK' },
    'eva-air':         { name: 'EVA Air',                 code: 'BR' },
    'finnair':         { name: 'Finnair',                 code: 'AY' },
    'frontier':        { name: 'Frontier Airlines',       code: 'F9' },
    'hawaiian':        { name: 'Hawaiian Airlines',       code: 'HA' },
    'iberia':          { name: 'Iberia',                  code: 'IB' },
    'ita-airways':     { name: 'ITA Airways',             code: 'AZ' },
    'japan-airlines':  { name: 'Japan Airlines',          code: 'JL' },
    'jetblue':         { name: 'JetBlue',                 code: 'B6' },
    'klm':             { name: 'KLM',                     code: 'KL' },
    'korean-air':      { name: 'Korean Air',              code: 'KE' },
    'latam':           { name: 'LATAM Airlines',          code: 'LA' },
    'level':           { name: 'LEVEL',                   code: 'LV' },
    'lufthansa':       { name: 'Lufthansa',               code: 'LH' },
    'philippine':      { name: 'Philippine Airlines',     code: 'PR' },
    'qantas':          { name: 'Qantas',                  code: 'QF' },
    'qatar':           { name: 'Qatar Airways',           code: 'QR' },
    'royal-air-maroc': { name: 'Royal Air Maroc',         code: 'AT' },
    'sas':             { name: 'Scandinavian Airlines',   code: 'SK' },
    'singapore':       { name: 'Singapore Airlines',      code: 'SQ' },
    'southwest':       { name: 'Southwest Airlines',      code: 'WN' },
    'swiss':           { name: 'SWISS',                   code: 'LX' },
    'tap':             { name: 'TAP Air Portugal',        code: 'TP' },
    'turkish':         { name: 'Turkish Airlines',        code: 'TK' },
    'united':          { name: 'United Airlines',         code: 'UA' },
    'volaris':         { name: 'Volaris',                 code: 'Y4' }
  };

  /* ---------- The route network -------------------------------------------
     122 routes — one for every day from 1 Sep to 31 Dec 2026.
     Ordered smallest/quietest first, building to the busiest runs at LAX.
     c=city  r=region  a=airport code  k=kind (D/I)  al=airline  t=terminal
     mi=great-circle miles  fn=flight number  b=blurb
     ---------------------------------------------------------------------- */
  var ROUTES = [
    { c:'Mammoth Lakes',      r:'California',   a:'MMH', k:'D', al:'united',          t:'T7',   mi:259,  fn:'UA 5341', b:'A 45-minute hop to the Eastern Sierra. Skis in the hold, sunrise over the mountains.' },
    { c:'Santa Barbara',      r:'California',   a:'SBA', k:'D', al:'american',        t:'T4',   mi:89,   fn:'AA 3095', b:'The shortest run on the board. Wheels up, wheels down, barely time for a drink.' },
    { c:'San Luis Obispo',    r:'California',   a:'SBP', k:'D', al:'united',          t:'T7',   mi:175,  fn:'UA 5624', b:'Central Coast wine country, straight up the shoreline.' },
    { c:'Monterey',           r:'California',   a:'MRY', k:'D', al:'united',          t:'T7',   mi:279,  fn:'UA 5459', b:'Cypress trees, sea otters and one of the prettiest approaches in the state.' },
    { c:'Fresno',             r:'California',   a:'FAT', k:'D', al:'united',          t:'T7',   mi:209,  fn:'UA 5217', b:'Gateway to Yosemite and the heart of the Central Valley.' },
    { c:'Santa Rosa',         r:'California',   a:'STS', k:'D', al:'alaska',          t:'T6',   mi:397,  fn:'AS 3372', b:'Sonoma County. A small field with very good taste in wine.' },
    { c:'Sun Valley',         r:'Mountain West',a:'SUN', k:'D', al:'alaska',          t:'T6',   mi:692,  fn:'AS 3405', b:'Winter-season service into Idaho powder country.' },
    { c:'Bend / Redmond',     r:'Pacific NW',   a:'RDM', k:'D', al:'alaska',          t:'T6',   mi:745,  fn:'AS 2381', b:'High-desert Oregon: rivers, lava fields and very good beer.' },
    { c:'Eugene',             r:'Pacific NW',   a:'EUG', k:'D', al:'alaska',          t:'T6',   mi:748,  fn:'AS 2427', b:'Track Town, USA. Green all year round.' },
    { c:'Missoula',           r:'Mountain West',a:'MSO', k:'D', al:'alaska',          t:'T6',   mi:924,  fn:'AS 2461', b:'Five rivers meet here. So do a lot of fly-fishers.' },
    { c:'Kalispell',          r:'Mountain West',a:'FCA', k:'D', al:'alaska',          t:'T6',   mi:950,  fn:'AS 2325', b:'The doorstep of Glacier National Park.' },
    { c:'Bozeman',            r:'Mountain West',a:'BZN', k:'D', al:'alaska',          t:'T6',   mi:872,  fn:'AS 2445', b:'Big sky, bigger mountains. Booming year-round.' },
    { c:'Jackson Hole',       r:'Mountain West',a:'JAC', k:'D', al:'american',        t:'T4',   mi:749,  fn:'AA 2846', b:'The Tetons rise straight off the runway. No warm-up.' },
    { c:'Aspen',              r:'Mountain West',a:'ASE', k:'D', al:'united',          t:'T7',   mi:674,  fn:'UA 5876', b:'A short runway in a deep valley. Only the best crews fly it.' },
    { c:'Vail / Eagle',       r:'Mountain West',a:'EGE', k:'D', al:'american',        t:'T4',   mi:750,  fn:'AA 2678', b:'Winter Saturdays only, and every seat full of ski bags.' },
    { c:'Telluride / Montrose',r:'Mountain West',a:'MTJ',k:'D', al:'united',          t:'T7',   mi:665,  fn:'UA 5713', b:'Colorado box canyons and a very quiet main street.' },
    { c:'Steamboat Springs',  r:'Mountain West',a:'HDN', k:'D', al:'united',          t:'T7',   mi:748,  fn:'UA 5940', b:'Champagne powder, direct from the coast.' },
    { c:'Medford',            r:'Pacific NW',   a:'MFR', k:'D', al:'alaska',          t:'T6',   mi:630,  fn:'AS 2378', b:'Southern Oregon, Crater Lake and the Rogue Valley.' },
    { c:'Tri-Cities',         r:'Pacific NW',   a:'PSC', k:'D', al:'alaska',          t:'T6',   mi:892,  fn:'AS 2418', b:'Where the Columbia, Snake and Yakima rivers meet.' },
    { c:'Bellingham',         r:'Pacific NW',   a:'BLI', k:'D', al:'alaska',          t:'T6',   mi:1063, fn:'AS 2452', b:'The last stop before the Canadian border.' },
    { c:'Tulsa',              r:'South',        a:'TUL', k:'D', al:'american',        t:'T4',   mi:1214, fn:'AA 2405', b:'Art deco skyline, oil money and a serious music scene.' },
    { c:'Oklahoma City',      r:'South',        a:'OKC', k:'D', al:'american',        t:'T4',   mi:1186, fn:'AA 1618', b:'Route 66 country, right in the middle of everything.' },
    { c:'Des Moines',         r:'Midwest',      a:'DSM', k:'D', al:'united',          t:'T7',   mi:1466, fn:'UA 2093', b:'Small city, outsized influence every four years.' },
    { c:'Omaha',              r:'Midwest',      a:'OMA', k:'D', al:'southwest',       t:'T1',   mi:1330, fn:'WN 1487', b:'Steaks, the Missouri River and a very famous shareholder meeting.' },
    { c:'Colorado Springs',   r:'Mountain West',a:'COS', k:'D', al:'united',          t:'T7',   mi:831,  fn:'UA 2251', b:'Pikes Peak fills the window on final approach.' },
    { c:'Boise',              r:'Mountain West',a:'BOI', k:'D', al:'alaska',          t:'T6',   mi:673,  fn:'AS 654',  b:'One of the fastest-growing cities in the West.' },
    { c:'Spokane',            r:'Pacific NW',   a:'GEG', k:'D', al:'alaska',          t:'T6',   mi:1021, fn:'AS 640',  b:'Inland Northwest hub, waterfalls in the middle of downtown.' },
    { c:'Reno / Tahoe',       r:'West',         a:'RNO', k:'D', al:'southwest',       t:'T1',   mi:391,  fn:'WN 2260', b:'Casinos below, the bluest lake in America just up the hill.' },
    { c:'Tucson',             r:'Southwest',    a:'TUS', k:'D', al:'american',        t:'T4',   mi:451,  fn:'AA 1291', b:'Saguaro forests and the darkest skies in the lower 48.' },
    { c:'Albuquerque',        r:'Southwest',    a:'ABQ', k:'D', al:'southwest',       t:'T1',   mi:677,  fn:'WN 1058', b:'Hot air balloons at dawn, green chile at every meal.' },
    { c:'El Paso',            r:'South',        a:'ELP', k:'D', al:'southwest',       t:'T1',   mi:714,  fn:'WN 2461', b:'A border city where two countries share one skyline.' },
    { c:'Milwaukee',          r:'Midwest',      a:'MKE', k:'D', al:'southwest',       t:'T1',   mi:1749, fn:'WN 1901', b:'Lake Michigan breezes and the best custard in the country.' },
    { c:'Cleveland',          r:'Midwest',      a:'CLE', k:'D', al:'frontier',        t:'T2',   mi:2049, fn:'F9 1544', b:'Rock and roll, a great art museum and a fiercely loyal city.' },
    { c:'Columbus',           r:'Midwest',      a:'CMH', k:'D', al:'alaska',          t:'T6',   mi:1994, fn:'AS 1214', b:'Ohio\'s quiet giant, growing faster than anyone expected.' },
    { c:'Indianapolis',       r:'Midwest',      a:'IND', k:'D', al:'delta',           t:'T3',   mi:1815, fn:'DL 1739', b:'One weekend a year the whole world watches this town.' },
    { c:'Cincinnati',         r:'Midwest',      a:'CVG', k:'D', al:'delta',           t:'T3',   mi:1900, fn:'DL 1216', b:'Seven hills on the Ohio River, and very serious chili.' },
    { c:'Pittsburgh',         r:'Northeast',    a:'PIT', k:'D', al:'alaska',          t:'T6',   mi:2136, fn:'AS 1130', b:'446 bridges. More than Venice, and they will tell you so.' },
    { c:'Kansas City',        r:'Midwest',      a:'MCI', k:'D', al:'southwest',       t:'T1',   mi:1363, fn:'WN 1224', b:'Jazz, barbecue and more fountains than any city but Rome.' },
    { c:'St. Louis',          r:'Midwest',      a:'STL', k:'D', al:'southwest',       t:'T1',   mi:1592, fn:'WN 1653', b:'The Gateway Arch, framed perfectly from seat 12A.' },
    { c:'Memphis',            r:'South',        a:'MEM', k:'D', al:'delta',           t:'T3',   mi:1616, fn:'DL 1424', b:'Beale Street, Sun Studio and the birthplace of a whole sound.' },
    { c:'Raleigh–Durham',     r:'South',        a:'RDU', k:'D', al:'delta',           t:'T3',   mi:2249, fn:'DL 1893', b:'The Research Triangle: universities, labs and a lot of new arrivals.' },
    { c:'Nashville',          r:'South',        a:'BNA', k:'D', al:'southwest',       t:'T1',   mi:1797, fn:'WN 1015', b:'Music City. Someone on this flight has a guitar in the overhead.' },
    { c:'New Orleans',        r:'South',        a:'MSY', k:'D', al:'delta',           t:'T3',   mi:1670, fn:'DL 2079', b:'Brass bands, beignets and a city that refuses to be ordinary.' },
    { c:'San Antonio',        r:'South',        a:'SAT', k:'D', al:'southwest',       t:'T1',   mi:1210, fn:'WN 1370', b:'The River Walk, the Alamo, and 300 years of history.' },
    { c:'Austin',             r:'South',        a:'AUS', k:'D', al:'american',        t:'T4',   mi:1242, fn:'AA 1420', b:'Live music, breakfast tacos and a lot of California licence plates.' },
    { c:'Sacramento',         r:'California',   a:'SMF', k:'D', al:'southwest',       t:'T1',   mi:373,  fn:'WN 1602', b:'The state capital, and the gateway to the Sierra foothills.' },
    { c:'Salt Lake City',     r:'Mountain West',a:'SLC', k:'D', al:'delta',           t:'T3',   mi:590,  fn:'DL 1610', b:'A mountain hub where the runway sits a mile above the sea.' },
    { c:'Portland',           r:'Pacific NW',   a:'PDX', k:'D', al:'alaska',          t:'T6',   mi:834,  fn:'AS 500',  b:'Rain, roses, and the most beloved airport carpet in America.' },
    { c:'San José',           r:'California',   a:'SJC', k:'D', al:'southwest',       t:'T1',   mi:308,  fn:'WN 1811', b:'The front door to Silicon Valley.' },
    { c:'Charlotte',          r:'South',        a:'CLT', k:'D', al:'american',        t:'T4',   mi:2125, fn:'AA 1745', b:'A banking capital with rocking chairs in the concourse.' },
    { c:'Detroit',            r:'Midwest',      a:'DTW', k:'D', al:'delta',           t:'T3',   mi:1979, fn:'DL 1279', b:'Motown, the Motor City, and a comeback still under way.' },
    { c:'Minneapolis–St. Paul',r:'Midwest',     a:'MSP', k:'D', al:'delta',           t:'T3',   mi:1535, fn:'DL 1554', b:'Ten thousand lakes and skyways that keep you warm all winter.' },
    { c:'Philadelphia',       r:'Northeast',    a:'PHL', k:'D', al:'american',        t:'T4',   mi:2402, fn:'AA 274',  b:'Where the country was written down and signed.' },
    { c:'Washington Dulles',  r:'Northeast',    a:'IAD', k:'D', al:'united',          t:'T7',   mi:2288, fn:'UA 1220', b:'Saarinen\'s swooping terminal roof — a cousin of our own Theme Building.' },
    { c:'Washington National',r:'Northeast',    a:'DCA', k:'D', al:'alaska',          t:'T6',   mi:2311, fn:'AS 6',    b:'The river approach past the monuments. Best seat: left side.' },
    { c:'Houston',            r:'South',        a:'IAH', k:'D', al:'united',          t:'T7',   mi:1379, fn:'UA 1104', b:'Space City. Mission control of a different kind.' },
    { c:'Boston',             r:'Northeast',    a:'BOS', k:'D', al:'jetblue',         t:'T5',   mi:2611, fn:'B6 1284', b:'Cobblestones, chowder and a 400-year head start.' },
    { c:'Newark',             r:'Northeast',    a:'EWR', k:'D', al:'united',          t:'T7',   mi:2454, fn:'UA 1738', b:'New York from the other side of the Hudson.' },
    { c:'Kauai / Lihue',      r:'Hawai\u02BBi', a:'LIH', k:'D', al:'hawaiian',        t:'T5',   mi:2615, fn:'HA 15',   b:'The Garden Isle. Green cliffs straight down into the sea.' },
    { c:'Kona',               r:'Hawai\u02BBi', a:'KOA', k:'D', al:'hawaiian',        t:'T5',   mi:2504, fn:'HA 33',   b:'Black lava fields, coffee farms and the calmest water in the islands.' },
    { c:'Maui / Kahului',     r:'Hawai\u02BBi', a:'OGG', k:'D', al:'hawaiian',        t:'T5',   mi:2486, fn:'HA 7',    b:'The road to Hana starts a short drive from the gate.' },
    { c:'Honolulu',           r:'Hawai\u02BBi', a:'HNL', k:'D', al:'hawaiian',        t:'T5',   mi:2556, fn:'HA 1',    b:'Five hours over open Pacific. Still one of the great flights.' },
    { c:'Morelia',            r:'Mexico',       a:'MLM', k:'I', al:'volaris',         t:'TBIT', mi:1585, fn:'Y4 951',  b:'A UNESCO colonial city, and a route built by families on both ends.' },
    { c:'León / Bajío',       r:'Mexico',       a:'BJX', k:'I', al:'volaris',         t:'TBIT', mi:1522, fn:'Y4 921',  b:'Mexico\'s industrial heartland, and the best leather you\'ll ever buy.' },
    { c:'Guadalajara',        r:'Mexico',       a:'GDL', k:'I', al:'volaris',         t:'TBIT', mi:1547, fn:'Y4 901',  b:'Mariachi, tequila country and one of LAX\'s busiest international runs.' },
    { c:'Puerto Vallarta',    r:'Mexico',       a:'PVR', k:'I', al:'alaska',          t:'T6',   mi:1329, fn:'AS 264',  b:'Banderas Bay. Wheels down, feet in the sand by lunch.' },
    { c:'Los Cabos',          r:'Mexico',       a:'SJD', k:'I', al:'alaska',          t:'T6',   mi:921,  fn:'AS 268',  b:'Where the desert falls into the sea at Land\'s End.' },
    { c:'Mexico City',        r:'Mexico',       a:'MEX', k:'I', al:'aeromexico',      t:'T2',   mi:1547, fn:'AM 647',  b:'One of the great capitals of the world, 7,300 feet up.' },
    { c:'Guatemala City',     r:'Central America',a:'GUA',k:'I',al:'volaris',         t:'TBIT', mi:2224, fn:'Y4 1001', b:'Volcanoes on the horizon from the moment you descend.' },
    { c:'San Salvador',       r:'Central America',a:'SAL',k:'I',al:'volaris',         t:'TBIT', mi:2354, fn:'Y4 1021', b:'A route that carries a whole community back and forth.' },
    { c:'Liberia',            r:'Central America',a:'LIR',k:'I',al:'alaska',          t:'T6',   mi:2683, fn:'AS 1290', b:'Guanacaste, Costa Rica. Dry forest, surf breaks, howler monkeys.' },
    { c:'Calgary',            r:'Canada',       a:'YYC', k:'I', al:'air-canada',      t:'TBIT', mi:1207, fn:'AC 1795', b:'The Rockies start about twenty minutes west of the runway.' },
    { c:'Vancouver',          r:'Canada',       a:'YVR', k:'I', al:'air-canada',      t:'TBIT', mi:1081, fn:'AC 552',  b:'Mountains, ocean and a city squeezed beautifully between them.' },
    { c:'Toronto',            r:'Canada',       a:'YYZ', k:'I', al:'air-canada',      t:'TBIT', mi:2170, fn:'AC 792',  b:'Canada\'s biggest city, and a major connection over the Atlantic.' },
    { c:'Panama City',        r:'Central America',a:'PTY',k:'I',al:'copa',            t:'TBIT', mi:3009, fn:'CM 401',  b:'The Hub of the Americas. From here you can reach all of Latin America.' },
    { c:'Lima',               r:'South America',a:'LIM', k:'I', al:'latam',           t:'TBIT', mi:4171, fn:'LA 601',  b:'One of the world\'s great food cities, on a cliff above the Pacific.' },
    { c:'Santiago',           r:'South America',a:'SCL', k:'I', al:'latam',           t:'TBIT', mi:5602, fn:'LA 601',  b:'The Andes rise like a wall behind the city. Wine country all around.' },
    { c:'São Paulo',          r:'South America',a:'GRU', k:'I', al:'latam',           t:'TBIT', mi:6150, fn:'LA 8085', b:'The largest city in the southern hemisphere. Twelve hours south.' },
    { c:'Casablanca',         r:'Africa',       a:'CMN', k:'I', al:'royal-air-maroc', t:'TBIT', mi:6011, fn:'AT 202',  b:'North Africa\'s gateway, and a first for LAX when it launched.' },
    { c:'Cairo',              r:'Africa',       a:'CAI', k:'I', al:'egyptair',        t:'TBIT', mi:7593, fn:'MS 992',  b:'One of the longest flights on our board, ending at the pyramids.' },
    { c:'Tel Aviv',           r:'Middle East',  a:'TLV', k:'I', al:'el-al',           t:'TBIT', mi:7590, fn:'LY 6',    b:'A 15-hour run over the pole and down through Europe.' },
    { c:'Dublin',             r:'Europe',       a:'DUB', k:'I', al:'aer-lingus',      t:'TBIT', mi:5150, fn:'EI 78',   b:'Clear US customs before you even leave Ireland. Civilised.' },
    { c:'Helsinki',           r:'Europe',       a:'HEL', k:'I', al:'finnair',         t:'TBIT', mi:5688, fn:'AY 15',   b:'A polar route north, and the shortest way onward to much of Asia.' },
    { c:'Copenhagen',         r:'Europe',       a:'CPH', k:'I', al:'sas',             t:'TBIT', mi:5636, fn:'SK 932',  b:'Bicycles, design and the doorway to all of Scandinavia.' },
    { c:'Lisbon',             r:'Europe',       a:'LIS', k:'I', al:'tap',             t:'TBIT', mi:5717, fn:'TP 224',  b:'Seven hills, yellow trams and Europe\'s westernmost capital.' },
    { c:'Barcelona',          r:'Europe',       a:'BCN', k:'I', al:'level',           t:'TBIT', mi:6006, fn:'LV 1451', b:'Gaudí, the Gothic Quarter and a beach inside the city limits.' },
    { c:'Madrid',             r:'Europe',       a:'MAD', k:'I', al:'iberia',          t:'TBIT', mi:5844, fn:'IB 6170', b:'Late dinners, world-class museums and Spain\'s beating heart.' },
    { c:'Zurich',             r:'Europe',       a:'ZRH', k:'I', al:'swiss',           t:'TBIT', mi:6000, fn:'LX 41',   b:'The Alps out the left window on descent. Set your watch by it.' },
    { c:'Rome',               r:'Europe',       a:'FCO', k:'I', al:'ita-airways',     t:'TBIT', mi:6335, fn:'AZ 621',  b:'The Eternal City. Nowhere else stacks three thousand years like this.' },
    { c:'Munich',             r:'Europe',       a:'MUC', k:'I', al:'lufthansa',       t:'TBIT', mi:5980, fn:'LH 453',  b:'Bavaria, the Alps and Europe\'s most punctual big hub.' },
    { c:'Istanbul',           r:'Europe',       a:'IST', k:'I', al:'turkish',         t:'TBIT', mi:6841, fn:'TK 10',   b:'Where Europe meets Asia — and where you can connect onward to almost anywhere.' },
    { c:'Amsterdam',          r:'Europe',       a:'AMS', k:'I', al:'klm',             t:'TBIT', mi:5570, fn:'KL 602',  b:'Canals, tulips and one of the great connecting airports of the world.' },
    { c:'Frankfurt',          r:'Europe',       a:'FRA', k:'I', al:'lufthansa',       t:'TBIT', mi:5799, fn:'LH 457',  b:'Europe\'s financial engine room, and a hub built for connections.' },
    { c:'Paris',              r:'Europe',       a:'CDG', k:'I', al:'air-france',      t:'TBIT', mi:5658, fn:'AF 65',   b:'Los Angeles to Paris. Some routes never stop feeling glamorous.' },
    { c:'London Heathrow',    r:'Europe',       a:'LHR', k:'I', al:'british-airways', t:'TBIT', mi:5456, fn:'BA 268',  b:'The busiest long-haul route out of LAX. A true transatlantic classic.' },
    { c:'Doha',               r:'Middle East',  a:'DOH', k:'I', al:'qatar',           t:'TBIT', mi:8306, fn:'QR 740',  b:'Over 8,000 miles nonstop — one of the longest flights we handle.' },
    { c:'Dubai',              r:'Middle East',  a:'DXB', k:'I', al:'emirates',        t:'TBIT', mi:8339, fn:'EK 216',  b:'The longest route on the LAX board, flown by the biggest aircraft in the world.' },
    { c:'Auckland',           r:'Oceania',      a:'AKL', k:'I', al:'air-new-zealand', t:'TBIT', mi:6505, fn:'NZ 5',    b:'Straight across the South Pacific. You lose a day and gain a country.' },
    { c:'Brisbane',           r:'Oceania',      a:'BNE', k:'I', al:'qantas',          t:'TBIT', mi:7160, fn:'QF 16',   b:'Queensland sunshine and the gateway to the Great Barrier Reef.' },
    { c:'Melbourne',          r:'Oceania',      a:'MEL', k:'I', al:'qantas',          t:'TBIT', mi:7935, fn:'QF 94',   b:'Laneway coffee, street art and Australia\'s cultural capital.' },
    { c:'Sydney',             r:'Oceania',      a:'SYD', k:'I', al:'qantas',          t:'TBIT', mi:7488, fn:'QF 12',   b:'The Harbour Bridge and Opera House, fifteen hours from Century Boulevard.' },
    { c:'Manila',             r:'Asia',         a:'MNL', k:'I', al:'philippine',      t:'TBIT', mi:7300, fn:'PR 103',  b:'A route woven into the fabric of Los Angeles itself.' },
    { c:'Singapore',          r:'Asia',         a:'SIN', k:'I', al:'singapore',       t:'TBIT', mi:8770, fn:'SQ 37',   b:'Nonstop across the Pacific and the equator. Seventeen hours in the air.' },
    { c:'Guangzhou',          r:'Asia',         a:'CAN', k:'I', al:'china-southern',  t:'TBIT', mi:7570, fn:'CZ 328',  b:'The Pearl River Delta — the workshop of the world.' },
    { c:'Beijing',            r:'Asia',         a:'PEK', k:'I', al:'air-china',       t:'TBIT', mi:6250, fn:'CA 984',  b:'The Forbidden City, the Great Wall and 3,000 years of capital.' },
    { c:'Hong Kong',          r:'Asia',         a:'HKG', k:'I', al:'cathay-pacific',  t:'TBIT', mi:7260, fn:'CX 883',  b:'Skyscrapers on a harbour, and one of aviation\'s great crossroads.' },
    { c:'Taipei',             r:'Asia',         a:'TPE', k:'I', al:'eva-air',         t:'TBIT', mi:6790, fn:'BR 21',   b:'Night markets, mountains and a hub that keeps growing.' },
    { c:'Osaka',              r:'Asia',         a:'KIX', k:'I', al:'japan-airlines',  t:'TBIT', mi:5820, fn:'JL 58',   b:'Japan\'s kitchen, on an airport built out in the middle of a bay.' },
    { c:'Seoul Incheon',      r:'Asia',         a:'ICN', k:'I', al:'korean-air',      t:'TBIT', mi:5975, fn:'KE 12',   b:'One of the busiest LAX long-haul markets, and a superb hub at the far end.' },
    { c:'Tokyo Narita',       r:'Asia',         a:'NRT', k:'I', al:'japan-airlines',  t:'TBIT', mi:5451, fn:'JL 61',   b:'The original transpacific trunk route. LAX has flown it for generations.' },
    { c:'Tokyo Haneda',       r:'Asia',         a:'HND', k:'I', al:'ana',             t:'TBIT', mi:5487, fn:'NH 175',  b:'Land right in the middle of Tokyo. Downtown in thirty minutes.' },
    { c:'Orlando',            r:'South',        a:'MCO', k:'D', al:'jetblue',         t:'T5',   mi:2218, fn:'B6 24',   b:'Coast to coast, and the whole plane is going to the same few places.' },
    { c:'Miami',              r:'South',        a:'MIA', k:'D', al:'american',        t:'T4',   mi:2342, fn:'AA 1122', b:'Two coasts, two cultures, one very long transcon.' },
    { c:'Atlanta',            r:'South',        a:'ATL', k:'D', al:'delta',           t:'T3',   mi:1947, fn:'DL 900',  b:'The busiest airport on earth, connected to ours many times a day.' },
    { c:'Denver',             r:'Mountain West',a:'DEN', k:'D', al:'frontier',        t:'T2',   mi:862,  fn:'F9 1120', b:'A mile high, with the Rockies filling the entire western horizon.' },
    { c:'Chicago O\'Hare',    r:'Midwest',      a:'ORD', k:'D', al:'united',          t:'T7',   mi:1745, fn:'UA 1',    b:'Flight UA1. The route that built the modern American network.' },
    { c:'Dallas/Fort Worth',  r:'South',        a:'DFW', k:'D', al:'american',        t:'T4',   mi:1235, fn:'AA 1200', b:'An airport bigger than Manhattan, three hours east of here.' },
    { c:'Phoenix',            r:'Southwest',    a:'PHX', k:'D', al:'american',        t:'T4',   mi:370,  fn:'AA 456',  b:'A one-hour shuttle across the desert, dozens of times a day.' },
    { c:'Seattle–Tacoma',     r:'Pacific NW',   a:'SEA', k:'D', al:'alaska',          t:'T6',   mi:954,  fn:'AS 1',    b:'Alaska Airlines Flight 1. The spine of the whole West Coast.' },
    { c:'Las Vegas',          r:'West',         a:'LAS', k:'D', al:'southwest',       t:'T1',   mi:236,  fn:'WN 1',    b:'Forty minutes gate to gate, and one of the busiest short hops anywhere.' },
    { c:'New York JFK',       r:'Northeast',    a:'JFK', k:'D', al:'delta',           t:'T3',   mi:2475, fn:'DL 400',  b:'The premium transcon. The most fought-over route in America.' },
    { c:'San Francisco',      r:'California',   a:'SFO', k:'D', al:'united',          t:'T7',   mi:337,  fn:'UA 300',  b:'The busiest run on our board. Nearly every hour, every day, forever.' }
  ];

  /* ---------- Terminal hotspots (percentage coords on the LAX map) -------- */
  var TERMINALS = [
    { id:'T1',   short:'T1',   chip:'T1',   name:'Terminal 1',    x:61.5, y:24.5,
      lead:'Southwest Airlines',
      body:'Southwest\'s home at LAX. A rebuilt ticketing hall, a new baggage system and a direct connection to the Automated People Mover station.' },
    { id:'T2',   short:'T2',   chip:'T2',   name:'Terminal 2',    x:52.5, y:30.5,
      lead:'Delta · Aeroméxico · Frontier',
      body:'The northern half of the Delta Sky Way project. Terminal 2 and Terminal 3 now work as one connected building behind security.' },
    { id:'T3',   short:'T3',   chip:'T3',   name:'Terminal 3',    x:40.0, y:36.5,
      lead:'Delta Air Lines',
      body:'Delta\'s flagship terminal at LAX. The rebuild opened up a huge, light-filled headhouse and a walkway straight through to Tom Bradley.' },
    { id:'TBIT', short:'TBIT', chip:'Tom Bradley', name:'Tom Bradley International Terminal', x:29.0, y:57.0,
      lead:'Most long-haul international carriers',
      body:'The front door to Los Angeles for the world. Home of the Great Hall, the Time Tower and the Air Garden, and connected to Terminals 3 and 4 behind security.' },
    { id:'T4',   short:'T4',   chip:'T4',   name:'Terminal 4',    x:46.5, y:69.0,
      lead:'American Airlines',
      body:'American\'s main LAX terminal, linked to Tom Bradley by a secure connector so international passengers never have to re-clear security.' },
    { id:'T5',   short:'T5',   chip:'T5',   name:'Terminal 5',    x:57.5, y:62.0,
      lead:'American · JetBlue · Hawaiian',
      body:'A busy shared pier on the south side of the horseshoe, and the LAX base for Hawaiian Airlines.' },
    { id:'T6',   short:'T6',   chip:'T6',   name:'Terminal 6',    x:67.5, y:55.0,
      lead:'Alaska Airlines',
      body:'Alaska\'s LAX base, and the launch point for most of our West Coast and mountain-country flying.' },
    { id:'T7',   short:'T7',   chip:'T7',   name:'Terminal 7',    x:76.0, y:48.0,
      lead:'United Airlines',
      body:'United\'s main terminal at LAX, and the origin of some of the oldest flight numbers in American aviation.' },
    { id:'T8',   short:'T8',   chip:'T8',   name:'Terminal 8',    x:83.5, y:40.5,
      lead:'United Airlines',
      body:'Connected to Terminal 7 behind security, Terminal 8 handles United\'s regional flying and overflow mainline gates.' },
    { id:'MSC',  short:'MSC',  chip:'Midfield', name:'Midfield Satellite Concourse', x:3.5, y:70.0,
      lead:'Wide-body international gates',
      body:'The newest gates at LAX, sitting out on the airfield west of Tom Bradley. Passengers reach them through an underground tunnel with moving walkways.' },
    { id:'THEME',short:'★',    chip:'Theme Building', name:'Theme Building', x:61.0, y:35.3,
      lead:'Los Angeles Historic-Cultural Monument',
      body:'The 1961 space-age landmark in the middle of the horseshoe. Four arches, a flying-saucer restaurant level, and the single most photographed thing at this airport.' },
    { id:'WCTA', short:'P',    chip:'West parking', name:'West Central Terminal Area', x:40.5, y:48.5,
      lead:'Parking & roadway',
      body:'The western parking structures inside the terminal horseshoe. World Way loops around the whole complex on two levels.' },
    { id:'ECTA', short:'P',    chip:'East parking', name:'East Central Terminal Area', x:69.0, y:33.5,
      lead:'Parking & roadway',
      body:'The eastern parking structures, and the point where most traffic enters the horseshoe from Century Boulevard.' }
  ];

  /* ---------- LAX photography ------------------------------------------- */
  var PHOTOS = [
    { f:'lax-pylons.jpg',      t:'The LAX Gateway Pylons',
      c:'Fifteen glass columns on Century Boulevard, lit from within. They shift colour through the night and tell you you have arrived before you see a single aircraft.' },
    { f:'theme-building.jpg',  t:'The Theme Building',
      c:'Opened in 1961 and shaped like something out of a comic book about the future. It has stood at the centre of the horseshoe ever since.' },
    { f:'tbit-aerial.jpg',     t:'Tom Bradley International Terminal',
      c:'Seen from a departing flight. The roofline was designed to echo ocean waves rolling in off Santa Monica Bay.' },
    { f:'tbit-great-hall.jpg', t:'The Great Hall',
      c:'Seventy-two-foot media walls, shops running the length of the building, and the quiet hum of a few thousand people all going somewhere.' },
    { f:'tbit-time-tower.jpg', t:'The Time Tower',
      c:'A 72-foot media sculpture rising through the middle of the departures hall. It is the first thing most international visitors photograph.' },
    { f:'tbit-connector.jpg',  t:'The Connector',
      c:'The secure walkway between Tom Bradley and the domestic terminals, with a woven light installation stretched overhead.' },
    { f:'tbit-air-garden.jpg', t:'The Air Garden',
      c:'Coloured threads hung four storeys through an atrium, moving gently whenever the doors below open.' },
    { f:'hangar-one.jpg',      t:'Hangar No. 1',
      c:'Built in 1929, when this was still Mines Field and the runway was packed dirt. It is a Historic-Cultural Monument and it is still in use.' }
  ];

  /* ---------- Videos (privacy-friendly youtube-nocookie embeds) ---------- */
  var VIDEOS_GUIDE = [
    { id:'yg0uCvnHg74', n:'01', t:'How to live a life you won\u2019t regret',
      w:'Bryan Cranston \u00B7 grew up in Canoga Park, Los Angeles',
      d:'He talks about swapping \u201Cplease pick me\u201D for \u201Chere is my work.\u201D Do the job in front of you as well as you can, then let go of the result. A good one for day one.' },
    { id:'0wVM3uHLbfE', n:'02', t:'Commencement speech at Westminster College',
      w:'Robert Redford \u00B7 born in Santa Monica, Los Angeles',
      d:'A calm, unhurried talk about choosing your own path and staying curious. Save it for a day when you are questioning whether any of this matters.' },
    { id:'YCi6K_HfZvQ', n:'03', t:'Leonardo DiCaprio\u2019s speech \u2014 best life advice',
      w:'Leonardo DiCaprio \u00B7 born in Hollywood, Los Angeles',
      d:'On not waiting until you feel ready, and on caring about something bigger than yourself. Short, and it lands.' },
    { id:'dTRBnHtHehQ', n:'04', t:'Kobe Bryant \u2014 the Mamba Mentality',
      w:'Kobe Bryant \u00B7 born in Philadelphia, a Laker and an Angeleno for life',
      d:'Twenty years, one team, no excuses. This is the video for the day you do not feel like ticking a single box \u2014 that is exactly the day it is for.' },
    { id:'J5PKwKAnC4c', n:'05', t:'\u201CLet yourself be inspired\u201D \u2014 focus on inspiration, not imitation',
      w:'Billie Eilish \u00B7 born and raised in Highland Park, Los Angeles',
      d:'Take what you love from other people and make it yours instead of copying it. That goes for schedules too \u2014 borrow the template, then bend it until it fits you.' }
  ];

  var VIDEOS_LA = [
    { id:'QropkR9iasY', n:'01', t:'The story of Los Angeles, California\u2019s megacity',
      d:'Start here if you have never been. How a desert basin became a city of millions, and why it sprawls the way it does.' },
    { id:'CNaf0lV2AIo', n:'02', t:'Dumb mistakes tourists make in Los Angeles', start:27,
      d:'Worth watching before you book anything. Underestimating the driving distances is the big one \u2014 nothing in LA is as close as it looks on a map.' },
    { id:'wLB2Hd2tzoQ', n:'03', t:'LAX walking tour \u2014 all terminals',
      d:'A walk through the whole airport, terminal by terminal. Watch this next to the Airfield tab and you will recognise every building on your map.' },
    { id:'rctsYGhnsEw', n:'04', t:'Driving the LA coastline in 8K \u2014 Pacific Palisades to Huntington Beach',
      d:'No talking, just the coast road end to end. Good background for a work block, and the best answer to \u201Cwhy do people live there?\u201D' },
    { id:'ebiOEZdlJYg', n:'05', t:'12 hours in LA \u2014 a Michelin chef shows us where he eats',
      d:'Funke, Bianco, Kato, RVR and more. The food is the strongest argument the city has, and this is a ready-made eating list.' },
    { id:'1mhGD_1o71M', n:'06', t:'Inside UCLA \u2014 campus tour',
      d:'One of the finest public universities anywhere, ten minutes from the beach. Brick, jacaranda trees and a very good look at Westwood.' },
    { id:'KFGap8jLMqg', n:'07', t:'The extreme rich and poor divide in Los Angeles \u2014 documentary',
      d:'The harder side of the same city, and an honest one. Los Angeles has both enormous wealth and a serious homelessness crisis, and it is worth understanding both.' }
  ];

  /* ---------- Starter task templates ------------------------------------ */
  var TEMPLATES = {
    ops: {
      name: 'Daily Ops',
      tasks: [
        '07.00-07.20 Move for 20 minutes',
        '09.00-10.30 Deep work block \u2014 no phone',
        '10.30-11.00 Clear the inbox',
        '12.30-13.15 Eat a real meal away from the desk',
        '20.00-20.30 Read 10 pages',
        '21.30-21.45 Plan tomorrow before bed'
      ]
    },
    ceo: {
      name: 'Executive Turnaround',
      tasks: [
        '06.30-06.50 Walk the terminals — 20 min of movement',
        '08.30-09.00 One hard decision, made and sent',
        '09.00-11.00 Two hours on the thing that actually matters',
        '14.00-14.30 Check in with one person on the team',
        '16.00-16.30 Learn something new for 30 minutes',
        '18.00-18.15 Shut down properly — no work after this',
        '21.00-21.15 Tomorrow\'s schedule written down'
      ]
    },
    light: {
      name: 'Gentle Day',
      tasks: [
        'Drink water',
        'Step outside',
        'One small task, finished',
        'Something kind for yourself'
      ]
    }
  };

  /* ---------- Rank ladder ------------------------------------------------ */
  var RANKS = [
    { at: 0.00, world: 9, title: 'Incoming CEO',      note: 'Badge printed. Office keys collected.' },
    { at: 0.05, world: 8, title: 'Acting CEO',        note: 'The board is watching. So far, so good.' },
    { at: 0.12, world: 7, title: 'Operations CEO',    note: 'On-time performance is climbing.' },
    { at: 0.22, world: 6, title: 'Turnaround CEO',    note: 'People have started to notice LAX again.' },
    { at: 0.34, world: 5, title: 'Network CEO',       note: 'Airlines are calling you now, not the other way round.' },
    { at: 0.47, world: 4, title: 'Growth CEO',        note: 'Every new route sells out. Build more gates.' },
    { at: 0.62, world: 3, title: 'Gateway CEO',       note: 'LAX is the front door to the Pacific.' },
    { at: 0.78, world: 2, title: 'Visionary CEO',     note: 'One airport left above you. You can see it.' },
    { at: 1.00, world: 1, title: 'Legend of LAX',     note: 'Number one in the world. You did that.' }
  ];

  /* ---------- Encouragement --------------------------------------------- */
  var CHEERS = {
    gold:   ['Full schedule flown. Nothing left on the board.',
             'Every flight departed on time. That is a perfect day.',
             'All clear. The tower is genuinely impressed.',
             'Nobody misses a day like that by accident. Well flown.',
             'Sixteen points. Maximum. Take the win.'],
    silver: ['Strong day. Most of the board cleared.',
             'That is a solid operation. Eight points banked.',
             'Good flying. A little left on the ground, and that is fine.',
             'Well above the line. Keep this rhythm.'],
    bronze: ['You kept the schedule. That counts.',
             'Half the board cleared on a hard day still beats an empty one.',
             'Four points is four more than yesterday. Good.',
             'Showing up is the whole game. You showed up.'],
    none:   ['Logged. Some days are just weather.',
             'No points today, and the airport is still standing. Try again tomorrow.',
             'Grounded, not closed. Tomorrow is a fresh board.',
             'Every operation has a bad day. This one is behind you now.']
  };

  var NUDGES = [
    'One task now is worth three tasks later.',
    'You do not need a perfect day. You need a logged one.',
    'Half done still beats not started.',
    'The board clears one flight at a time.',
    'Small and steady is how airports get built.',
    'Nobody is watching. Do it anyway.',
    'Start with the easiest one. Momentum is real.'
  ];

  root.LAX_DATA = {
    AIRLINES: AIRLINES,
    ROUTES: ROUTES,
    TERMINALS: TERMINALS,
    PHOTOS: PHOTOS,
    VIDEOS_GUIDE: VIDEOS_GUIDE,
    VIDEOS_LA: VIDEOS_LA,
    TEMPLATES: TEMPLATES,
    RANKS: RANKS,
    CHEERS: CHEERS,
    NUDGES: NUDGES,
    SEASON: { start: '2026-09-01', end: '2026-12-31' }
  };
})(window);
