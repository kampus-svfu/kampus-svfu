(() => {
  "use strict";
  const CFG = Object.assign({ SUPABASE_URL: "", SUPABASE_ANON_KEY: "", ALLOWED_EMAIL_DOMAINS: [], LISTING_TTL_DAYS: 60 }, window.KAMPUS_CONFIG || {});

  const DISTRICTS = ["Студгородок (Кулаковского)","Центр","Сайсары","202 мкр","Автодорожный","Губинский","Строительный","Промышленный","Гагаринский","Октябрьский","Марха","Другое"];
  const INSTITUTES = ["Медицинский институт","Институт математики и информатики","Физико-технический институт","Институт естественных наук","Инженерно-технический институт","Горный институт","Геологоразведочный факультет","Автодорожный факультет","Финансово-экономический институт","Юридический факультет","Исторический факультет","Филологический факультет","Институт зарубежной филологии и регионоведения","Институт языков и культуры народов СВ РФ","Педагогический институт","Институт психологии","Институт физкультуры и спорта","Другое"];
  const SCHEDULES = ["Вечером после пар","Выходные","Гибкий","Удалённо","Сменный"];
  const KINDS = {
    room:  { empty: "Пока никто не ищет соседа", hint: "Разместите первое: район, сколько идти до корпуса, бюджет в месяц.", unit: "в месяц", priceLabel: "Ваша часть аренды, ₽/мес" },
    books: { empty: "Учебников и конспектов пока нет", hint: "Выложите то, что уже сдали: предмет, курс и цену.", unit: "", priceLabel: "Цена, ₽ (0 — отдам бесплатно)" },
    job:   { empty: "Вакансий пока нет", hint: "Знаете подработку, которая совмещается с парами? Добавьте её.", unit: "в час", priceLabel: "Оплата, ₽/час" }
  };
  const DETAIL_KEYS = { room: ["district","who","minutes","housing"], books: ["btype","subject","inst","course"], job: ["employer","schedule","hours"] };
  const WHO = { any: null, f: "Ищут соседку", m: "Ищут соседа" };
  const TTL_MS = CFG.LISTING_TTL_DAYS * 864e5;

  /* ---------- хранилище: Supabase или демо ---------- */
  function rowToItem(r) {
    return { id: r.id, kind: r.kind, title: r.title, text: r.body || "", contact: r.contact, price: r.price, author: r.author, createdAt: r.created_at, ...(r.details || {}) };
  }

  function supabaseApi() {
    const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    return {
      demo: false,
      async list() {
        const since = new Date(Date.now() - TTL_MS).toISOString();
        const { data, error } = await sb.from("listings").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(1000);
        if (error) throw error;
        return data.map(rowToItem);
      },
      async create(item) {
        const details = {}; DETAIL_KEYS[item.kind].forEach(k => { if (item[k] !== undefined && item[k] !== "" && item[k] !== null) details[k] = item[k]; });
        const { error } = await sb.from("listings").insert({ kind: item.kind, title: item.title, body: item.text, contact: item.contact, price: item.price, details });
        if (error) throw error;
      },
      async remove(id) { const { error } = await sb.from("listings").delete().eq("id", id); if (error) throw error; },
      async user() { const { data } = await sb.auth.getSession(); const u = data.session && data.session.user; return u ? { id: u.id, email: u.email } : null; },
      onAuth(cb) { sb.auth.onAuthStateChange((_e, s) => cb(s && s.user ? { id: s.user.id, email: s.user.email } : null)); },
      async signIn(email) {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
      },
      async signOut() { await sb.auth.signOut(); }
    };
  }

  function demoApi() {
    const KEY = "kampus.demo.listings", UKEY = "kampus.demo.user";
    const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
    const write = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} };
    let cb = () => {};
    let me = null; try { me = JSON.parse(localStorage.getItem(UKEY)); } catch (e) {}
    return {
      demo: true,
      async list() { return read().filter(i => Date.now() - new Date(i.createdAt) < TTL_MS).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
      async create(item) { write([{ ...item, id: "d" + Date.now().toString(36), author: me && me.id, createdAt: new Date().toISOString() }, ...read()]); },
      async remove(id) { write(read().filter(i => i.id !== id)); },
      async user() { return me; },
      onAuth(fn) { cb = fn; },
      async signIn(email) { me = { id: "demo-" + email, email }; try { localStorage.setItem(UKEY, JSON.stringify(me)); } catch (e) {} cb(me); return "instant"; },
      async signOut() { me = null; try { localStorage.removeItem(UKEY); } catch (e) {} cb(null); }
    };
  }

  const configured = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase;
  const api = configured ? supabaseApi() : demoApi();

  /* ---------- состояние ---------- */
  const $ = id => document.getElementById(id);
  let tab = "room"; try { tab = localStorage.getItem("kampus.tab") || "room"; } catch (e) {}
  if (!KINDS[tab]) tab = "room";
  let formKind = tab, items = [], me = null, ready = false, busy = false, afterLogin = null;

  const fill = (sel, arr, first) => { sel.replaceChildren(); if (first) sel.append(new Option(first[1], first[0])); arr.forEach(v => sel.append(new Option(v, v))); };
  fill($("f-district"), DISTRICTS); fill($("f-inst"), INSTITUTES, ["", "—"]); fill($("f-schedule"), SCHEDULES);

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) { if (k === "class") el.className = v; else el.setAttribute(k, v); }
    for (const k of kids) if (k != null && k !== false) el.append(k.nodeType ? k : String(k));
    return el;
  }
  const fmt = n => Number(n).toLocaleString("ru-RU");
  function plural(n, one, few, many) { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many; }
  function ago(iso) {
    const d = new Date(iso); if (isNaN(d)) return "";
    const days = Math.floor((Date.now() - d) / 864e5);
    if (days <= 0) return "сегодня"; if (days === 1) return "вчера";
    if (days < 7) return days + " " + plural(days, "день", "дня", "дней") + " назад";
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  }
  function showStatus(msg) { const s = $("status"); s.textContent = msg || ""; s.hidden = !msg; }
  function selectText(el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }

  /* ---------- фильтры и лента ---------- */
  function setupFilters() {
    const a = $("flt-a"), b = $("flt-b");
    if (tab === "room") { fill(a, DISTRICTS, ["", "Любой район"]); fill(b, [], ["", "Любой бюджет"]); [10000, 15000, 20000, 30000].forEach(v => b.append(new Option("до " + fmt(v) + " ₽", v))); }
    if (tab === "books") { fill(a, INSTITUTES.filter(x => x !== "Другое"), ["", "Все институты"]); fill(b, ["1","2","3","4","5","6","Магистратура"], ["", "Любой курс"]); }
    if (tab === "job") { fill(a, SCHEDULES, ["", "Любой график"]); fill(b, [], ["", "Любая оплата"]); [200, 300, 500].forEach(v => b.append(new Option("от " + v + " ₽/час", v))); }
  }

  function card(it) {
    const chip = (t, warm) => h("span", { class: warm ? "chip warm" : "chip" }, t);
    const chips = [];
    if (it.kind === "room") {
      if (it.district) chips.push(chip(it.district));
      if (it.minutes != null) chips.push(chip(it.minutes + " мин до корпуса"));
      if (it.housing) chips.push(chip(it.housing));
      if (WHO[it.who]) chips.push(chip(WHO[it.who], true));
    } else if (it.kind === "books") {
      if (it.btype) chips.push(chip(it.btype, true));
      if (it.subject) chips.push(chip(it.subject));
      if (it.inst) chips.push(chip(it.inst));
      if (it.course) chips.push(chip(/\d/.test(it.course) ? it.course + " курс" : it.course));
    } else {
      if (it.employer) chips.push(chip(it.employer));
      if (it.schedule) chips.push(chip(it.schedule, true));
      if (it.hours) chips.push(chip(it.hours + " ч/нед"));
    }
    let price;
    if (it.price === 0) price = h("div", { class: "price" }, it.kind === "books" ? "Даром" : "0 ₽");
    else if (typeof it.price === "number") price = h("div", { class: "price" }, fmt(it.price) + " ₽", KINDS[it.kind].unit ? h("small", null, KINDS[it.kind].unit) : null);
    else price = h("div", { class: "price" }, h("small", null, "договорная"));

    const code = h("code", null, it.contact || "");
    const copy = h("button", { class: "linkbtn", type: "button" }, "Скопировать");
    copy.addEventListener("click", () => {
      const done = () => { copy.textContent = "Скопировано"; setTimeout(() => copy.textContent = "Скопировать", 1500); };
      try { navigator.clipboard.writeText(it.contact).then(done, () => selectText(code)); } catch (e) { selectText(code); }
    });
    const right = h("div", { class: "contact" }, h("span", { class: "when" }, ago(it.createdAt)));
    if (me && it.author === me.id) {
      const del = h("button", { class: "linkbtn danger", type: "button" }, "Снять");
      del.addEventListener("click", async () => {
        if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "Точно снять?"; setTimeout(() => { del.dataset.armed = ""; del.textContent = "Снять"; }, 3000); return; }
        del.disabled = true;
        try { await api.remove(it.id); await refresh(); } catch (e) { del.disabled = false; showStatus("Не удалось снять объявление. Попробуйте ещё раз."); }
      });
      right.append(del);
    }
    return h("article", { class: "card" },
      h("div", { class: "head" }, h("h3", null, it.title), price),
      chips.length ? h("div", { class: "meta" }, ...chips) : null,
      it.text ? h("p", { class: "desc" }, it.text) : null,
      h("div", { class: "foot" }, h("div", { class: "contact" }, code, copy), right));
  }

  function render() {
    document.body.dataset.tab = tab;
    document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", t.dataset.tab === tab ? "true" : "false"));
    for (const k of Object.keys(KINDS)) document.querySelector(`[data-count="${k}"]`).textContent = items.filter(i => i.kind === k).length;
    $("mineWrap").hidden = !me;
    const q = $("q").value.trim().toLowerCase(), a = $("flt-a").value, b = $("flt-b").value, mine = me && $("mine").checked;
    let list = items.filter(i => i.kind === tab);
    if (mine) list = list.filter(i => i.author === me.id);
    if (q) list = list.filter(i => [i.title, i.text, i.subject, i.employer, i.district, i.inst].join(" ").toLowerCase().includes(q));
    if (tab === "room") { if (a) list = list.filter(i => i.district === a); if (b) list = list.filter(i => typeof i.price === "number" && i.price <= +b); }
    if (tab === "books") { if (a) list = list.filter(i => i.inst === a); if (b) list = list.filter(i => i.course === b); }
    if (tab === "job") { if (a) list = list.filter(i => i.schedule === a); if (b) list = list.filter(i => typeof i.price === "number" && i.price >= +b); }

    const feed = $("feed"); feed.replaceChildren();
    if (!ready) { feed.append(h("div", { class: "empty" }, h("strong", null, "Загружаем объявления…"))); return; }
    if (!list.length) {
      const any = items.some(i => i.kind === tab);
      const box = h("div", { class: "empty" },
        h("strong", null, any ? "Ничего не нашлось" : KINDS[tab].empty),
        h("span", null, any ? "Попробуйте убрать фильтры или изменить запрос." : KINDS[tab].hint));
      if (!any) { const b2 = h("button", { class: "btn small", type: "button" }, "Разместить объявление"); b2.addEventListener("click", () => openForm(tab)); box.append(b2); }
      feed.append(box); return;
    }
    list.forEach(i => feed.append(card(i)));
  }

  async function refresh() {
    try { items = await api.list(); showStatus(""); }
    catch (e) { showStatus("Не удалось загрузить объявления. Проверьте интернет и обновите страницу."); }
    ready = true; render();
  }

  /* ---------- вход ---------- */
  function renderAccount() {
    $("who").textContent = me ? me.email : "";
    $("logout").hidden = !me;
  }
  function openLogin(then) {
    afterLogin = then || null;
    $("loginErr").hidden = true;
    const doms = CFG.ALLOWED_EMAIL_DOMAINS || [];
    const which = doms.length ? "студенческую почту " + doms.map(d => "@" + d).join(" или ") : "почту";
    $("loginHint").textContent = api.demo ? "Демо-режим: введите любую почту, вход произойдёт сразу." : "Укажите " + which + " — пришлём ссылку для входа. Пароль не нужен.";
    $("formPanel").hidden = true; $("loginPanel").hidden = false; $("email").focus();
  }
  async function doLogin() {
    const email = $("email").value.trim().toLowerCase(), err = $("loginErr");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = "Проверьте адрес почты."; err.hidden = false; return; }
    const doms = CFG.ALLOWED_EMAIL_DOMAINS || [];
    if (doms.length && !doms.some(d => email.endsWith("@" + d))) { err.textContent = "Войти можно только с почтой " + doms.map(d => "@" + d).join(", ") + "."; err.hidden = false; return; }
    const btn = $("loginBtn"); btn.disabled = true; btn.textContent = "Отправляем…";
    try {
      const r = await api.signIn(email);
      if (r !== "instant") { err.hidden = true; $("loginHint").textContent = "Ссылка отправлена на " + email + ". Откройте письмо на этом устройстве. Если письма нет, проверьте «Спам»."; }
    } catch (e) {
      err.textContent = /rate/i.test(e.message || "") ? "Слишком много попыток. Подождите минуту и попробуйте снова." : "Не удалось отправить письмо. Попробуйте ещё раз.";
      err.hidden = false;
    } finally { btn.disabled = false; btn.textContent = "Получить ссылку"; }
  }

  /* ---------- форма ---------- */
  function syncFormKind() {
    document.querySelectorAll("#kindPick button").forEach(b => b.setAttribute("aria-pressed", b.dataset.kind === formKind ? "true" : "false"));
    document.querySelectorAll("[data-k]").forEach(el => el.hidden = el.dataset.k !== formKind);
    $("priceLabel").textContent = KINDS[formKind].priceLabel;
  }
  function openForm(kind) {
    formKind = kind || tab;
    if (!me) return openLogin(() => openForm(formKind));
    syncFormKind(); $("formErr").hidden = true; $("loginPanel").hidden = true; $("formPanel").hidden = false; $("f-title").focus();
  }
  function closeForm() { $("formPanel").hidden = true; $("form").reset(); }

  async function submit() {
    if (busy) return;
    const err = $("formErr"), val = id => $(id).value.trim();
    const title = val("f-title"), contact = val("f-contact");
    const problems = [];
    if (title.length < 5) problems.push("напишите заголовок (от 5 символов)");
    if (contact.length < 3) problems.push("укажите контакт — Telegram, VK или телефон");
    if (formKind === "books" && !val("f-subject")) problems.push("укажите предмет");
    if (problems.length) { err.textContent = "Чтобы опубликовать: " + problems.join("; ") + "."; err.hidden = false; return; }
    const num = id => { const v = $(id).value; return v === "" ? null : Math.max(0, Math.round(+v)); };
    const item = { kind: formKind, title, text: val("f-text"), contact, price: num("f-price") };
    if (formKind === "room") Object.assign(item, { district: val("f-district"), who: val("f-who"), minutes: num("f-minutes"), housing: val("f-housing") });
    if (formKind === "books") Object.assign(item, { btype: val("f-btype"), subject: val("f-subject"), inst: val("f-inst"), course: val("f-course") });
    if (formKind === "job") Object.assign(item, { employer: val("f-employer"), schedule: val("f-schedule"), hours: num("f-hours") });
    busy = true; $("submit").disabled = true; $("submit").textContent = "Публикуем…";
    try {
      await api.create(item);
      closeForm(); tab = formKind; try { localStorage.setItem("kampus.tab", tab); } catch (e) {}
      setupFilters(); await refresh();
    } catch (e) {
      const m = (e && e.message) || "";
      err.textContent = /Слишком много/.test(m) ? "Лимит — 10 объявлений в сутки. Попробуйте завтра." :
        /row-level security|JWT|auth/i.test(m) ? "Сессия устарела. Выйдите и войдите снова." :
        "Не получилось опубликовать. Проверьте соединение и нажмите ещё раз.";
      err.hidden = false;
    } finally { busy = false; $("submit").disabled = false; $("submit").textContent = "Опубликовать"; }
  }

  /* ---------- события ---------- */
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
    tab = t.dataset.tab; try { localStorage.setItem("kampus.tab", tab); } catch (e) {}
    setupFilters(); render();
  }));
  document.querySelectorAll("#kindPick button").forEach(b => b.addEventListener("click", () => { formKind = b.dataset.kind; syncFormKind(); }));
  ["q", "flt-a", "flt-b", "mine"].forEach(id => $(id).addEventListener("input", render));
  $("openForm").addEventListener("click", () => openForm(tab));
  $("cancel").addEventListener("click", closeForm);
  $("submit").addEventListener("click", submit);
  $("form").addEventListener("submit", e => { e.preventDefault(); submit(); });
  $("loginForm").addEventListener("submit", e => { e.preventDefault(); doLogin(); });
  $("loginCancel").addEventListener("click", () => { $("loginPanel").hidden = true; afterLogin = null; });
  $("logout").addEventListener("click", () => api.signOut());

  api.onAuth(u => {
    me = u; renderAccount(); render();
    if (u) { $("loginPanel").hidden = true; if (afterLogin) { const f = afterLogin; afterLogin = null; f(); } }
  });

  $("demoNote").hidden = !api.demo;
  setupFilters(); syncFormKind(); render();
  (async () => {
    me = await api.user(); renderAccount();
    await refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  })();
})();
