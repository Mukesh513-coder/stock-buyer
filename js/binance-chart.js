/**
 * Lightweight Charts view for the live Binance kline feed.
 */
class BinanceTradingChart {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container || !window.LightweightCharts) {
      throw new Error("The live chart container or Lightweight Charts library is unavailable.");
    }

    this.symbol = "BTCUSDT";
    this.interval = "1m";
    this.chartType = "candle";
    this.showSma = true;
    this.candles = [];
    this.chart = LightweightCharts.createChart(this.container, {
      attributionLogo: true,
      autoSize: false,
      layout: {
        background: { color: "#081325" },
        textColor: "#93c5fd"
      },
      grid: {
        vertLines: { color: "#132742" },
        horzLines: { color: "#132742" }
      },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1d3554" },
      timeScale: { borderColor: "#1d3554", timeVisible: true, secondsVisible: false },
      localization: { locale: navigator.language || "en-US" }
    });

    this.candlestickSeries = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: "#00c087",
      downColor: "#f6465d",
      borderUpColor: "#00c087",
      borderDownColor: "#f6465d",
      wickUpColor: "#00c087",
      wickDownColor: "#f6465d"
    });
    this.lineSeries = this.chart.addSeries(LightweightCharts.LineSeries, {
      color: "#38bdf8",
      lineWidth: 2,
      visible: false,
      priceLineVisible: false
    });
    this.volumeSeries = this.chart.addSeries(LightweightCharts.HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false
    });
    this.chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 }
    });
    this.sma20Series = this.createSmaSeries("#fbbf24");
    this.sma50Series = this.createSmaSeries("#38bdf8");

    this.feed = new BinanceKlineFeed({
      onCandles: candles => this.setCandles(candles),
      onCandle: candle => this.updateCandle(candle),
      onStatus: status => this.setStatus(status)
    });

    this.resizeObserver = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) this.chart.resize(width, height);
    });
    this.resizeObserver.observe(this.container);
    this.feed.subscribe(this.symbol, this.interval);
  }

  createSmaSeries(color) {
    return this.chart.addSeries(LightweightCharts.LineSeries, {
      color,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      visible: this.showSma
    });
  }

  setCandles(candles) {
    this.candles = candles;
    this.candlestickSeries.setData(candles);
    this.lineSeries.setData(candles.map(({ time, close }) => ({ time, value: close })));
    this.volumeSeries.setData(candles.map(candle => ({
      time: candle.time,
      value: candle.volume,
      color: candle.close >= candle.open ? "rgba(0, 192, 135, 0.45)" : "rgba(246, 70, 93, 0.45)"
    })));
    this.updateSma();
    this.chart.timeScale().fitContent();
  }

  updateCandle(candle) {
    if (!this.candles.length || candle.time > this.candles[this.candles.length - 1].time) {
      this.candles.push(candle);
    } else {
      this.candles[this.candles.length - 1] = candle;
    }
    this.candlestickSeries.update(candle);
    this.lineSeries.update({ time: candle.time, value: candle.close });
    this.volumeSeries.update({
      time: candle.time,
      value: candle.volume,
      color: candle.close >= candle.open ? "rgba(0, 192, 135, 0.45)" : "rgba(246, 70, 93, 0.45)"
    });
    this.updateSma();
  }

  updateSma() {
    const movingAverage = period => this.candles
      .map((candle, index, candles) => {
        if (index < period - 1) return null;
        const sum = candles.slice(index - period + 1, index + 1)
          .reduce((total, item) => total + item.close, 0);
        return { time: candle.time, value: sum / period };
      })
      .filter(Boolean);

    this.sma20Series.setData(movingAverage(20));
    this.sma50Series.setData(movingAverage(50));
  }

  setSymbolInterval(symbol, interval) {
    if (symbol === this.symbol && interval === this.interval) return;
    this.symbol = symbol;
    this.interval = interval;
    this.feed.subscribe(symbol, interval);
  }

  setChartType(type) {
    this.chartType = type;
    const isCandlestick = type === "candle";
    this.candlestickSeries.applyOptions({ visible: isCandlestick });
    this.lineSeries.applyOptions({ visible: !isCandlestick });
  }

  toggleSma() {
    this.showSma = !this.showSma;
    this.sma20Series.applyOptions({ visible: this.showSma });
    this.sma50Series.applyOptions({ visible: this.showSma });
    return this.showSma;
  }

  setStatus({ state, message }) {
    const status = document.getElementById("chartFeedStatus");
    const error = document.getElementById("chartFeedError");
    if (status) {
      status.textContent = message;
      status.dataset.state = state;
      status.hidden = state === "error";
    }
    if (error) {
      error.textContent = state === "error" ? message : "";
      error.hidden = state !== "error";
    }
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.feed.destroy();
    this.chart.remove();
  }
}

window.BinanceTradingChart = BinanceTradingChart;
