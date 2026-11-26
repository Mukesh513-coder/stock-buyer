/**
 * Stock Buyer - MongoDB-backed Node.js server and live market API.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');

const PORT = 5000;
const ROOT_DIR = path.resolve(__dirname, '..');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'stock_buyer';
const mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
let users;
let sessions;
let databaseConnected = false;

// In-memory quote cache
const quoteCache = {
  data: {},
  lastUpdated: 0
};
const companyCache = new Map();
const newsCache = new Map();
let indianSymbolsCache = { data: null, lastUpdated: 0 };

async function connectDatabase() {
  await mongoClient.connect();
  const database = mongoClient.db(MONGODB_DB_NAME);
  users = database.collection('users');
  sessions = database.collection('sessions');

  const caseInsensitive = { locale: 'en', strength: 2 };
  await Promise.all([
    users.createIndex({ username: 1 }, { unique: true, collation: caseInsensitive }),
    users.createIndex({ email: 1 }, { unique: true, collation: caseInsensitive }),
    sessions.createIndex({ token: 1 }, { unique: true }),
    sessions.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 })
  ]);
  databaseConnected = true;

  if (process.env.NODE_ENV !== 'production' && await users.countDocuments() === 0) {
    const now = new Date();
    const savedInfo = {
      remember_me: true,
      saved_email: 'trader@stockbuyer.io',
      saved_username: 'AlexTrader',
      saved_at: now.toISOString(),
      auto_login: true
    };
    await users.insertOne({
      username: 'AlexTrader',
      email: 'trader@stockbuyer.io',
      password_hash: hashPassword('password123'),
      full_name: 'Alex Vance',
      avatar: '⚡',
      balance: 100000,
      saved_login_info: savedInfo,
      created_at: now,
      updated_at: now
    });
    console.log(" [MongoDB] Seeded demo user: username='AlexTrader', email='trader@stockbuyer.io'");
  }

  console.log(` [MongoDB] Connected to ${MONGODB_DB_NAME}`);
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// --- LIVE STOCK & CRYPTO API FETCH ---
async function fetchLiveQuotes() {
  const now = Date.now();
  if (quoteCache.data && (now - quoteCache.lastUpdated < 10000)) {
    return quoteCache.data;
  }

  const quotes = {};
  const stockSymbols = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMZN', 'GOOGL', 'AMD', 'SPY', 'QQQ'];
  const stockResults = await Promise.allSettled(stockSymbols.map(symbol => getYahooCompany(symbol, '1d', '1d')));
  stockResults.forEach((result, index) => {
    if (result.status === 'fulfilled' && Number.isFinite(result.value.price)) {
      quotes[stockSymbols[index]] = { ...result.value, symbol: stockSymbols[index], source: 'Yahoo Finance' };
    }
  });

  const cryptoMap = {
    BTCUSDT: 'BTC-USD', ETHUSDT: 'ETH-USD', SOLUSDT: 'SOL-USD',
    BNBUSDT: 'BNB-USD', ADAUSDT: 'ADA-USD', XRPUSDT: 'XRP-USD'
  };
  try {
    const url = new URL('https://api.binance.com/api/v3/ticker/24hr');
    url.searchParams.set('symbols', JSON.stringify(Object.keys(cryptoMap)));
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      for (const ticker of await response.json()) {
        const symbol = cryptoMap[ticker.symbol];
        quotes[symbol] = {
          symbol,
          price: Number(ticker.lastPrice),
          prevClose: Number(ticker.prevClosePrice),
          change: Number(ticker.priceChange),
          changePercent: Number(ticker.priceChangePercent),
          high: Number(ticker.highPrice),
          low: Number(ticker.lowPrice),
          volume: ticker.volume,
          timestamp: new Date().toISOString(),
          source: 'Binance'
        };
      }
    }
  } catch (error) {
    console.error(' [Market] Binance ticker request failed:', error.message);
  }

  if (Object.keys(quotes).length > 0) {
    quoteCache.data = quotes;
    quoteCache.lastUpdated = now;
  }
  return quoteCache.data;
}

async function getYahooCompany(symbol, range = '1d', interval = '1d', refresh = false) {
  const cacheKey = `${symbol}:${range}:${interval}`;
  const cached = companyCache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.lastUpdated < 60000) return cached.data;

  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set('range', range);
  url.searchParams.set('interval', interval);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Yahoo Finance request failed (${response.status}).`);

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  if (!result?.meta) throw new Error(`No Yahoo Finance data is available for ${symbol}.`);
  const meta = result.meta;
  const quoteData = result.indicators?.quote?.[0] || {};
  const candles = (result.timestamp || []).flatMap((time, index) => {
    const open = quoteData.open?.[index];
    const high = quoteData.high?.[index];
    const low = quoteData.low?.[index];
    const close = quoteData.close?.[index];
    if ([open, high, low, close].some(value => !Number.isFinite(value))) return [];
    return [{
      time: time * 1000,
      open,
      high,
      low,
      close,
      volume: quoteData.volume?.[index] || 0
    }];
  });
  const price = Number(meta.regularMarketPrice ?? candles.at(-1)?.close);
  const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? price);
  const data = {
    symbol,
    name: meta.longName || meta.shortName || symbol,
    currency: meta.currency,
    price,
    prevClose,
    change: price - prevClose,
    changePercent: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
    high: meta.regularMarketDayHigh,
    low: meta.regularMarketDayLow,
    high52: meta.fiftyTwoWeekHigh,
    low52: meta.fiftyTwoWeekLow,
    volume: meta.regularMarketVolume,
    timestamp: new Date((meta.regularMarketTime || Date.now() / 1000) * 1000).toISOString(),
    candles
  };
  companyCache.set(cacheKey, { data, lastUpdated: Date.now() });
  return data;
}

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

async function fetchYahooNews(query, region = 'US', language = 'en-US') {
  const key = `${query}:${region}:${language}`;
  const cached = newsCache.get(key);
  if (cached && Date.now() - cached.lastUpdated < 300000) return cached.items;

  const url = new URL('https://feeds.finance.yahoo.com/rss/2.0/headline');
  url.searchParams.set('s', query);
  url.searchParams.set('region', region);
  url.searchParams.set('lang', language);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Yahoo Finance news request failed (${response.status}).`);
  const xml = await response.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const getField = field => decodeXml(item.match(new RegExp(`<${field}[^>]*>([\\s\\S]*?)<\\/${field}>`, 'i'))?.[1] || '');
    const link = getField('link');
    let source = 'Yahoo Finance';
    try { source = new URL(link).hostname.replace(/^www\./, ''); } catch (error) {}
    return {
      title: getField('title'),
      summary: getField('description'),
      link,
      source,
      publishedAt: getField('pubDate')
    };
  }).filter(item => item.title && item.link);
  newsCache.set(key, { items, lastUpdated: Date.now() });
  return items;
}

async function fetchNseSymbols() {
  if (indianSymbolsCache.data && Date.now() - indianSymbolsCache.lastUpdated < 43200000) {
    return indianSymbolsCache.data;
  }
  const response = await fetch('https://archives.nseindia.com/content/equities/EQUITY_L.csv', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`NSE listed-company directory request failed (${response.status}).`);
  const csv = await response.text();
  const parseCsvRow = row => {
    const columns = [];
    let value = '';
    let inQuotes = false;
    for (let index = 0; index < row.length; index += 1) {
      const character = row[index];
      if (character === '"' && row[index + 1] === '"' && inQuotes) {
        value += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = !inQuotes;
      } else if (character === ',' && !inQuotes) {
        columns.push(value);
        value = '';
      } else {
        value += character;
      }
    }
    columns.push(value);
    return columns;
  };
  const rows = csv.split(/\r?\n/).slice(1).map(parseCsvRow);
  const symbols = rows
    .filter(row => row[0] && row[1] && ['EQ', 'BE', 'BZ'].includes(row[2]))
    .map(row => ({
      symbol: row[0].trim(),
      name: row[1].trim(),
      exchange: 'NSE',
      series: row[2],
      sector: 'N/A',
      capType: 'N/A',
      marketCap: null,
      pe: null
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  if (!symbols.length) throw new Error('NSE listed-company directory returned no equity symbols.');
  indianSymbolsCache = { data: symbols, lastUpdated: Date.now() };
  return symbols;
}

// --- HTTP SERVER ---
async function handleRequest(req, res) {
  // Common CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Helper to parse JSON body
  const readJson = () => new Promise(resolve => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (e) { resolve({}); }
    });
  });

  // --- API ROUTES ---

  // Health
  if (pathname === '/api/health') {
    const userCount = databaseConnected ? await users.countDocuments() : 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      server: 'Node.js',
      database: databaseConnected ? `MongoDB (${MONGODB_DB_NAME})` : 'MongoDB unavailable',
      databaseConnected,
      totalUsers: userCount,
      liveApiSupported: true,
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // Live Market Quotes
  if (pathname === '/api/market/live') {
    const liveQuotes = await fetchLiveQuotes();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      count: Object.keys(liveQuotes).length,
      quotes: liveQuotes,
      timestamp: new Date().toISOString()
    }));
    return;
  }

  if (pathname === '/api/market/company') {
    const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
    if (!/^[A-Z0-9.^=-]{1,16}$/.test(symbol)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'A valid Yahoo Finance symbol is required.' }));
      return;
    }
    const range = url.searchParams.get('range') || '6mo';
    const interval = url.searchParams.get('interval') || '1d';
    if (!['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y'].includes(range) ||
        !['5m', '15m', '1h', '1d', '1wk', '1mo'].includes(interval)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Unsupported Yahoo Finance range or interval.' }));
      return;
    }
    const company = await getYahooCompany(symbol, range, interval);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' });
    res.end(JSON.stringify({ success: true, company }));
    return;
  }

  if (pathname === '/api/market/indian-indices') {
    const indices = [
      { symbol: '^NSEI', name: 'NIFTY 50' },
      { symbol: '^BSESN', name: 'BSE SENSEX' },
      { symbol: '^NSEBANK', name: 'BANK NIFTY' },
      { symbol: '^CNXIT', name: 'NIFTY IT' },
      { symbol: '^CNXAUTO', name: 'NIFTY AUTO' }
    ];
    const results = await Promise.all(indices.map(async index => {
      try {
        const quote = await getYahooCompany(index.symbol, '1d', '1d');
        return { ...index, price: quote.price, change: quote.change, changePercent: quote.changePercent, timestamp: quote.timestamp };
      } catch (error) {
        return { ...index, error: error.message };
      }
    }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' });
    res.end(JSON.stringify({ success: true, source: 'Yahoo Finance', indices: results }));
    return;
  }

  if (pathname === '/api/market/indian-stocks') {
    const symbols = await fetchNseSymbols();
    const query = (url.searchParams.get('q') || '').trim().toLowerCase();
    const requestedSymbols = (url.searchParams.get('symbols') || '')
      .split(',')
      .filter(Boolean)
      .map(symbol => symbol.toUpperCase());
    const filtered = requestedSymbols.length
      ? symbols.filter(item => requestedSymbols.includes(item.symbol))
      : query
        ? symbols.filter(item => item.symbol.toLowerCase().includes(query) || item.name.toLowerCase().includes(query))
        : symbols;
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(10000, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '20', 10) || 20));
    const rows = filtered.slice((page - 1) * limit, page * limit);
    const includeQuotes = url.searchParams.get('quotes') !== 'false';
    const refresh = url.searchParams.get('refresh') === 'true';
    const companies = includeQuotes ? await Promise.all(rows.map(async item => {
      try {
        const quote = await getYahooCompany(`${item.symbol}.NS`, '1d', '1d', refresh);
        return {
          ...item,
          price: quote.price,
          prevClose: quote.prevClose,
          change: quote.change,
          changePercent: quote.changePercent,
          high: quote.high,
          low: quote.low,
          high52: quote.high52,
          low52: quote.low52,
          volume: quote.volume,
          quoteUpdatedAt: quote.timestamp
        };
      } catch (error) {
        return { ...item, price: null, change: null, changePercent: null, high52: null, low52: null, quoteError: error.message };
      }
    })) : rows;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' });
    res.end(JSON.stringify({ success: true, source: includeQuotes ? 'NSE listed equity directory + Yahoo Finance quotes' : 'NSE listed equity directory', total: filtered.length, page, limit, companies }));
    return;
  }

  if (pathname === '/api/market/news' || pathname === '/api/market/ipo-news') {
    const isIpoNews = pathname.endsWith('/ipo-news');
    const items = isIpoNews
      ? await fetchYahooNews('IPO', 'IN', 'en-IN')
      : await fetchYahooNews('NVDA,AAPL,TSLA,MSFT,AMZN,GOOGL,BTC-USD,ETH-USD', 'US', 'en-US');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' });
    res.end(JSON.stringify({
      success: true,
      source: 'Yahoo Finance RSS',
      dataType: isIpoNews ? 'India IPO-related news (not an official issue calendar)' : 'Market news',
      items
    }));
    return;
  }

  if (pathname.startsWith('/api/auth/') && !databaseConnected) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, message: 'MongoDB is unavailable. Live market data remains available.' }));
    return;
  }

  // Auth: Register
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const body = await readJson();
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password.trim() : '';
    const fullName = (typeof body.fullName === 'string' ? body.fullName.trim() : '') || username;
    const avatar = body.avatar || '⚡';
    const saveLoginInfo = !!body.saveLoginInfo;

    if (!username || !email || !password || password.length < 6) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Valid username, email, and password (min 6 chars) required.' }));
      return;
    }

    const passHash = hashPassword(password);
    const savedInfo = {
      remember_me: saveLoginInfo,
      saved_email: email,
      saved_username: username,
      saved_at: new Date().toISOString(),
      auto_login: saveLoginInfo
    };

    const token = crypto.randomBytes(24).toString('hex');
    const now = new Date();
    let user;
    try {
      const result = await users.insertOne({
        username,
        email,
        password_hash: passHash,
        full_name: fullName,
        avatar,
        balance: 100000,
        saved_login_info: savedInfo,
        created_at: now,
        updated_at: now
      });
      user = { _id: result.insertedId, username, email, full_name: fullName, avatar, balance: 100000 };
    } catch (error) {
      if (error.code !== 11000) throw error;
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Username or email already exists in MongoDB.' }));
      return;
    }
    await sessions.insertOne({ user_id: user._id, token, expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), created_at: now });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: 'User registered successfully in MongoDB!',
      user: { id: user._id.toString(), username, email, fullName, avatar, balance: 100000, savedLoginInfo: savedInfo },
      token
    }));
    return;
  }

  // Auth: Login
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readJson();
    const loginId = typeof body.login === 'string' ? body.login.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password.trim() : '';
    const saveLoginInfo = !!body.saveLoginInfo;

    const passHash = hashPassword(password);
    const user = await users.findOne({
      $or: [{ email: loginId }, { username: loginId }],
      password_hash: passHash
    }, { collation: { locale: 'en', strength: 2 } });

    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Invalid email/username or password.' }));
      return;
    }

    const savedInfo = {
      remember_me: saveLoginInfo,
      saved_email: user.email,
      saved_username: user.username,
      last_login: new Date().toISOString(),
      auto_login: saveLoginInfo
    };

    const token = crypto.randomBytes(24).toString('hex');
    const now = new Date();
    await users.updateOne({ _id: user._id }, { $set: { saved_login_info: savedInfo, updated_at: now } });
    await sessions.insertOne({ user_id: user._id, token, expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), created_at: now });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: `Welcome back, ${user.full_name}!`,
      user: {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        avatar: user.avatar,
        balance: user.balance,
        savedLoginInfo: savedInfo
      },
      token
    }));
    return;
  }

  // Auth: Update profile
  if (pathname === '/api/auth/update' && req.method === 'POST') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const session = token ? await sessions.findOne({ token, expires_at: { $gt: new Date() } }) : null;
    const user = session ? await users.findOne({ _id: session.user_id }) : null;
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Invalid or expired session.' }));
      return;
    }

    const body = await readJson();
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const avatar = typeof body.avatar === 'string' ? body.avatar : user.avatar;
    const update = {
      full_name: fullName || user.username,
      avatar,
      saved_login_info: {
        ...user.saved_login_info,
        ...(body.savedLoginInfo && typeof body.savedLoginInfo === 'object' ? body.savedLoginInfo : {})
      },
      updated_at: new Date()
    };
    if (typeof body.newPassword === 'string' && body.newPassword.length > 0) {
      if (body.newPassword.length < 6) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Password must be at least 6 characters.' }));
        return;
      }
      update.password_hash = hashPassword(body.newPassword);
    }
    await users.updateOne({ _id: user._id }, { $set: update });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'User details and saved login info updated in MongoDB.' }));
    return;
  }

  // Auth: Logout
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (token) await sessions.deleteOne({ token });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Auth: Me
  if (pathname === '/api/auth/me') {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    const session = token ? await sessions.findOne({ token, expires_at: { $gt: new Date() } }) : null;
    const user = session ? await users.findOne({ _id: session.user_id }) : null;

    if (user) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        user: {
          id: user._id.toString(), username: user.username, email: user.email,
          fullName: user.full_name, avatar: user.avatar, balance: user.balance,
          savedLoginInfo: user.saved_login_info, createdAt: user.created_at
        }
      }));
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Invalid or expired session.' }));
    }
    return;
  }

  // --- STATIC FILE SERVING (index.html, css/, js/) ---
  let relPath = pathname.replace(/^\/+/, '');
  if (!relPath) relPath = 'index.html';

  const filePath = path.resolve(ROOT_DIR, relPath);

  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Access Denied');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    console.error(' [Server] Request failed:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Internal server error.' }));
    } else {
      res.destroy(error);
    }
  });
});

async function startServer() {
  try {
    await connectDatabase();
  } catch (error) {
    console.error(' [MongoDB] Database unavailable; public market-data endpoints will still run:', error.message);
  }
  server.listen(PORT, () => {
    console.log('=' .repeat(70));
    console.log(` [LIVE WEBSITE] Stock Buyer is LIVE on http://localhost:${PORT}`);
    console.log(` [STACK] Node.js + ${databaseConnected ? `MongoDB (${MONGODB_DB_NAME})` : 'Public market-data APIs'} + Live feeds`);
    console.log(' [URL] Open in browser: http://localhost:5000');
    console.log('=' .repeat(70));
  });
}

startServer().catch(error => {
  console.error(' [Server] Unable to start:', error.message);
  process.exitCode = 1;
});
