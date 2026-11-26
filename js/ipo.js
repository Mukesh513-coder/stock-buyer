/**
 * Stock Buyer - IPO-related news and local paper application history
 */

const IPO_DATABASE = [];

class IpoManager {
  constructor(tradingEngine) {
    this.tradingEngine = tradingEngine;
    this.storageKey = "sb_applied_ipos";
    this.activeFilter = "all";
    this.appliedIpos = this.loadAppliedIpos();
    this.selectedIpo = null;
    this.ipoNews = [];
    this.ipoNewsLoaded = false;

    this.init();
  }

  init() {
    this.renderIpoList();
    this.bindEvents();
    this.loadIpoNews();
  }

  loadAppliedIpos() {
    const saved = localStorage.getItem(this.storageKey);
    if (saved) {
      try { return JSON.parse(saved); } catch(e){}
    }
    return [];
  }

  saveAppliedIpos() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.appliedIpos));
  }

  renderIpoList() {
    const container = document.getElementById("ipoGridContainer");
    if (!container) return;

    container.replaceChildren();
    if (!this.ipoNewsLoaded) {
      container.textContent = "Loading current IPO-related headlines…";
    } else if (!this.ipoNews.length) {
      container.textContent = "No IPO-related headlines are currently available.";
    } else {
      this.ipoNews.forEach(item => {
        const link = new URL(item.link);
        if (link.protocol !== "https:") throw new Error("The news feed returned a non-secure article link.");
        const card = document.createElement("article");
        card.className = "ipo-card";
        const title = document.createElement("a");
        title.href = link.href;
        title.target = "_blank";
        title.rel = "noopener noreferrer";
        title.textContent = item.title;
        title.style.cssText = "font-size: 16px; font-weight: 800; color: var(--text-white); line-height: 1.4;";
        const meta = document.createElement("p");
        meta.style.cssText = "font-size: 11px; color: var(--accent-light); margin: 8px 0;";
        const published = new Date(item.publishedAt);
        meta.textContent = `${item.source} · ${Number.isNaN(published.getTime()) ? "Date unavailable" : published.toLocaleString()}`;
        const summary = document.createElement("p");
        summary.style.cssText = "font-size: 12px; color: var(--text-secondary); line-height: 1.5;";
        summary.textContent = item.summary || "Open the source for details.";
        card.append(title, meta, summary);
        container.append(card);
      });
    }
    this.renderAppliedIposTable();
  }

  async loadIpoNews() {
    const container = document.getElementById("ipoGridContainer");
    try {
      const response = await fetch("/api/market/ipo-news");
      if (!response.ok) throw new Error(`IPO news request failed (${response.status}).`);
      const data = await response.json();
      if (!data.success || !Array.isArray(data.items)) throw new Error("IPO news feed returned invalid data.");
      this.ipoNews = data.items;
      this.ipoNewsLoaded = true;
      this.renderIpoList();
      const note = document.getElementById("ipoDataSourceNote");
      if (note) note.textContent = "Yahoo Finance RSS · IPO-related headlines only. No official live issue calendar or subscription figures are available.";
    } catch (error) {
      if (container) container.textContent = `Live IPO news is unavailable: ${error.message}`;
      const note = document.getElementById("ipoDataSourceNote");
      if (note) note.textContent = "Yahoo Finance RSS could not be reached. No issue calendar or offering data is shown.";
    }
  }

  renderAppliedIposTable() {
    const tbody = document.getElementById("myAppliedIposTableBody");
    if (!tbody) return;

    if (this.appliedIpos.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">
            No paper IPO applications recorded in this browser.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = this.appliedIpos.map(app => {
      const dt = new Date(app.timestamp).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
      const statusColor = app.status.includes("Allotted") ? "var(--bull-green)" : (app.status.includes("Confirmed") ? "var(--accent-light)" : "var(--text-white)");

      return `
        <tr>
          <td style="font-family: var(--font-mono); color: var(--text-muted);">${app.id}</td>
          <td><strong>${app.companyName}</strong></td>
          <td>${app.lots} Lot (${app.shares} Shares)</td>
          <td style="font-family: var(--font-mono);">₹${app.bidPrice.toFixed(2)}</td>
          <td style="font-family: var(--font-mono); font-weight: 700; color: var(--text-white);">₹${app.totalAmount.toLocaleString()}</td>
          <td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary);">${app.upiId}</td>
          <td style="font-weight: 700; color: ${statusColor};">
            ● ${app.status}
          </td>
        </tr>
      `;
    }).join("");
  }

  openBuyModal(ipoId) {
    const ipo = IPO_DATABASE.find(i => i.id === ipoId);
    if (!ipo) return;

    this.selectedIpo = ipo;
    const overlay = document.getElementById("buyIpoModalOverlay");
    if (!overlay) return;

    document.getElementById("modalIpoTitle").innerHTML = `${ipo.logo} Buy IPO: ${ipo.name}`;
    document.getElementById("modalIpoPriceBand").textContent = ipo.priceBand;
    document.getElementById("modalIpoLotSize").textContent = `${ipo.lotSize} Shares / Lot`;
    document.getElementById("modalIpoIssueSize").textContent = ipo.issueSize;
    document.getElementById("modalIpoCutoffPrice").value = ipo.cutoffPrice;

    const lotInput = document.getElementById("modalIpoLotsInput");
    lotInput.value = 1;
    this.recalculateModalTotal();

    overlay.classList.add("active");
  }

  closeBuyModal() {
    document.getElementById("buyIpoModalOverlay")?.classList.remove("active");
  }

  recalculateModalTotal() {
    if (!this.selectedIpo) return;
    const lots = parseInt(document.getElementById("modalIpoLotsInput").value) || 1;
    const isCutoff = document.getElementById("modalIpoCutoffCheck").checked;
    const price = isCutoff ? this.selectedIpo.cutoffPrice : (parseFloat(document.getElementById("modalIpoCustomPriceInput").value) || this.selectedIpo.cutoffPrice);

    const totalShares = lots * this.selectedIpo.lotSize;
    const totalAmount = totalShares * price;

    document.getElementById("modalIpoTotalShares").textContent = `${totalShares} Shares`;
    document.getElementById("modalIpoTotalAmount").textContent = `₹${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }

  submitBid() {
    if (!this.selectedIpo) {
      if (window.showAppToast) window.showAppToast("No verified current IPO issue data is available for bidding.", "error");
      return;
    }
    const lots = parseInt(document.getElementById("modalIpoLotsInput").value) || 1;
    const upiId = document.getElementById("modalIpoUpiInput").value.trim() || "trader@okhdfcbank";
    const isCutoff = document.getElementById("modalIpoCutoffCheck").checked;
    const price = isCutoff ? this.selectedIpo.cutoffPrice : (parseFloat(document.getElementById("modalIpoCustomPriceInput").value) || this.selectedIpo.cutoffPrice);

    const totalShares = lots * this.selectedIpo.lotSize;
    const totalAmount = totalShares * price;

    // Check funds in paper wallet (converted roughly or simulated INR)
    const appId = `IPO-${Math.floor(1000 + Math.random() * 9000)}`;

    const application = {
      id: appId,
      ipoId: this.selectedIpo.id,
      companyName: this.selectedIpo.name,
      lots: lots,
      shares: totalShares,
      bidPrice: price,
      totalAmount: totalAmount,
      upiId: upiId,
      timestamp: Date.now(),
      status: "Bidding Confirmed (Allotment Pending)",
      statusType: "pending"
    };

    this.appliedIpos.unshift(application);
    this.saveAppliedIpos();

    this.closeBuyModal();
    this.renderIpoList();

    if (window.showAppToast) {
      window.showAppToast(`IPO Application #${appId} submitted successfully for ${this.selectedIpo.name}! Total Blocked: ₹${totalAmount.toLocaleString()}`, "success");
    }

    // Play chime sound
    if (this.tradingEngine && this.tradingEngine.playSuccessTone) {
      this.tradingEngine.playSuccessTone();
    }
  }

  bindEvents() {
    document.querySelectorAll(".ipo-filter-btn:not([data-filter='all'])").forEach(btn => {
      btn.disabled = true;
      btn.title = "Only current IPO-related news is available; no verified live issue calendar is connected.";
    });

    // Modal Lot Input & Cut-off price toggle
    const lotInput = document.getElementById("modalIpoLotsInput");
    lotInput?.addEventListener("input", () => this.recalculateModalTotal());

    document.getElementById("modalIpoCutoffCheck")?.addEventListener("change", (e) => {
      const customPriceGroup = document.getElementById("modalIpoCustomPriceGroup");
      if (customPriceGroup) customPriceGroup.style.display = e.target.checked ? "none" : "flex";
      this.recalculateModalTotal();
    });

    document.getElementById("modalIpoCustomPriceInput")?.addEventListener("input", () => this.recalculateModalTotal());

    // Submit Bid Button
    document.getElementById("btnConfirmIpoBid")?.addEventListener("click", () => this.submitBid());

    // Modal Close
    document.getElementById("buyIpoModalClose")?.addEventListener("click", () => this.closeBuyModal());
    document.getElementById("buyIpoModalOverlay")?.addEventListener("click", (e) => {
      if (e.target.id === "buyIpoModalOverlay") this.closeBuyModal();
    });
  }
}

window.IpoManager = IpoManager;
window.IPO_DATABASE = IPO_DATABASE;
