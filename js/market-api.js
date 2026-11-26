/**
 * Stock Buyer - Live Market API Client
 * Connects to live public stock and cryptocurrency price feeds.
 * Sources: Yahoo Finance through the local API and Binance's public ticker API.
 */

class LiveMarketAPI {
  constructor(tradingEngine) {
    this.tradingEngine = tradingEngine;
    this.backendUrl = "/api/market/live";
    this.binanceApiUrl = "https://api.binance.com/api/v3/ticker/24hr";
    
    this.isLiveApiActive = true;
    this.pollingInterval = null;
    this.pollIntervalMs = 8000; // 8 seconds
    this.lastUpdated = null;
    this.connectedSource = "Initializing...";

    this.init();
  }

  init() {
    this.fetchLiveMarketData();
    this.startPolling();
    this.renderStatusPill();
  }

  startPolling() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    this.pollingInterval = setInterval(() => {
      if (this.isLiveApiActive) {
        this.fetchLiveMarketData();
      }
    }, this.pollIntervalMs);
  }

  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  // --- FETCH REAL-TIME MARKET DATA ---
  async fetchLiveMarketData() {
    let fetchedQuotes = {};
    let sourceName = "";

    // 1. Try Backend Live Stocks & Crypto API first (Yahoo Finance + Binance)
    try {
      const res = await fetch(this.backendUrl, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.quotes && Object.keys(data.quotes).length > 0) {
          fetchedQuotes = data.quotes;
          sourceName = "Live API (Yahoo Finance + Binance)";
        }
      }
    } catch (e) {
      // Backend not running, proceed to direct client-side APIs
    }

    // 2. Direct Browser Call for Live Crypto (BTC, ETH, SOL) via Binance Public API
    try {
      const cryptoPairs = {
        "BTCUSDT": "BTC-USD",
        "ETHUSDT": "ETH-USD",
        "SOLUSDT": "SOL-USD",
        "BNBUSDT": "BNB-USD",
        "ADAUSDT": "ADA-USD",
        "XRPUSDT": "XRP-USD"
      };

      const bRes = await fetch(this.binanceApiUrl, { signal: AbortSignal.timeout(2500) });
      if (bRes.ok) {
        const bList = await bRes.json();
        bList.forEach(item => {
          const sym = cryptoPairs[item.symbol];
          if (sym) {
            const price = parseFloat(item.lastPrice);
            const prev = parseFloat(item.prevClosePrice);
            const chg = parseFloat(item.priceChange);
            const pct = parseFloat(item.priceChangePercent);

            fetchedQuotes[sym] = {
              symbol: sym,
              price: parseFloat(price.toFixed(2)),
              prevClose: parseFloat(prev.toFixed(2)),
              change: parseFloat(chg.toFixed(2)),
              changePercent: parseFloat(pct.toFixed(2)),
              high: parseFloat(parseFloat(item.highPrice).toFixed(2)),
              low: parseFloat(parseFloat(item.lowPrice).toFixed(2)),
              timestamp: new Date().toISOString(),
              source: "Binance Live Stream"
            };
          }
        });
        if (!sourceName) sourceName = "Binance Crypto Live API";
      }
    } catch (e) {
      // Direct crypto API fallback
    }

    // 3. Process and Apply Live Quotes to the Trading Engine
    if (Object.keys(fetchedQuotes).length > 0) {
      this.lastUpdated = new Date();
      this.connectedSource = sourceName;
      this.applyQuotesToEngine(fetchedQuotes);
      this.updateStatusPill(true, sourceName);
      return true;
    } else {
      this.connectedSource = "Live market data unavailable";
      this.updateStatusPill(false, "Live market data unavailable");
      return false;
    }
  }

  applyQuotesToEngine(quotes) {
    Object.entries(quotes).forEach(([symbol, quote]) => {
      const current = this.tradingEngine.prices[symbol];
      if (current) {
        if (quote.name) {
          current.name = quote.name;
          const asset = MARKET_ASSETS.find(item => item.symbol === symbol);
          if (asset) asset.name = quote.name;
        }
        current.price = quote.price;
        if (Number.isFinite(quote.prevClose)) current.prevClose = quote.prevClose;
        current.change = quote.change;
        current.changePercent = quote.changePercent;
        if (Number.isFinite(quote.high)) current.high = quote.high;
        if (Number.isFinite(quote.low)) current.low = quote.low;
        current.high52 = quote.high52;
        current.low52 = quote.low52;
        current.volume = quote.volume;

        // Check pending limit orders against real market price
        this.tradingEngine.checkPendingOrders(symbol, quote.price);

        // Fire UI update event
        if (this.tradingEngine.onPriceTick) {
          this.tradingEngine.onPriceTick(symbol, current);
        }
      }
    });
  }

  // --- NAVBAR LIVE STATUS PILL ---
  renderStatusPill() {
    const container = document.getElementById("liveApiStatusPill");
    if (!container) return;
    this.updateStatusPill(false, "Connecting to Market API...");
  }

  updateStatusPill(isLive, source) {
    const pill = document.getElementById("liveApiStatusPill");
    if (!pill) return;

    if (isLive) {
      pill.innerHTML = `
        <span class="live-api-dot pulse"></span>
        <span class="live-api-text">LIVE API: <strong>${source}</strong></span>
      `;
      pill.className = "live-api-pill active";
      pill.title = `Real-time quotes connected via ${source}. Last updated: ${this.lastUpdated ? this.lastUpdated.toLocaleTimeString() : 'now'}. Click to refresh.`;
    } else {
      pill.innerHTML = `
        <span class="live-api-dot" style="background: #94a3b8;"></span>
        <span class="live-api-text">${source}</span>
      `;
      pill.className = "live-api-pill";
      pill.title = "Live internet market data is unavailable. Start the Node.js API server or check your internet connection.";
    }

    pill.onclick = () => {
      pill.classList.add("refreshing");
      this.fetchLiveMarketData().then(() => {
        setTimeout(() => pill.classList.remove("refreshing"), 400);
        if (window.showAppToast) window.showAppToast(`Market prices updated from ${this.connectedSource}`, "success");
      });
    };
  }
}

window.LiveMarketAPI = LiveMarketAPI;
