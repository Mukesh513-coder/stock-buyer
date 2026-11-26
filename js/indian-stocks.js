/**
 * Stock Buyer - NSE listed-company directory and market data
 * Features:
 * - Official NSE EQ symbols and company names
 * - Yahoo Finance quotes and historical chart data when available
 * - INR price formatting
 */

// Controller for NSE-listed equities and Yahoo Finance quotes.
class IndianMarketController {
  constructor(tradingEngine, chartEngine) {
    this.tradingEngine = tradingEngine;
    this.chart = chartEngine;
    
    this.currentPage = 1;
    this.pageSize = 20;
    this.searchQuery = "";
    this.activeSector = "all";
    this.activeCap = "all";
    this.companies = [];
    this.filteredList = [];
    this.selectedCompany = null;
    this.totalCompanies = 0;
    this.quoteRequests = new Map();
    this.quoteRefreshTimer = null;

    this.init();
  }

  async init() {
    this.bindEvents();
    this.loadIndianIndices();
    const tbody = document.getElementById("indianStocksTableBody");
    if (tbody) tbody.innerHTML = '<tr><td colspan="8">Loading the official NSE listed-company directory…</td></tr>';
    try {
      const response = await fetch("/api/market/indian-stocks?limit=10000&quotes=false");
      if (!response.ok) throw new Error(`NSE directory request failed (${response.status}).`);
      const data = await response.json();
      if (!data.success || !Array.isArray(data.companies)) throw new Error("NSE returned an invalid listed-company directory.");
      this.totalCompanies = data.total;
      this.companies = data.companies.map(company => ({
        ...company,
        sector: "N/A",
        capType: "N/A",
        marketCap: null,
        pe: null,
        price: null,
        prevClose: null,
        change: null,
        changePercent: null,
        high52: null,
        low52: null
      }));
      this.applyFilters();
      if (this.companies.length) this.selectCompany(this.companies[0].symbol);
      this.quoteRefreshTimer = setInterval(() => {
        if (document.getElementById("view-indian")?.classList.contains("active")) {
          this.refreshVisibleQuotes();
        }
      }, 60000);
    } catch (error) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="8">${this.escapeHtml(`Unable to load listed companies: ${error.message}`)}</td></tr>`;
      const count = document.getElementById("indianTotalCountBadge");
      if (count) count.textContent = "NSE data unavailable";
    }
  }

  async loadIndianIndices() {
    try {
      const response = await fetch("/api/market/indian-indices");
      if (!response.ok) throw new Error(`Indian indices request failed (${response.status}).`);
      const data = await response.json();
      if (!data.success || !Array.isArray(data.indices)) throw new Error("Indian indices feed returned invalid data.");
      data.indices.forEach(index => {
        const priceElement = document.querySelector(`[data-index-symbol="${index.symbol}"]`);
        if (!priceElement) return;
        const changeElement = priceElement.parentElement.querySelector(".indian-index-change");
        if (Number.isFinite(index.price) && Number.isFinite(index.changePercent)) {
          const sign = index.change >= 0 ? "+" : "";
          priceElement.textContent = index.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          if (changeElement) {
            changeElement.textContent = `${sign}${index.change.toFixed(2)} (${sign}${index.changePercent.toFixed(2)}%)`;
            changeElement.classList.toggle("up", index.change >= 0);
            changeElement.classList.toggle("down", index.change < 0);
          }
        } else {
          priceElement.textContent = "N/A";
          if (changeElement) changeElement.textContent = "Quote unavailable";
          priceElement.title = index.error || "Yahoo Finance did not provide a quote.";
        }
      });
    } catch (error) {
      document.querySelectorAll("[data-index-symbol]").forEach(priceElement => {
        priceElement.textContent = "N/A";
        const changeElement = priceElement.parentElement.querySelector(".indian-index-change");
        if (changeElement) changeElement.textContent = "Quote unavailable";
        priceElement.title = error.message;
      });
    }
  }

  refreshVisibleQuotes() {
    const start = (this.currentPage - 1) * this.pageSize;
    this.loadLiveQuotes(this.filteredList.slice(start, start + this.pageSize), true);
  }

  applyFilters() {
    const q = this.searchQuery.toLowerCase().trim();
    this.filteredList = this.companies.filter(company =>
      !q || company.symbol.toLowerCase().includes(q) || company.name.toLowerCase().includes(q)
    );

    this.currentPage = 1;
    this.renderTable();
    this.renderPagination();
    this.updateStatsBar();
  }

  renderTable() {
    const tbody = document.getElementById("indianStocksTableBody");
    if (!tbody) return;

    const start = (this.currentPage - 1) * this.pageSize;
    const pageItems = this.filteredList.slice(start, start + this.pageSize);

    if (pageItems.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 32px;">
            No NSE-listed equities match your search.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = pageItems.map(c => {
      const isUp = Number(c.change) >= 0;
      const sign = isUp ? "+" : "";
      const isSelected = this.selectedCompany && this.selectedCompany.symbol === c.symbol;

      return `
        <tr class="indian-stock-row ${isSelected ? 'active-row' : ''}" data-symbol="${this.escapeHtml(c.symbol)}">
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="indian-flag-icon">🇮🇳</span>
              <div>
                <strong style="color: var(--text-white); font-family: var(--font-mono);">${this.escapeHtml(c.symbol)}</strong>
                <div style="font-size: 10px; color: var(--text-muted);">NSE: ${this.escapeHtml(c.symbol)}</div>
              </div>
            </div>
          </td>
          <td>
            <div style="font-weight: 600; color: var(--text-primary); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${this.escapeHtml(c.name)}
            </div>
          </td>
          <td><span class="badge" title="NSE equity series">${this.escapeHtml(c.series || "N/A")}</span></td>
          <td style="font-family: var(--font-mono); font-weight: 700; color: var(--text-white);">
            ${Number.isFinite(c.price) ? `₹${c.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : c.quoteError ? "Quote unavailable" : "Loading quote…"}
          </td>
          <td style="font-family: var(--font-mono); font-weight: 700; color: ${isUp ? 'var(--bull-green)' : 'var(--bear-red)'};">
            ${Number.isFinite(c.changePercent) ? `${sign}${c.changePercent.toFixed(2)}%` : "N/A"}
          </td>
          <td style="font-family: var(--font-mono); color: var(--text-secondary);" title="${this.escapeHtml(c.quoteUpdatedAt || "")}">
            ${c.quoteUpdatedAt ? this.escapeHtml(new Date(c.quoteUpdatedAt).toLocaleTimeString()) : "N/A"}
          </td>
          <td>
            <button class="btn-primary load-indian-chart-btn" data-symbol="${this.escapeHtml(c.symbol)}" style="padding: 5px 12px; font-size: 11px;">
              Move Chart ↗
            </button>
          </td>
        </tr>
      `;
    }).join("");

