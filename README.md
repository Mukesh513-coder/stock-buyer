# Stock Buyer

A paper-trading and market-exploration web app built with HTML, CSS, vanilla JavaScript, and a Node.js API. It includes a MongoDB-backed account service, live Binance crypto candles, and market data for supported assets.

![Theme](https://img.shields.io/badge/Theme-Dark%20Blue%20%26%20Light%20Blue-0284c7)
![Tech](https://img.shields.io/badge/Frontend-Native%20HTML5%20%2F%20CSS3%20%2F%20Vanilla%20JS-38bdf8)
![Backend](https://img.shields.io/badge/Backend-Node.js%20%7C%20MongoDB-00f0ff)
![Market API](https://img.shields.io/badge/Live%20API-Yahoo%20Finance%20%2B%20Binance-10b981)

---

## 🌟 Key Features

### Live Binance Candlestick Chart
- The trading terminal chart uses TradingView Lightweight Charts with live Binance REST kline history and WebSocket updates for BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, ADAUSDT, and XRPUSDT.
- Choose 1-minute, 5-minute, 15-minute, 1-hour, or 1-day candles. Volume bars follow candle direction, and the feed automatically reconnects after WebSocket interruptions.

### 1. 👤 Navbar User Section & Saved Login Info (MongoDB)
- **User Authentication in Navbar**: Displays `Sign In / Save Info` when logged out. Once signed in, renders a personalized user badge with avatar, user display name, and MongoDB ID.
- **Saved Login Info**: Users can check **"Save my login info"** to store profile preferences and sessions in MongoDB.
- **User Dropdown Menu**:
  - 🔐 **Saved Login Info & Profile**: View and edit stored credentials, update display name or password, and toggle automatic login on current device.
  - 💳 **Virtual Buying Power ($100K)**: Quick link to paper trading funds.
  - 🗄️ **Database Details**: Inspect MongoDB connection status.
  - 🚪 **Sign Out**: Revokes the active MongoDB session.
- **Dual Mode (Server + Local Fallback)**: Automatically connects to `http://localhost:5000` when the backend is active and provides an offline browser-storage fallback when opened standalone.

### 2. 🔴 Real-Time Live Stocks & Crypto API Feed
- **Stock Quotes**: Fetches available market prices through the Yahoo Finance backend proxy; prices may be delayed or unavailable.
- **Crypto Quotes**: Uses Binance public market data for BTC, ETH, SOL, and other supported assets. Binance kline WebSocket updates power the terminal candlestick chart.
- **Navbar Status Pill (`🔴 LIVE API`)**: Indicates the available API sources. Clicking the pill requests a market-data refresh.
- **No fabricated fallback prices**: When a provider is unavailable, the UI reports that data is unavailable instead of generating market prices.

### 3. 📈 Live Trading Terminal ("Stock Buyer WebTrader")
- **Lightweight Charts**: Binance historical klines and live WebSocket updates render as responsive candlesticks with volume.
- **Indian Equity View**: Loads NSE EQ/BE/BZ symbols from the official directory (2,634 securities when last checked) and displays free Yahoo Finance quotes for the visible page. Quotes refresh on demand or every 60 seconds while the view is open; Yahoo data may be delayed and is not guaranteed exchange real-time. BSE listings are not currently included. Unavailable sector, valuation, and market-cap data are not fabricated.
- **IPO News**: Displays India IPO-related Yahoo Finance RSS headlines. It does not claim to provide an official IPO calendar, current offer terms, subscription data, or allotment results.
- **Indian Canvas Chart**: The Indian equity view retains its custom Canvas chart for historical prices.
- **Interactive Crosshairs & HUD**: Real-time cursor tracking displaying Open, High, Low, Close, Volume, and % Change.
- **Timeframe Selector**: Toggle between 1D, 1W, 1M, and 1Y charts.
- **Technical Overlays**: Toggle 20-period and 50-period Simple Moving Averages (SMA) and volume histogram bars.
- **Order Book Depth Ladder**: Live updating bids and asks with visual volume depth bars.
- **Order Execution Panel**: Place instant **Market** orders or queued **Limit** orders with 25%, 50%, 75%, 100% quick-fill buttons.
- **Paper Trading Portfolio**: Starting virtual balance of $100,000.00 with live unrealized P&L, transaction history, and one-click position closing.
- **Native Synthesized Audio**: Built-in browser Web Audio API chimes for order execution and error alerts (zero audio assets needed).

### 4. 🏛️ Top Trading Platforms Directory & Comparison
- Curated profiles for **12 premier global trading platforms and brokerages**:
  - *Interactive Brokers (IBKR)*, *Robinhood*, *Webull*, *TradingView*, *Binance*, *Charles Schwab (thinkorswim)*, *eToro*, *Fidelity*, *Coinbase*, *Zerodha*, *Kraken*, and *TradeStation*.
- **Filter Chips**: Filter by Zero-Commission, Crypto Exchanges, Pro & Institutional, or Beginner Friendly.
- **Side-by-Side Comparison Matrix**: Select up to 3 platforms to evaluate fees, margin interest rates, minimum deposits, and target audiences side-by-side.

### 5. 🎯 Platform Matcher Quiz
- An interactive 4-step wizard that asks users about their primary asset focus, experience level, priority (zero fees, margin rates, charting, security), and preferred device to recommend their best-fit broker with match percentages.

### 6. 🔍 Multi-Asset Market Screener
- Searchable table across equities, index funds, and cryptocurrencies with available price and change data. Valuation and 52-week fields show as unavailable when the feed does not supply them.

---

## 🎨 Color Palette (Dark Blue & Light Blue)

| Element | Hex Code | Purpose |
|---|---|---|
| Midnight Navy | `#050B16` | Main app background |
| Deep Blue Surface | `#0A1526` | Card and panel container backgrounds |
| Elevated Dark Blue | `#0F2038` | Hover states and elevated navigation bars |
| Navy Border | `#162C4B` | Subtle card borders and divider lines |
| Sky Light Blue | `#38BDF8` | Primary light blue brand accent, buttons & tabs |
| Soft Ice Blue | `#7DD3FC` | Supporting light blue subtitles and active tags |
| Electric Neon Cyan | `#00F0FF` | Glowing highlights, bullish candlestick bars, live dots |
| Coral Red | `#FF3B69` | Bearish price changes, sell actions |

---

## 🚀 Getting Started

### Requirements

- Node.js 20 or newer
- MongoDB (optional for public market-data routes; required for server-backed account registration and sign-in)

### Run locally

Clone this repository, then from its root directory install the server dependencies and start the app:

```bash
npm --prefix server install
npm --prefix server start
```

Open [http://localhost:5000](http://localhost:5000). Public market-data routes can run without MongoDB, but authentication is unavailable until MongoDB connects. The backend defaults to `mongodb://127.0.0.1:27017` and creates the `stock_buyer` database and collections when connected.

To use MongoDB Atlas or another database, set `MONGODB_URI` in your environment before starting the server. In PowerShell:

```powershell
$env:MONGODB_URI = "mongodb+srv://<username>:<password>@<cluster-host>/?retryWrites=true&w=majority"
npm --prefix server start
```

The server creates `users` and `sessions` collections and adds unique account/session indexes. Outside production mode, it seeds a development-only demo account (`trader@stockbuyer.io` / `password123`) when the users collection is empty. Set `NODE_ENV=production` to disable demo seeding. Never deploy with demo credentials or commit real MongoDB connection strings.

### Market-data limitations

- Stock and Indian equity quotes use Yahoo Finance's public endpoints; availability and freshness are not guaranteed, and quotes may be delayed.
- NSE security symbols come from the public NSE equity directory. The current directory includes EQ, BE, and BZ series; no BSE company directory is connected.
- Binance provides public crypto ticker, candlestick history, and WebSocket updates.
- This is a paper-trading app. It does not submit real orders or provide investment advice.
- Respect each data provider's terms and rate limits.

## License

This project is distributed under the MIT License. See [LICENSE](LICENSE).

---

## 📁 File Structure

```text
Stock Buyer/
├── index.html         # Master HTML5 single-page application with all views & modals
├── css/
│   └── styles.css     # Pure CSS3 styling (Dark Blue & Light Blue theme)
├── js/
│   ├── auth.js        # MongoDB user authentication, session, and saved login manager
│   ├── market-api.js  # Live stock & crypto API client (Yahoo Finance + Binance)
│   ├── data.js        # Platforms database, market assets & news feed
│   ├── chart.js       # Existing canvas chart for the Indian stock view
│   ├── binance-chart.js # Lightweight Charts candlestick view
│   ├── binance-klines.js # Binance history and reconnecting WebSocket feed
│   ├── trading.js     # Paper trading wallet, order book & audio synth
│   └── app.js         # Navigation, event listeners & UI controller
├── server/
│   ├── server.js      # Node.js + MongoDB API and static server
│   ├── server.py      # Legacy SQLite backend (optional)
│   └── package.json   # MongoDB driver and server scripts
└── README.md          # Project documentation
```
