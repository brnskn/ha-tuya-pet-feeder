/* Tuya pet feeder card: feed now, next meal, today's feedings and the meal plan. */
const PF_VERSION = "1.1.0";

const PF_STRINGS = {
  en: {
    title: "Pet feeder",
    loading: "Loading…",
    not_found: "No Tuya pet feeder found",
    offline: "Offline",
    feeding: "Feeding",
    ready: "Ready",
    next_meal: "Next meal",
    no_plan: "No plan",
    portions: "portions",
    portion: "portion",
    portions_short: "portions",
    today_portions: "portions today",
    feed: "Feed now",
    feeding_btn: "Feeding…",
    decrease: "Decrease",
    increase: "Increase",
    today: "Today",
    given: "fed",
    manual: "manual",
    plan: "plan",
    plan_title: "Meal plan",
    edit: "Edit",
    custom_days: "some days",
    on: "On",
    off: "Off",
    no_meals: "No meals planned",
    last7: "Last 7 days",
    add_meal: "+ Add meal",
    cancel: "Cancel",
    save: "Save",
    close: "Close",
    delete: "Delete",
    empty_editor: 'No meals yet. Use "Add meal" to start.',
    feeding_toast: "Feeding {n} portions",
    feeding_toast_one: "Feeding 1 portion",
    saved: "Meal plan saved",
    failed: "Failed: {e}",
    now: "now",
    in_h: "in {h} h",
    in_hm: "in {h} h {m} min",
    in_m: "in {m} min",
    f_pet_food_jam: "Food is jammed",
    f_pet_food_shortages: "Food is running low",
    f_pet_food_run_out: "Out of food",
    f_desiccant_exhausted: "Desiccant needs replacing",
    f_battery_low: "Backup battery is low",
    f_device_stuck: "The feeder is stuck",
    missed: "The {time} meal ({p}) was not dispensed",
    battery_empty: "Backup battery is empty. Meals won't be dispensed during a power cut.",
    battery_low: "Backup battery is low ({n}%). Meals won't be dispensed during a power cut.",
    battery: "Backup battery",
  },
  tr: {
    title: "Mama kabı",
    loading: "Yükleniyor…",
    not_found: "Tuya'da mama kabı bulunamadı",
    offline: "Çevrimdışı",
    feeding: "Mama veriliyor",
    ready: "Hazır",
    next_meal: "Sonraki öğün",
    no_plan: "Plan yok",
    portions: "porsiyon",
    portion: "porsiyon",
    portions_short: "porsiyon",
    today_portions: "bugünkü porsiyon",
    feed: "Mama ver",
    feeding_btn: "Veriliyor…",
    decrease: "Azalt",
    increase: "Artır",
    today: "Bugün",
    given: "verildi",
    manual: "elle",
    plan: "plan",
    plan_title: "Öğün planı",
    edit: "Düzenle",
    custom_days: "özel günler",
    on: "Açık",
    off: "Kapalı",
    no_meals: "Planlı öğün yok",
    last7: "Son 7 gün",
    add_meal: "+ Öğün ekle",
    cancel: "Vazgeç",
    save: "Kaydet",
    close: "Kapat",
    delete: "Sil",
    empty_editor: 'Öğün yok. "Öğün ekle" ile başla.',
    feeding_toast: "{n} porsiyon mama veriliyor",
    saved: "Öğün planı kaydedildi",
    failed: "Olmadı: {e}",
    now: "şimdi",
    in_h: "{h} sa sonra",
    in_hm: "{h} sa {m} dk sonra",
    in_m: "{m} dk sonra",
    f_pet_food_jam: "Mama sıkıştı",
    f_pet_food_shortages: "Mama azaldı",
    f_pet_food_run_out: "Mama bitti",
    f_desiccant_exhausted: "Kurutucu (nem alıcı) bitti",
    f_battery_low: "Yedek pil zayıf",
    f_device_stuck: "Mama kabı takıldı",
    missed: "{time} öğünü verilmedi ({p})",
    battery_empty: "Yedek pil bitmiş. Elektrik kesilirse öğünler verilmez.",
    battery_low: "Yedek pil zayıf (%{n}). Elektrik kesilirse öğünler verilmez.",
    battery: "Yedek pil",
  },
};

