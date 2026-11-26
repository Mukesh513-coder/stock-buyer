/**
 * Loads Binance candle history and maintains one reconnecting kline stream.
 */
class BinanceKlineFeed {
  constructor({ onCandles, onCandle, onStatus }) {
    this.onCandles = onCandles;
    this.onCandle = onCandle;
    this.onStatus = onStatus;
    this.generation = 0;
    this.abortController = null;
    this.socket = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
  }

  subscribe(symbol, interval) {
    const generation = ++this.generation;
    this.stopConnection();
    this.reconnectAttempts = 0;
    this.abortController = new AbortController();
    this.onCandles([]);
    this.onStatus({ state: "loading", message: `Loading ${symbol} ${interval} candles…` });
    this.loadHistory(symbol, interval, generation);
  }

  async loadHistory(symbol, interval, generation) {
    const url = new URL("https://api.binance.com/api/v3/klines");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", "500");

    try {
      const response = await fetch(url, { signal: this.abortController.signal });
      if (!response.ok) {
        throw new Error(`Binance historical data request failed (${response.status} ${response.statusText}).`);
      }

      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error("Binance returned an invalid candle response.");
      }
      if (generation !== this.generation) return;

      const candles = payload.map(kline => this.parseKline(kline));
      if (candles.length === 0) {
        throw new Error(`Binance returned no historical candles for ${symbol} (${interval}).`);
      }
      this.onCandles(candles);
      this.onStatus({ state: "connecting", message: `History loaded · Connecting to ${symbol} live stream…` });
      this.connect(symbol, interval, generation);
    } catch (error) {
      if (error.name === "AbortError" || generation !== this.generation) return;
      this.onStatus({ state: "error", message: error.message || "Unable to load Binance candle data." });
    }
  }

  connect(symbol, interval, generation) {
    if (generation !== this.generation) return;
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;

    try {
      const socket = new WebSocket(`wss://stream.binance.com:9443/ws/${stream}`);
      this.socket = socket;
      socket.onopen = () => {
        if (generation !== this.generation) return;
        this.reconnectAttempts = 0;
        this.onStatus({ state: "live", message: `Live · ${symbol} · ${interval}` });
      };
      socket.onmessage = event => {
        if (generation !== this.generation) return;
        try {
          const message = JSON.parse(event.data);
          if (message.e === "kline" && message.k) {
            this.onCandle(this.parseKline(message.k));
          }
        } catch (error) {
          this.onStatus({ state: "error", message: "Received invalid data from Binance's live stream." });
        }
      };
      socket.onerror = () => {
        if (generation === this.generation) {
          this.onStatus({ state: "reconnecting", message: "Live stream interrupted · Reconnecting…" });
          socket.close();
        }
      };
      socket.onclose = () => {
        if (generation !== this.generation) return;
        this.scheduleReconnect(symbol, interval, generation);
      };
    } catch (error) {
      this.scheduleReconnect(symbol, interval, generation);
    }
  }

  scheduleReconnect(symbol, interval, generation) {
    if (generation !== this.generation || this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(1000 * (2 ** (this.reconnectAttempts - 1)), 30000);
    this.onStatus({ state: "reconnecting", message: `Live stream disconnected · Retrying in ${Math.ceil(delay / 1000)}s…` });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(symbol, interval, generation);
    }, delay);
  }

  parseKline(kline) {
    return {
      time: Math.floor(Number(kline[0] ?? kline.t) / 1000),
      open: Number(kline[1] ?? kline.o),
      high: Number(kline[2] ?? kline.h),
      low: Number(kline[3] ?? kline.l),
      close: Number(kline[4] ?? kline.c),
      volume: Number(kline[5] ?? kline.v)
    };
  }

  stopConnection() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
  }

  destroy() {
    this.generation += 1;
    this.stopConnection();
  }
}

window.BinanceKlineFeed = BinanceKlineFeed;