    // Bind row clicks
    tbody.querySelectorAll(".load-indian-chart-btn, .indian-stock-row").forEach(el => {
      el.addEventListener("click", (e) => {
        const symbol = el.dataset.symbol;
        if (symbol) this.selectCompany(symbol);
      });
    });
    this.loadLiveQuotes(pageItems);
  }

  escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  async loadLiveQuotes(companies, refresh = false) {
    const symbols = companies.map(company => company.symbol);
    const key = symbols.join(",");
    if (!key || this.quoteRequests.has(key)) return;
    const status = document.getElementById("indianQuoteRefreshStatus");
    if (refresh && status) status.textContent = "Refreshing visible-page quotes from Yahoo Finance…";
    const request = fetch(`/api/market/indian-stocks?symbols=${encodeURIComponent(key)}&limit=20&refresh=${refresh ? "true" : "false"}`)
      .then(response => {
        if (!response.ok) throw new Error(`Live NSE quotes request failed (${response.status}).`);
        return response.json();
      })
      .then(data => {
        if (!data.success || !Array.isArray(data.companies)) throw new Error("Quote feed returned invalid data.");
        data.companies.forEach(quote => {
          const company = this.companies.find(item => item.symbol === quote.symbol);
          if (company) Object.assign(company, quote);
        });
        if (status) {
          const updated = data.companies
            .map(company => Date.parse(company.quoteUpdatedAt))
            .filter(Number.isFinite);
          const latest = updated.length ? new Date(Math.max(...updated)).toLocaleTimeString() : "unavailable";
          status.textContent = `${data.source} · latest available quote ${latest} · refreshes every 60 seconds while this section is open`;
        }
        this.renderTable();
        if (this.selectedCompany && symbols.includes(this.selectedCompany.symbol)) {
          this.updateCompanySummary(this.selectedCompany);
        }
      })
      .catch(error => {
        if (status) status.textContent = `Live quotes unavailable: ${error.message}`;
      })
      .finally(() => this.quoteRequests.delete(key));
    this.quoteRequests.set(key, request);
    await request;
  }

  renderPagination() {
    const container = document.getElementById("indianPaginationControls");
    if (!container) return;

    const totalPages = Math.ceil(this.filteredList.length / this.pageSize) || 1;
    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; font-size: 12px; color: var(--text-secondary); border-top: 1px solid var(--border-subtle);">
        <div>
          Showing <strong>${Math.min((this.currentPage - 1) * this.pageSize + 1, this.filteredList.length)}</strong> to 
          <strong>${Math.min(this.currentPage * this.pageSize, this.filteredList.length)}</strong> of 
          <strong style="color: var(--accent-light);">${this.filteredList.length.toLocaleString()}</strong> NSE listed equity symbols
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <button class="btn-secondary" id="indPageFirst" ${this.currentPage === 1 ? 'disabled style="opacity: 0.4;"' : ''}>« First</button>
          <button class="btn-secondary" id="indPagePrev" ${this.currentPage === 1 ? 'disabled style="opacity: 0.4;"' : ''}>‹ Prev</button>
          <span style="font-family: var(--font-mono); padding: 0 8px; color: var(--text-white);">
            Page ${this.currentPage} of ${totalPages}
          </span>
          <button class="btn-secondary" id="indPageNext" ${this.currentPage === totalPages ? 'disabled style="opacity: 0.4;"' : ''}>Next ›</button>
          <button class="btn-secondary" id="indPageLast" ${this.currentPage === totalPages ? 'disabled style="opacity: 0.4;"' : ''}>Last »</button>
        </div>
      </div>
    `;

    document.getElementById("indPageFirst")?.addEventListener("click", () => { this.currentPage = 1; this.renderTable(); this.renderPagination(); });
    document.getElementById("indPagePrev")?.addEventListener("click", () => { if (this.currentPage > 1) { this.currentPage--; this.renderTable(); this.renderPagination(); } });
    document.getElementById("indPageNext")?.addEventListener("click", () => { if (this.currentPage < totalPages) { this.currentPage++; this.renderTable(); this.renderPagination(); } });
    document.getElementById("indPageLast")?.addEventListener("click", () => { this.currentPage = totalPages; this.renderTable(); this.renderPagination(); });
  }

  updateStatsBar() {
    const elCount = document.getElementById("indianTotalCountBadge");
    if (elCount) elCount.textContent = `${this.filteredList.length.toLocaleString()} of ${this.totalCompanies.toLocaleString()} NSE listed`;
  }

  async selectCompany(symbol) {
    const company = this.companies.find(c => c.symbol === symbol);
    if (!company) return;

    this.selectedCompany = company;

    // Update active highlight in table
    document.querySelectorAll(".indian-stock-row").forEach(r => {
      r.classList.toggle("active-row", r.dataset.symbol === symbol);
    });

    // Update Dedicated Moving Chart Banner
    this.updateCompanySummary(company);
    const dataStatus = document.getElementById("indianDataStatus");
    if (dataStatus) dataStatus.textContent = `Loading Yahoo Finance history for NSE:${company.symbol}…`;
    try {
      const response = await fetch(`/api/market/company?symbol=${encodeURIComponent(`${company.symbol}.NS`)}&range=6mo&interval=1d`);
      if (!response.ok) throw new Error(`Historical data request failed (${response.status}).`);
      const data = await response.json();
      if (!data.success || !Array.isArray(data.company?.candles) || !data.company.candles.length) {
        throw new Error("No historical candles are available for this symbol.");
      }
      if (this.selectedCompany?.symbol !== symbol) return;
      const quote = data.company;
      Object.assign(company, quote, { marketCap: null, pe: null });
      this.updateCompanySummary(company);
      this.chart.setData(quote.candles.map(candle => ({
        ...candle,
        timestamp: candle.time
      })), company.symbol, "1D", "₹");
      if (dataStatus) dataStatus.textContent = `Historical prices via Yahoo Finance · 6 months · as of ${new Date(quote.timestamp).toLocaleString()}`;
    } catch (error) {
      if (this.selectedCompany?.symbol === symbol && dataStatus) {
        dataStatus.textContent = `Historical data unavailable: ${error.message}`;
      }
      return;
    }

    // Smooth scroll to top moving chart if on mobile/small screen
    document.getElementById("indianMovingChartCard")?.scrollIntoView({ behavior: "smooth", block: "start" });

    if (window.showAppToast) {
      window.showAppToast(`Loaded Yahoo Finance history for ${company.name} (NSE: ${company.symbol})`, "success");
    }
  }

  updateCompanySummary(company) {
    const elSym = document.getElementById("indActiveSymbol");
    const elName = document.getElementById("indActiveName");
    const elPrice = document.getElementById("indActivePrice");
    const elChg = document.getElementById("indActiveChange");
    const elCap = document.getElementById("indActiveCap");
    const elPe = document.getElementById("indActivePe");
    const el52Range = document.getElementById("indActive52Range");
    if (elSym) elSym.textContent = company.symbol;
    if (elName) elName.textContent = company.name;
    if (elPrice) elPrice.textContent = Number.isFinite(company.price) ? `₹${company.price.toFixed(2)}` : "N/A";
    if (elCap) elCap.textContent = "Not provided by public quote";
    if (elPe) elPe.textContent = "N/A";
    if (el52Range) {
      el52Range.textContent = Number.isFinite(company.low52) && Number.isFinite(company.high52)
        ? `₹${company.low52.toFixed(2)} - ₹${company.high52.toFixed(2)}`
        : "N/A";
    }
    if (elChg) {
      if (Number.isFinite(company.change) && Number.isFinite(company.changePercent)) {
        const isUp = company.change >= 0;
        const sign = isUp ? "+" : "";
        elChg.textContent = `${sign}₹${company.change.toFixed(2)} (${sign}${company.changePercent.toFixed(2)}%)`;
        elChg.className = `asset-current-change ${isUp ? "up" : "down"}`;
      } else {
        elChg.textContent = "Quote unavailable";
      }
    }
  }

  bindEvents() {
    // Search input
    const searchInput = document.getElementById("indianSearchInput");
    searchInput?.addEventListener("input", (e) => {
      this.searchQuery = e.target.value;
      this.applyFilters();
    });
    document.getElementById("indianRefreshQuotes")?.addEventListener("click", () => this.refreshVisibleQuotes());
  }
}

window.IndianMarketController = IndianMarketController;