const pfEsc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pfSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const pfMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

class TuyaPetFeederCard extends HTMLElement {
  static getStubConfig() {
    return { type: "custom:tuya-pet-feeder-card" };
  }

  setConfig(config) {
    this._config = { ...config };
    this._portions = this._portions || 1;
    if (this._root) this._render();
  }

  getCardSize() {
    return this._config?.compact ? 4 : 7;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._root) this._setup();
    const e = this._feeder?.entities || {};
    const prob = hass.states[e.problem];
    const sig = [...["feed_state", "feed_report", "battery", "manual_feed"].map((k) => hass.states[e[k]]?.state), JSON.stringify(prob?.attributes?.problems || []), prob?.attributes?.missed_meal?.at || ""].join("|");
    if (sig !== this._sig) {
      const feedChanged = this._sig && this._sig.split("|")[0] !== sig.split("|")[0];
      this._sig = sig;
      if (feedChanged) this._loadHistory();
      this._render();
    }
  }

  connectedCallback() {
    if (!this._tick) this._tick = setInterval(() => this._render(), 60000);
  }

  disconnectedCallback() {
    clearInterval(this._tick);
    this._tick = null;
  }

  // ------------------------------------------------------------ i18n
  get _lang() {
    const l = (this._config?.language || this._hass?.locale?.language || this._hass?.language || "en").slice(0, 2);
    return PF_STRINGS[l] ? l : "en";
  }

  _p(n) {
    return `${n ?? "?"} ${this._t(n === 1 ? "portion" : "portions")}`;
  }

  _t(key, vars = {}) {
    let s = PF_STRINGS[this._lang][key] ?? PF_STRINGS.en[key] ?? key;
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  }

  _hm(d) {
    return d.toLocaleTimeString(this._lang, { hour: "2-digit", minute: "2-digit" });
  }

  _in(minutes) {
    if (minutes < 1) return this._t("now");
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (!h) return this._t("in_m", { m });
    return m ? this._t("in_hm", { h, m }) : this._t("in_h", { h });
  }

  // ------------------------------------------------------------ data
  _setup() {
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${PF_CSS}</style><ha-card><div id="root"></div></ha-card><dialog id="dlg"></dialog>`;
    this._root = this.shadowRoot.getElementById("root");
    this._dlg = this.shadowRoot.getElementById("dlg");
    this._root.addEventListener("click", (e) => this._onClick(e));
    this._dlg.addEventListener("click", (e) => (e.target === this._dlg ? this._dlg.close() : this._onClick(e)));
    this._feedings = [];
    this._root.innerHTML = `<div class="muted pad"><ha-icon icon="mdi:bowl-mix"></ha-icon> ${this._t("loading")}</div>`;
    this._loadFeeder();
    this._planTimer = setInterval(() => this._loadFeeder(), 10 * 60000);
  }

  async _loadFeeder() {
    try {
      const list = await this._hass.callWS({ type: "tuya_feeder/list" });
      this._feeder = (this._config.device_id && list.find((f) => f.id === this._config.device_id)) || list[0] || null;
      this._error = this._feeder ? null : this._t("not_found");
    } catch (err) {
      this._error = err.message || String(err);
    }
    if (this._feeder && !this._historyLoaded) {
      this._historyLoaded = true;
      this._loadHistory();
    }
    this._sig = null;
    this._render();
  }

  async _loadHistory() {
    const e = this._feeder?.entities || {};
    if (!e.feed_state) return;
    const start = new Date();
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    try {
      const ids = [e.feed_state, e.feed_report].filter(Boolean);
      const res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true,
      });
      const reports = (res[e.feed_report] || []).map((p) => ({ t: (p.lu ?? p.lc) * 1000, v: parseFloat(p.s) })).filter((p) => isFinite(p.v));
      const feeds = [];
      let prev = null;
      for (const p of res[e.feed_state] || []) {
        if (p.s === "on" && prev !== "on") {
          const t = (p.lu ?? p.lc) * 1000;
          const rep = [...reports].reverse().find((r) => r.t <= t + 90000);
          feeds.push({ t: new Date(t), portions: rep ? rep.v : null });
        }
        prev = p.s;
      }
      this._feedings = feeds;
    } catch (_) {
      this._feedings = [];
    }
    this._render();
  }

  _st(key) {
    const id = this._feeder?.entities?.[key];
    return id ? this._hass.states[id] : undefined;
  }

  _plannedToday() {
    return (this._feeder?.plan || []).filter((m) => m.enabled).sort((a, b) => pfMin(a.time) - pfMin(b.time));
  }

  _nextMeal() {
    const meals = this._plannedToday();
    if (!meals.length) return null;
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const next = meals.find((m) => pfMin(m.time) > cur) || meals[0];
    let diff = pfMin(next.time) - cur;
    if (diff <= 0) diff += 1440;
    return { ...next, in: diff };
  }

  // ------------------------------------------------------------ render
  _render() {
    if (!this._root || !this._hass) return;
    if (this._error && !this._feeder) {
      this._root.innerHTML = `<div class="muted pad"><ha-icon icon="mdi:alert-circle-outline"></ha-icon> ${pfEsc(this._error)}</div>`;
      return;
    }
    if (!this._feeder) return;
    const parts = [this._renderHead(), this._renderAlerts(), this._renderHero(), this._renderFeedNow()];
    if (!this._config.compact) parts.push(this._renderTimeline(), this._renderPlan(), this._renderWeek());
    this._root.innerHTML = parts.join("");
  }

  _renderHead() {
    const feeding = this._st("feed_state")?.state === "on";
    const online = this._feeder.online && this._st("feed_state")?.state !== "unavailable";
    const st = !online
      ? { t: this._t("offline"), i: "mdi:wifi-off", c: "bad" }
      : feeding
        ? { t: this._t("feeding"), i: "mdi:bowl-mix", c: "busy" }
        : { t: this._t("ready"), i: "mdi:check-circle-outline", c: "ok" };
    const bat = parseFloat(this._st("battery")?.state);
    const battery =
      isFinite(bat)
        ? `<span class="bat ${bat <= 20 ? "low" : ""}" title="${this._t("battery")}"><ha-icon icon="mdi:battery${bat >= 95 ? "" : bat < 5 ? "-outline" : `-${Math.max(10, Math.round(bat / 10) * 10)}`}"></ha-icon>${Math.round(bat)}%</span>`
        : "";
    const title = this._config.title || this._feeder.name || this._t("title");
    return `<div class="head">
      <div class="title"><ha-icon icon="mdi:bowl-mix"></ha-icon><span>${pfEsc(title)}</span></div>
      <div class="head-r">${battery}<div class="status ${st.c}"><ha-icon icon="${st.i}"></ha-icon><span>${st.t}</span></div></div>
    </div>`;
  }

  _renderAlerts() {
    const attrs = this._st("problem")?.attributes || {};
    const faults = attrs.faults || this._feeder.faults || [];
    const missed = attrs.missed_meal !== undefined ? attrs.missed_meal : this._feeder.missed;
    const out = faults.map((f) => ({ c: "bad", i: f === "desiccant_exhausted" ? "mdi:water-off" : f === "battery_low" ? "mdi:battery-alert" : "mdi:alert-circle", t: this._t(`f_${f}`) }));
    if (missed) out.push({ c: "bad", i: "mdi:food-off", t: this._t("missed", { time: missed.time, p: this._p(missed.portions) }) });
    const bat = parseFloat(this._st("battery")?.state);
    if (isFinite(bat) && bat <= 20 && !faults.includes("battery_low"))
      out.push({ c: "warn", i: bat < 5 ? "mdi:battery-off-outline" : "mdi:battery-low", t: bat < 5 ? this._t("battery_empty") : this._t("battery_low", { n: Math.round(bat) }) });
    if (!out.length) return "";
    return `<div class="alerts">${out.map((a) => `<div class="alert ${a.c}"><ha-icon icon="${a.i}"></ha-icon><span>${pfEsc(a.t)}</span></div>`).join("")}</div>`;
  }

  _renderHero() {
    const next = this._nextMeal();
    const now = new Date();
    const today = this._feedings.filter((f) => pfSameDay(f.t, now));
    const portions = today.reduce((a, f) => a + (f.portions || 0), 0);
    const planned = this._plannedToday().reduce((a, m) => a + m.portions, 0);
    return `<div class="hero">
      <div class="hero-main">
        <div class="muted">${this._t("next_meal")}</div>
        ${next ? `<div class="big">${next.time}</div><div class="muted">${this._p(next.portions)} · ${this._in(next.in)}</div>` : `<div class="big small">${this._t("no_plan")}</div>`}
      </div>
      <div class="hero-side">
        <div class="ring" style="--p:${planned ? Math.min(100, (portions / planned) * 100) : 0}">
          <div><b>${portions}</b><span>/${planned || "–"}</span></div>
        </div>
        <div class="muted center">${this._t("today_portions")}</div>
      </div>
    </div>`;
  }

  _renderFeedNow() {
    const busy = this._st("feed_state")?.state === "on";
    const disabled = busy || !this._feeder.entities?.manual_feed;
    return `<div class="feed">
      <div class="stepper">
        <button class="icon" data-action="minus" ${this._portions <= 1 ? "disabled" : ""} aria-label="${this._t("decrease")}"><ha-icon icon="mdi:minus"></ha-icon></button>
        <div class="val"><b>${this._portions}</b><span>${this._t(this._portions === 1 ? "portion" : "portions_short")}</span></div>
        <button class="icon" data-action="plus" ${this._portions >= 20 ? "disabled" : ""} aria-label="${this._t("increase")}"><ha-icon icon="mdi:plus"></ha-icon></button>
      </div>
      <button class="primary" data-action="feed" ${disabled ? "disabled" : ""}><ha-icon icon="mdi:food-drumstick"></ha-icon>${busy ? this._t("feeding_btn") : this._t("feed")}</button>
    </div>`;
  }

  _renderTimeline() {
    const now = new Date();
    const pct = (d) => (((d.getHours ? d.getHours() * 60 + d.getMinutes() : d) / 1440) * 100).toFixed(2);
    const planned = this._plannedToday()
      .map((m) => `<span class="plan-mark" style="left:${pct(pfMin(m.time))}%" title="${this._t("plan")} ${m.time} · ${this._p(m.portions)}"></span>`)
      .join("");
    const plannedMin = new Set(this._plannedToday().map((m) => pfMin(m.time)));
    const dots = this._feedings
      .filter((f) => pfSameDay(f.t, now))
      .map((f) => {
        const manual = !plannedMin.has(f.t.getHours() * 60 + f.t.getMinutes());
        return `<span class="dot ${manual ? "manual" : ""}" style="left:${pct(f.t)}%" title="${this._hm(f.t)} · ${this._p(f.portions)}${manual ? ` (${this._t("manual")})` : ""}"></span>`;
      })
      .join("");
    return `<div class="section">
      <div class="sec-title"><span>${this._t("today")}</span><span class="legend"><i class="lg-dot"></i>${this._t("given")} <i class="lg-dot manual"></i>${this._t("manual")} <i class="lg-plan"></i>${this._t("plan")}</span></div>
      <div class="tl"><div class="tl-track"></div><div class="tl-now" style="left:${pct(now)}%"></div>${planned}${dots}
        <div class="tl-ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>
    </div>`;
  }

  _renderPlan() {
    const plan = [...(this._feeder.plan || [])].sort((a, b) => pfMin(a.time) - pfMin(b.time));
    const rows = plan
      .map(
        (m) => `<div class="meal ${m.enabled ? "" : "off"}"><ha-icon icon="mdi:clock-outline"></ha-icon><b>${m.time}</b><span class="muted">${this._p(m.portions)}${m.days === 127 ? "" : ` · ${this._t("custom_days")}`}</span><span class="grow"></span><span class="pill ${m.enabled ? "on" : ""}">${m.enabled ? this._t("on") : this._t("off")}</span></div>`
      )
      .join("");
    return `<div class="section">
      <div class="sec-title"><span>${this._t("plan_title")}</span><button class="link" data-action="edit-plan">${this._t("edit")}</button></div>
      <div class="meals">${rows || `<div class="muted pad">${this._t("no_meals")}</div>`}</div>
    </div>`;
  }

  _renderWeek() {
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const fs = this._feedings.filter((f) => pfSameDay(f.t, d));
      days.push({ d, n: fs.reduce((a, f) => a + (f.portions || 0), 0) });
    }
    const max = Math.max(6, ...days.map((x) => x.n));
    const W = 480, H = 84, B = 18, bw = W / 7;
    const bars = days
      .map((x, i) => {
        const h = ((H - B - 14) * x.n) / max;
        const lbl = x.d.toLocaleDateString(this._lang, { weekday: "short" });
        return `<rect x="${(i * bw + 10).toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${(bw - 20).toFixed(1)}" height="${Math.max(h, 1.5).toFixed(1)}" rx="5" class="${x.n ? "bar" : "bar zero"}"/>
          ${x.n ? `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${(H - B - h - 3).toFixed(1)}" text-anchor="middle">${x.n}</text>` : ""}
          <text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="${i === 6 ? "strong" : ""}">${lbl}</text>`;
      })
      .join("");
    return `<div class="section"><div class="sec-title"><span>${this._t("last7")}</span><span class="muted">${this._t("portions")}</span></div>
      <svg class="chart" viewBox="0 0 ${W} ${H}">${bars}</svg></div>`;
  }

  // ------------------------------------------------------------ plan editor
  _openEditor() {
    this._draft = [...(this._feeder.plan || [])].map((m) => ({ ...m })).sort((a, b) => pfMin(a.time) - pfMin(b.time));
    this._dlg.innerHTML = `<div class="dlg">
      <div class="dlg-head"><div class="dlg-title">${this._t("plan_title")}</div><button class="icon" data-action="close" aria-label="${this._t("close")}"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div id="rows"></div>
      <div class="dlg-foot"><button class="ghost" data-action="add-meal">${this._t("add_meal")}</button>
        <div class="gap"><button class="ghost" data-action="close">${this._t("cancel")}</button><button class="primary sm" data-action="save-plan">${this._t("save")}</button></div></div>
    </div>`;
    this._renderRows();
    if (!this._dlg.open) this._dlg.showModal();
  }

  _renderRows() {
    const box = this._dlg.querySelector("#rows");
    box.innerHTML = this._draft.length
      ? this._draft
          .map(
            (m, i) => `<div class="erow">
            <input type="time" class="e-time" data-i="${i}" value="${pfEsc(m.time)}">
            <div class="mini-step"><button class="icon sm" data-action="e-minus" data-i="${i}" aria-label="${this._t("decrease")}"><ha-icon icon="mdi:minus"></ha-icon></button><b>${m.portions}</b><button class="icon sm" data-action="e-plus" data-i="${i}" aria-label="${this._t("increase")}"><ha-icon icon="mdi:plus"></ha-icon></button></div>
            <span class="grow"></span>
            <label class="sw"><input type="checkbox" class="e-on" data-i="${i}" ${m.enabled ? "checked" : ""}><span></span></label>
            <button class="icon sm" data-action="e-del" data-i="${i}" aria-label="${this._t("delete")}"><ha-icon icon="mdi:delete-outline"></ha-icon></button>
          </div>`
          )
          .join("")
      : `<div class="muted pad">${this._t("empty_editor")}</div>`;
  }

  _readRows() {
    this._dlg.querySelectorAll(".e-time").forEach((el) => (this._draft[+el.dataset.i].time = el.value || "00:00"));
    this._dlg.querySelectorAll(".e-on").forEach((el) => (this._draft[+el.dataset.i].enabled = el.checked));
  }

  // ------------------------------------------------------------ actions
  async _onClick(ev) {
    const el = ev.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const i = el.dataset.i != null ? +el.dataset.i : null;
    switch (el.dataset.action) {
      case "minus":
        this._portions = Math.max(1, this._portions - 1);
        return this._render();
      case "plus":
        this._portions = Math.min(20, this._portions + 1);
        return this._render();
      case "feed":
        await this._hass.callService("number", "set_value", { entity_id: this._feeder.entities.manual_feed, value: this._portions });
        return this._toast(this._t(this._portions === 1 ? "feeding_toast_one" : "feeding_toast", { n: this._portions }));
      case "edit-plan":
        return this._openEditor();
      case "close":
        return this._dlg.close();
      case "add-meal":
        this._readRows();
        this._draft.push({ time: "12:00", portions: 2, enabled: true, days: 127 });
        return this._renderRows();
      case "e-del":
        this._readRows();
        this._draft.splice(i, 1);
        return this._renderRows();
      case "e-minus":
      case "e-plus":
        this._readRows();
        this._draft[i].portions = Math.min(20, Math.max(1, this._draft[i].portions + (el.dataset.action === "e-plus" ? 1 : -1)));
        return this._renderRows();
      case "save-plan": {
        this._readRows();
        el.disabled = true;
        try {
          const res = await this._hass.callWS({ type: "tuya_feeder/set_plan", device_id: this._feeder.id, plan: this._draft });
          this._feeder.plan = res.plan;
          this._dlg.close();
          this._toast(this._t("saved"));
          this._render();
        } catch (err) {
          el.disabled = false;
          this._toast(this._t("failed", { e: err.message || err }), true);
        }
        return;
      }
    }
  }

  _toast(text, bad = false) {
    let t = this._toastEl;
    if (!t) {
      t = this._toastEl = document.createElement("div");
      t.className = "toast";
    }
    const host = this._dlg?.open ? this._dlg : this.shadowRoot;
    if (t.parentNode !== host) host.appendChild(t);
    t.textContent = text;
    t.classList.toggle("bad", bad);
    t.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }
}

const PF_CSS = `
:host { --pf-r: 16px; --pf-soft: color-mix(in srgb, var(--primary-text-color) 6%, transparent); --pf-line: var(--divider-color, rgba(127,127,127,.2)); --mk: #e9a23b; --mk2: #4ea8de; }
ha-card { padding: 16px; overflow: hidden; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
button:disabled { opacity: .4; cursor: default; }
.muted { color: var(--secondary-text-color); font-size: .84em; }
.center { text-align: center; } .pad { padding: 8px 2px; display: flex; gap: 8px; align-items: center; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.title { display: flex; align-items: center; gap: 10px; font-size: 1.15em; font-weight: 600; min-width: 0; }
.title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.title ha-icon { color: var(--mk); flex: none; }
.head-r { display: flex; align-items: center; gap: 8px; }
.status { display: flex; align-items: center; gap: 6px; padding: 6px 12px 6px 8px; border-radius: 999px; font-size: .88em; font-weight: 500; white-space: nowrap; }
.status ha-icon { --mdc-icon-size: 18px; }
.status.ok { color: #2e9e6a; background: color-mix(in srgb, #2e9e6a 14%, transparent); }
.status.busy { color: #d08a1f; background: color-mix(in srgb, #e9a23b 18%, transparent); animation: pfpulse 1.4s ease-in-out infinite; }
.status.bad { color: #e5484d; background: color-mix(in srgb, #e5484d 14%, transparent); }
@keyframes pfpulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, #e9a23b 12%, transparent); } }
.alerts { display: grid; gap: 6px; margin: 0 0 12px; }
.alert { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 12px; font-size: .86em; line-height: 1.3; color: #e5484d; background: color-mix(in srgb, #e5484d 12%, transparent); }
.alert.warn { color: #c47d12; background: color-mix(in srgb, #e9a23b 15%, transparent); }
.alert ha-icon { --mdc-icon-size: 18px; flex: none; }
.bat { display: inline-flex; align-items: center; gap: 2px; font-size: .8em; color: var(--secondary-text-color); } .bat ha-icon { --mdc-icon-size: 16px; } .bat.low { color: #e5484d; }
.hero { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-radius: var(--pf-r); background: linear-gradient(135deg, color-mix(in srgb, var(--mk) 18%, transparent), var(--pf-soft)); }
.hero-main .big { font-size: 2.1em; font-weight: 700; line-height: 1.1; margin: 2px 0; }
.hero-main .big.small { font-size: 1.3em; }
.hero-side { display: grid; justify-items: center; gap: 4px; }
.ring { --p: 0; width: 74px; height: 74px; border-radius: 50%; display: grid; place-items: center; background: conic-gradient(var(--mk) calc(var(--p) * 1%), var(--pf-line) 0); }
.ring > div { width: 58px; height: 58px; border-radius: 50%; display: grid; place-items: center; align-content: center; background: var(--card-background-color, #fff); }
.ring b { font-size: 1.25em; line-height: 1; } .ring span { font-size: .72em; color: var(--secondary-text-color); }
.feed { display: flex; gap: 10px; margin-top: 12px; align-items: stretch; }
.stepper { display: flex; align-items: center; gap: 6px; padding: 6px; border-radius: 14px; background: var(--pf-soft); }
.stepper .val { display: grid; justify-items: center; min-width: 58px; } .stepper .val b { font-size: 1.3em; line-height: 1.1; } .stepper .val span { font-size: .72em; color: var(--secondary-text-color); }
.icon { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: var(--card-background-color, rgba(255,255,255,.06)); }
.icon ha-icon { --mdc-icon-size: 20px; }
.icon.sm { width: 30px; height: 30px; } .icon.sm ha-icon { --mdc-icon-size: 16px; }
.primary { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; border-radius: 14px; background: var(--mk); color: #2b1d05; font-weight: 700; font-size: 1em; }
.primary ha-icon { --mdc-icon-size: 20px; }
.primary.sm { flex: none; padding: 9px 16px; border-radius: 999px; font-size: .9em; }
.ghost { padding: 9px 14px; border-radius: 999px; background: var(--pf-soft); font-weight: 500; font-size: .9em; }
.link { color: var(--primary-color); font-weight: 600; font-size: .88em; }
.section { margin-top: 16px; }
.sec-title { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; font-weight: 500; }
.legend { font-size: .72em; color: var(--secondary-text-color); display: inline-flex; align-items: center; gap: 4px; }
.lg-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--mk); margin-left: 6px; } .lg-dot.manual { background: var(--mk2); }
.lg-plan { display: inline-block; width: 8px; height: 8px; border-radius: 50%; border: 2px solid var(--secondary-text-color); margin-left: 6px; }
.tl { position: relative; height: 46px; }
.tl-track { position: absolute; left: 0; right: 0; top: 14px; height: 8px; border-radius: 8px; background: var(--pf-soft); }
.tl-now { position: absolute; top: 9px; width: 2px; height: 18px; margin-left: -1px; border-radius: 2px; background: var(--primary-color); opacity: .6; }
.plan-mark { position: absolute; top: 11px; width: 10px; height: 10px; margin-left: -7px; border-radius: 50%; border: 2px solid var(--secondary-text-color); background: var(--card-background-color, #fff); }
.dot { position: absolute; top: 10px; width: 16px; height: 16px; margin-left: -8px; border-radius: 50%; background: var(--mk); border: 2px solid var(--card-background-color, #fff); box-shadow: 0 1px 3px rgba(0,0,0,.25); box-sizing: border-box; }
.dot.manual { background: var(--mk2); }
.tl-ticks { position: absolute; left: 0; right: 0; top: 28px; display: flex; justify-content: space-between; font-size: .7em; color: var(--secondary-text-color); }
.meals { display: grid; gap: 6px; }
.meal { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 12px; background: var(--pf-soft); }
.meal ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
.meal.off { opacity: .55; }
.grow { flex: 1; }
.pill { font-size: .72em; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--pf-line); color: var(--secondary-text-color); }
.pill.on { background: color-mix(in srgb, #2e9e6a 16%, transparent); color: #2e9e6a; }
.chart { width: 100%; height: auto; display: block; }
.chart text { font-size: 11px; fill: var(--secondary-text-color); } .chart text.strong { fill: var(--primary-text-color); font-weight: 600; }
.chart .bar { fill: var(--mk); } .chart .bar.zero { fill: var(--pf-line); }
dialog { border: 0; padding: 0; border-radius: 22px; width: min(480px, calc(100vw - 24px)); max-height: min(88vh, 900px); background: var(--card-background-color, #fff); color: var(--primary-text-color); box-shadow: 0 20px 60px rgba(0,0,0,.35); }
dialog::backdrop { background: rgba(0,0,0,.45); backdrop-filter: blur(2px); }
.dlg { padding: 16px 18px 18px; max-height: min(88vh, 900px); overflow-y: auto; box-sizing: border-box; }
.dlg-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.dlg-title { flex: 1; font-size: 1.15em; font-weight: 600; }
.dlg-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.gap { display: flex; gap: 8px; }
.erow { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--pf-line); }
.erow input[type=time] { font: inherit; padding: 7px 9px; border-radius: 10px; border: 1px solid var(--pf-line); background: var(--pf-soft); color: var(--primary-text-color); }
.mini-step { display: flex; align-items: center; gap: 8px; } .mini-step b { min-width: 20px; text-align: center; }
.sw { position: relative; display: inline-block; width: 44px; height: 26px; flex: none; }
.sw input { opacity: 0; width: 0; height: 0; position: absolute; }
.sw span { position: absolute; inset: 0; border-radius: 26px; background: var(--pf-line); transition: background .15s; cursor: pointer; }
.sw span::before { content: ""; position: absolute; width: 20px; height: 20px; left: 3px; top: 3px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: transform .15s; }
.sw input:checked + span { background: var(--mk); }
.sw input:checked + span::before { transform: translateX(18px); }
.toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 20px); opacity: 0; pointer-events: none; padding: 10px 16px; border-radius: 999px; background: #2b2b2b; color: #fff; font-size: .9em; transition: all .2s; z-index: 10; }
.toast.show { opacity: 1; transform: translate(-50%, 0); } .toast.bad { background: #b3261e; }
`;

if (!customElements.get("tuya-pet-feeder-card")) {
  customElements.define("tuya-pet-feeder-card", TuyaPetFeederCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "tuya-pet-feeder-card",
    name: "Tuya pet feeder",
    description: "Feed now, next meal, today's feedings and the meal plan of a Tuya pet feeder",
  });
  console.info(`%c TUYA-PET-FEEDER-CARD %c ${PF_VERSION} `, "background:#e9a23b;color:#000;border-radius:3px 0 0 3px", "background:#333;color:#fff;border-radius:0 3px 3px 0");
}
