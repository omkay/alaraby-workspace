/* مساحة عمل العربي — shared launch workspace (tasks, costs, updates) on Supabase. */
(function () {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const app = document.getElementById("app");
  if (!window.supabase || !cfg.supabaseUrl) {
    app.innerHTML = '<div class="boot">تعذّر تحميل التطبيق. تحقق من الاتصال بالإنترنت ثم أعد تحميل الصفحة.</div>';
    return;
  }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "alaraby-workspace-auth" }
  });

  // ---------------------------------------------------------------- constants
  const STATUS = [
    { key: "todo", label: "لم تبدأ" },
    { key: "doing", label: "قيد التنفيذ" },
    { key: "blocked", label: "متوقفة" },
    { key: "done", label: "منجزة" }
  ];
  const KINDS = [
    { key: "update", label: "تحديث", cls: "c-accent" },
    { key: "idea", label: "فكرة", cls: "c-idea" },
    { key: "note", label: "ملاحظة", cls: "c-todo" }
  ];
  const CATEGORIES = ["الإيجار والعقود", "أعمال التأسيس والإكساء", "الأبواب والسيكوريت والكونتوارات", "التكييف والكهرباء والطاقة",
    "المعدات والبرادات", "الأثاث", "الديكور والهوية البصرية", "المواد الأولية والمستهلكات", "الرواتب والأجور",
    "التسويق والافتتاح", "التراخيص والرسوم", "أخرى"];
  const METHODS = ["نقداً", "حوالة", "شيك", "أخرى"];
  const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';

  // ---------------------------------------------------------------- state
  const S = {
    members: [], me: null, session: null, loaded: false,
    settings: { deposit: 40000, currency: "$", contingency: 0.1 },
    stages: [], items: [], payments: [], tasks: [], posts: [], comments: [], confirmCommentDel: null,
    loginPick: null, loginErr: "", loggingIn: false,
    // tasks
    sel: null, filter: "open", openTask: null, confirmDel: null, editStage: false,
    // costs
    costTab: "items", stageFilter: "", q: "", openItem: null, addingItem: false, confirmItemDel: null, confirmPayDel: null, editSettings: false,
    // updates
    kind: "update", feedFilter: "all", confirmPostDel: null
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem("alaraby." + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("alaraby." + k, v); } catch (e) {} }
  };
  S.loginPick = store.get("who", null);
  S.sel = store.get("sel", null);
  S.filter = store.get("filter", "open");

  // ---------------------------------------------------------------- helpers
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtD = new Intl.DateTimeFormat("ar-SY-u-nu-latn", { day: "numeric", month: "long", timeZone: "UTC" });
  const fmtDY = new Intl.DateTimeFormat("ar-SY-u-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const toDate = (s) => { if (!s) return null; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
  const todayUTC = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };
  const todayStr = () => todayUTC().toISOString().slice(0, 10);
  const dayDiff = (a, b) => Math.round((a - b) / 86400000);
  const fd = (s, y) => { const d = toDate(s); return d ? (y ? fmtDY : fmtD).format(d) : "—"; };
  const cur = () => (typeof S.settings.currency === "string" ? S.settings.currency : "$");
  const money = (n) => (n == null || n === "" ? "—" : '<bdi dir="ltr">' + esc(cur()) + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }) + "</bdi>");
  const num = (v) => { if (v === "" || v == null) return null; const n = Number(String(v).replace(/,/g, "")); return isFinite(n) ? n : NaN; };
  const ago = (iso) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "الآن";
    if (s < 3600) return "قبل " + Math.round(s / 60) + " دقيقة";
    if (s < 86400) return "قبل " + Math.round(s / 3600) + " ساعة";
    if (s < 86400 * 7) return "قبل " + Math.round(s / 86400) + " يوم";
    return fd(iso.slice(0, 10), true);
  };
  const member = (id) => S.members.find((m) => m.id === id) || null;
  const nameOf = (id) => (member(id) || {}).name || "";
  const initial = (name) => ((name || "").replace(/^(أبو|ابو|أم|ام)\s+/, "").trim()[0] || "؟");
  const ini = (id, sm) => { const n = nameOf(id); return n ? '<span class="ini' + (sm ? " sm" : "") + '" aria-hidden="true">' + esc(initial(n)) + "</span>" : ""; };
  const stageName = (id) => (S.stages.find((s) => s.id === id) || {}).name || "";
  const statusOf = (t) => t.status || "todo";
  const statusLabel = (k) => (STATUS.find((s) => s.key === k) || STATUS[0]).label;

  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2800);
  }

  // ---------------------------------------------------------------- money math (mirrors the old sheet)
  function paidMap() {
    const m = new Map();
    S.payments.forEach((p) => { if (p.item_id != null) m.set(p.item_id, (m.get(p.item_id) || 0) + Number(p.amount || 0)); });
    return m;
  }
  function itemCalc(it, pm) {
    const paid = (pm || paidMap()).get(it.id) || 0;
    const est = it.estimate == null ? null : Number(it.estimate);
    let status, cls;
    if (est == null) { status = paid > 0 ? "دفعة · بحاجة لتقدير" : "بحاجة لتقدير"; cls = "c-over"; }
    else if (paid > est) { status = "تجاوز التقدير"; cls = "c-over"; }
    else if (paid === est && est > 0) { status = "مدفوع بالكامل"; cls = "c-done"; }
    else if (paid > 0) { status = "مدفوع جزئياً"; cls = "c-doing"; }
    else { status = "غير مدفوع"; cls = "c-todo"; }
    return { paid, est, remaining: est == null ? null : Math.max(est - paid, 0), status, cls };
  }
  function totals() {
    const pm = paidMap();
    let est = 0, remaining = 0, missing = 0;
    S.items.forEach((it) => { const c = itemCalc(it, pm); if (c.est != null) { est += c.est; remaining += c.remaining; } else missing++; });
    const paid = S.payments.reduce((a, p) => a + Number(p.amount || 0), 0);
    const deposit = Number(S.settings.deposit || 0), pct = Number(S.settings.contingency || 0);
    const reserve = remaining * pct, required = remaining + reserve, balance = deposit - paid;
    return { est, paid, remaining, reserve, required, balance, surplus: balance - required, missing, deposit, pct };
  }
  function groupTotals(field, key) {
    const pm = paidMap(); let est = 0, paid = 0, remaining = 0, count = 0, missing = 0;
    S.items.filter((it) => (it[field] || "") === key).forEach((it) => {
      const c = itemCalc(it, pm); count++; paid += c.paid;
      if (c.est != null) { est += c.est; remaining += c.remaining; } else missing++;
    });
    return { est, paid, remaining, count, missing };
  }

  // ---------------------------------------------------------------- data
  const TABLES = { settings: "key", stages: "sort", cost_items: "id", payments: "created_at", tasks: "sort", posts: "created_at", task_comments: "created_at" };
  async function loadTable(name) {
    const { data, error } = await sb.from(name).select("*").order(TABLES[name], { ascending: name !== "posts" && name !== "payments" });
    if (error) throw error;
    if (name === "settings") data.forEach((r) => { S.settings[r.key] = r.value; });
    else if (name === "cost_items") S.items = data;
    else if (name === "task_comments") S.comments = data;
    else S[name] = data;
  }
  async function loadAll() { await Promise.all(Object.keys(TABLES).map(loadTable)); S.loaded = true; }
  let channel = null;
  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel("workspace")
      .on("postgres_changes", { event: "*", schema: "public" }, (p) => { if (TABLES[p.table]) refresh(p.table); })
      .subscribe();
  }
  const pending = new Set(); let refreshTimer = null;
  function refresh(table) {
    pending.add(table); clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      const list = [...pending]; pending.clear();
      try { await Promise.all(list.map(loadTable)); } catch (e) { /* keep showing what we have */ }
      render();
    }, 200);
  }
  const stamp = () => ({ updated_by: S.me ? S.me.id : null, updated_at: new Date().toISOString() });
  async function run(table, promise, okMsg) {
    const { error } = await promise;
    if (error) {
      console.error(error);
      toast(/JWT|auth|permission|policy/i.test(error.message || "") ? "انتهت الجلسة أو لا تملك صلاحية. سجّل الدخول من جديد." : "لم يُحفظ التغيير: " + (error.message || "خطأ غير معروف"));
      return false;
    }
    if (okMsg) toast(okMsg);
    refresh(table);
    return true;
  }

  // ---------------------------------------------------------------- form state kept across live re-renders
  let dropPrefix = null;
  function captureForm() {
    const keep = {}; let focus = null;
    app.querySelectorAll("[data-k]").forEach((el) => {
      keep[el.dataset.k] = el.type === "checkbox" ? el.checked : el.value;
      if (el === document.activeElement) focus = { k: el.dataset.k, s: el.selectionStart, e: el.selectionEnd };
    });
    return { keep, focus };
  }
  function restoreForm(st) {
    app.querySelectorAll("[data-k]").forEach((el) => {
      const k = el.dataset.k;
      if (dropPrefix && k.startsWith(dropPrefix)) return;
      if (k in st.keep) { if (el.type === "checkbox") el.checked = st.keep[k]; else el.value = st.keep[k]; }
    });
    if (st.focus && !(dropPrefix && st.focus.k.startsWith(dropPrefix))) {
      const el = app.querySelector('[data-k="' + CSS.escape(st.focus.k) + '"]');
      if (el) { el.focus(); try { if (st.focus.s != null) el.setSelectionRange(st.focus.s, st.focus.e); } catch (e) {} }
    }
    dropPrefix = null;
  }

  // ---------------------------------------------------------------- routing
  const route = () => { const h = (location.hash || "").replace("#", ""); return ["tasks", "costs", "updates"].includes(h) ? h : "tasks"; };
  window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });

  // ---------------------------------------------------------------- render: login
  function renderLogin() {
    const list = S.members.map((m) =>
      '<button type="button" class="who" data-act="pick" data-id="' + esc(m.id) + '" aria-pressed="' + (S.loginPick === m.id) + '">' +
      '<span class="ini">' + esc(initial(m.name)) + "</span>" + esc(m.name) + "</button>").join("");
    app.innerHTML =
      '<div class="login gutter"><form class="login-card" id="loginForm" autocomplete="on">' +
      '<div class="brand"><b>العربي</b><span>مساحة عمل الافتتاح · درعا</span></div>' +
      '<div class="field"><span>من أنت؟</span><div class="who-list">' + (list || '<span class="muted">جارٍ تحميل أسماء الفريق…</span>') + "</div></div>" +
      '<label class="field"><span>كلمة المرور</span><input id="pw" type="password" autocomplete="current-password" required></label>' +
      '<div class="err" id="loginErr">' + esc(S.loginErr) + "</div>" +
      '<button class="btn block" type="submit"' + (S.loggingIn ? " disabled" : "") + ">" + (S.loggingIn ? "جارٍ الدخول…" : "دخول") + "</button>" +
      "</form></div>";
  }

  // ---------------------------------------------------------------- render: shell
  function render() {
    if (!S.session || !S.me) { renderLogin(); return; }
    const st = captureForm();
    const r = route();
    let view;
    if (!S.loaded) view = '<div class="boot">جارٍ تحميل بيانات الفريق…</div>';
    else view = r === "costs" ? viewCosts() : r === "updates" ? viewUpdates() : viewTasks();
    app.innerHTML =
      '<header class="topbar"><div class="wrap gutter topbar-in">' +
      '<div class="logo">العربي<small>مساحة عمل الافتتاح · درعا</small></div>' +
      '<nav class="tabs-main" aria-label="الأقسام">' +
      '<a href="#tasks"' + (r === "tasks" ? ' aria-current="page"' : "") + ">المهام</a>" +
      '<a href="#costs"' + (r === "costs" ? ' aria-current="page"' : "") + ">التكاليف</a>" +
      '<a href="#updates"' + (r === "updates" ? ' aria-current="page"' : "") + ">التحديثات</a></nav>" +
      '<div class="me">' + ini(S.me.id, true) + esc(S.me.name) + ' <button type="button" class="linkbtn" data-act="logout">خروج</button></div>' +
      "</div></header>" +
      '<main class="page wrap gutter">' + view + "</main>";
    restoreForm(st);
  }

  // ---------------------------------------------------------------- view: tasks
  const sortedStages = () => S.stages.slice().sort((a, b) => a.sort - b.sort);
  const tasksOf = (sid) => S.tasks.filter((t) => t.stage_id === sid).sort((a, b) => a.sort - b.sort || a.id - b.id);
  const isOverdue = (t) => statusOf(t) !== "done" && toDate(t.due_date) && dayDiff(todayUTC(), toDate(t.due_date)) > 0;
  function stageStatus(st) {
    const ts = tasksOf(st.id), done = ts.filter((t) => statusOf(t) === "done").length;
    if (ts.length && done === ts.length) return { key: "done", label: "منجزة" };
    const end = toDate(st.end_date);
    if (end && dayDiff(todayUTC(), end) > 0) return { key: "late", label: "متأخرة" };
    if (done > 0 || ts.some((t) => statusOf(t) === "doing")) return { key: "doing", label: "قيد التنفيذ" };
    const start = toDate(st.start_date);
    if (start && dayDiff(todayUTC(), start) >= 0) return { key: "doing", label: "قيد التنفيذ" };
    return { key: "todo", label: "لم تبدأ" };
  }
  function launchDate() {
    const ends = S.stages.map((s) => toDate(s.end_date)).filter(Boolean);
    return ends.length ? new Date(Math.max.apply(null, ends) + 86400000) : null;
  }
  function memberOptions(selected, emptyLabel) {
    return '<option value="">' + esc(emptyLabel || "— بدون مسؤول —") + "</option>" +
      S.members.map((m) => '<option value="' + esc(m.id) + '"' + (m.id === selected ? " selected" : "") + ">" + esc(m.name) + (m.id === S.me.id ? " (أنت)" : "") + "</option>").join("");
  }
  function stageOptions(selected, emptyLabel) {
    return '<option value="">' + esc(emptyLabel) + "</option>" +
      sortedStages().map((s) => '<option value="' + esc(s.id) + '"' + (s.id === selected ? " selected" : "") + ">" + esc(s.name) + "</option>").join("");
  }
  function itemOptions(selected) {
    const groups = sortedStages().map((s) => {
      const its = S.items.filter((i) => i.stage_id === s.id);
      return its.length ? '<optgroup label="' + esc(s.name) + '">' + its.map((i) => '<option value="' + i.id + '"' + (i.id === selected ? " selected" : "") + ">" + esc(i.name) + "</option>").join("") + "</optgroup>" : "";
    }).join("");
    const loose = S.items.filter((i) => !i.stage_id);
    return '<option value="">— غير مرتبطة ببند تكلفة —</option>' + groups +
      (loose.length ? '<optgroup label="بدون مرحلة">' + loose.map((i) => '<option value="' + i.id + '"' + (i.id === selected ? " selected" : "") + ">" + esc(i.name) + "</option>").join("") + "</optgroup>" : "");
  }

  function viewTasks() {
    const total = S.tasks.length, done = S.tasks.filter((t) => statusOf(t) === "done").length;
    const pct = total ? Math.round(done / total * 100) : 0;
    const stages = sortedStages();
    const current = stages.find((s) => stageStatus(s).key !== "done");
    const overdue = S.tasks.filter(isOverdue).length;
    const mine = S.tasks.filter((t) => t.owner === S.me.id && statusOf(t) !== "done").length;
    const L = launchDate(), left = L ? dayDiff(L, todayUTC()) : null;
    if (!S.sel || (S.sel !== "__open" && !stages.some((s) => s.id === S.sel))) S.sel = (current || stages[0] || {}).id || null;

    const head =
      "<section><h1>مسار الافتتاح</h1></section>" +
      '<div class="stats">' +
      '<div class="stat"><b class="num">' + done + " / " + total + "</b><span>المهام المنجزة (" + pct + "%)</span></div>" +
      (L ? '<div class="stat"><b class="num">' + esc(fmtDY.format(L)) + "</b><span>الافتتاح المتوقع" + (left > 0 ? " · بعد " + left + " يوماً" : "") + "</span></div>" : "") +
      (current ? '<div class="stat"><b>' + esc(current.name) + "</b><span>المرحلة الحالية</span></div>" : "") +
      '<div class="stat"><b class="num">' + mine + "</b><span>مهامي المفتوحة</span></div>" +
      '<div class="stat' + (overdue ? " warn" : "") + '"><b class="num">' + overdue + "</b><span>تجاوزت موعدها</span></div>" +
      "</div>" +
      '<div class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div>';

    const routeHtml =
      '<nav class="route" aria-label="المراحل">' +
      '<div class="route-head"><span>المراحل</span><span class="num">' + stages.length + " مراحل</span></div>" +
      '<button type="button" class="allbtn" data-act="sel" data-id="__open" aria-current="' + (S.sel === "__open") + '"><span>كل المهام المتبقية</span><span class="num muted" style="font-size:12.5px">' + (total - done) + " متبقية</span></button>" +
      '<ol class="route-list">' + stages.map((st, i) => {
        const ts = tasksOf(st.id), dn = ts.filter((t) => statusOf(t) === "done").length, status = stageStatus(st);
        return '<li><button type="button" class="stop st-' + status.key + '" data-act="sel" data-id="' + esc(st.id) + '" aria-current="' + (S.sel === st.id) + '">' +
          '<span class="dot num">' + (status.key === "done" ? "✓" : i + 1) + "</span>" +
          '<span class="stop-body"><span class="stop-name">' + esc(st.name) + "</span>" +
          '<span class="stop-meta"><span class="num">' + dn + "/" + ts.length + '</span><span class="mini"><i style="width:' + (ts.length ? Math.round(dn / ts.length * 100) : 0) + '%"></i></span><span>' + esc(fd(st.start_date)) + " – " + esc(fd(st.end_date)) + "</span></span></span></button></li>";
      }).join("") + "</ol></nav>";

    return head + '<div class="board">' + routeHtml + '<section class="panel">' + taskPanel(stages) + "</section></div>";
  }

  function taskPanel(stages) {
    const pass = (t) => (S.filter === "mine" ? t.owner === S.me.id : true);
    const mineTab = '<button type="button" class="subtab" data-act="filter" data-id="mine" aria-pressed="' + (S.filter === "mine") + '">مهامي</button>';
    if (S.sel === "__open") {
      const showMine = S.filter === "mine";
      const groups = stages.map((st) => ({ st, ts: tasksOf(st.id).filter((t) => statusOf(t) !== "done" && (!showMine || t.owner === S.me.id)) })).filter((g) => g.ts.length);
      const n = groups.reduce((a, g) => a + g.ts.length, 0);
      return '<div class="panel-head"><span class="ph-step">نظرة شاملة</span><h2>كل المهام المتبقية</h2><p class="ph-desc num">' + n + " مهمة لم تُنجز بعد، مرتّبة حسب المراحل.</p></div>" +
        '<div class="subtabs"><button type="button" class="subtab" data-act="filter" data-id="open" aria-pressed="' + (!showMine) + '">الكل</button>' + mineTab + "</div>" +
        (groups.length ? '<ul class="tasks">' + groups.map((g) =>
          '<li class="group-title"><span>' + esc(g.st.name) + ' <span class="num muted" style="font-weight:600">(' + g.ts.length + ')</span></span><button type="button" class="linkbtn" data-act="sel" data-id="' + esc(g.st.id) + '">فتح المرحلة</button></li>' +
          g.ts.map(taskRow).join("")).join("") + "</ul>"
          : '<div class="empty"><b>' + (showMine ? "لا توجد مهام مفتوحة مسندة إليك" : "كل المهام منجزة") + "</b><span>" + (showMine ? "افتح أي مهمة واختر نفسك مسؤولاً عنها." : "جاهزون للافتتاح.") + "</span></div>");
    }
    const idx = stages.findIndex((s) => s.id === S.sel), st = stages[idx];
    if (!st) return '<div class="empty"><b>لا توجد مراحل بعد</b></div>';
    const all = tasksOf(st.id), done = all.filter((t) => statusOf(t) === "done"), open = all.filter((t) => statusOf(t) !== "done");
    const list = (S.filter === "done" ? done : S.filter === "all" || S.filter === "mine" ? all : open).filter(pass);
    const status = stageStatus(st);
    const days = toDate(st.start_date) && toDate(st.end_date) ? dayDiff(toDate(st.end_date), toDate(st.start_date)) + 1 : null;
    const g = groupTotals("stage_id", st.id);
    const extra = all.filter((t) => !t.cost_item_id && t.expected_cost).reduce((a, t) => a + Number(t.expected_cost), 0);
    const k = "stage:" + st.id + ":";
    const info = S.editStage
      ? '<div class="fields"><label class="field">البداية<input type="date" data-k="' + k + 'start" id="sStart" value="' + esc(st.start_date || "") + '"></label>' +
        '<label class="field">النهاية المتوقعة<input type="date" data-k="' + k + 'end" id="sEnd" value="' + esc(st.end_date || "") + '"></label>' +
        '<label class="field">مسؤول المرحلة<select data-k="' + k + 'owner" id="sOwner">' + memberOptions(st.owner || "") + "</select></label></div>" +
        '<div class="ed-actions" style="margin-top:0"><span></span><span class="grp"><button type="button" class="btn-ghost" data-act="stage-cancel">إلغاء</button><button type="button" class="btn" data-act="stage-save">حفظ</button></span></div>'
      : '<div class="facts num"><span>' + esc(fd(st.start_date)) + " ← " + esc(fd(st.end_date, true)) + (days ? " · " + days + " يوماً" : "") + "</span>" +
        (st.owner ? '<span class="meta" style="margin:0"><span class="who-s">' + ini(st.owner, true) + "مسؤول المرحلة: " + esc(nameOf(st.owner)) + "</span></span>" : "") +
        '<button type="button" class="linkbtn" data-act="stage-edit">تعديل المرحلة</button></div>' +
        '<div class="facts num"><span>تكلفة المرحلة: <b>' + money(g.est) + "</b></span><span>مدفوع: <b>" + money(g.paid) + "</b></span><span>متبقٍ: <b>" + money(g.remaining) + "</b></span>" +
        (g.missing ? '<span class="need">' + g.missing + " بند بلا تقدير</span>" : "") + (extra ? "<span>+ تقديرات مهام غير مرتبطة: <b>" + money(extra) + "</b></span>" : "") + "</div>";
    let empty = "";
    if (!list.length) {
      empty = S.filter === "mine" ? '<div class="empty"><b>لا توجد مهام مسندة إليك في هذه المرحلة</b><span>افتح أي مهمة واختر نفسك مسؤولاً عنها.</span></div>'
        : S.filter === "open" && all.length ? '<div class="empty"><b>كل مهام هذه المرحلة منجزة</b><span>انتقل إلى المرحلة التالية.</span></div>'
        : S.filter === "done" ? '<div class="empty"><b>لا توجد مهام منجزة بعد</b><span>علّم أي مهمة عند إنجازها.</span></div>'
        : '<div class="empty"><b>لا توجد مهام في هذه المرحلة</b><span>أضف أول مهمة من الحقل في الأسفل.</span></div>';
    }
    return '<div class="panel-head">' +
      '<div class="ph-row"><span class="ph-step num">المرحلة ' + (idx + 1) + " من " + stages.length + '</span><span class="chip c-' + status.key + '">' + status.label + "</span></div>" +
      "<h2>" + esc(st.name) + "</h2>" + (st.description ? '<p class="ph-desc">' + esc(st.description) + "</p>" : "") + info +
      '<div class="bar" aria-hidden="true"><i style="width:' + (all.length ? Math.round(done.length / all.length * 100) : 0) + '%"></i></div></div>' +
      '<div class="subtabs">' +
      '<button type="button" class="subtab" data-act="filter" data-id="open" aria-pressed="' + (S.filter === "open") + '">المتبقي<span class="num">' + open.length + "</span></button>" +
      '<button type="button" class="subtab" data-act="filter" data-id="done" aria-pressed="' + (S.filter === "done") + '">المنجز<span class="num">' + done.length + "</span></button>" +
      '<button type="button" class="subtab" data-act="filter" data-id="all" aria-pressed="' + (S.filter === "all") + '">الكل<span class="num">' + all.length + "</span></button>" + mineTab + "</div>" +
      (list.length ? '<ul class="tasks">' + list.map(taskRow).join("") + "</ul>" : empty) +
      '<form class="add" id="addTask"><input data-k="addtask:' + esc(st.id) + '" id="addInput" type="text" placeholder="أضف مهمة لهذه المرحلة…" aria-label="مهمة جديدة" maxlength="200" autocomplete="off"><button class="btn" type="submit">إضافة</button></form>';
  }

  function taskRow(t) {
    const st = statusOf(t), open = S.openTask === t.id, pm = paidMap();
    const meta = [];
    if (t.due_date) meta.push('<span class="num' + (isOverdue(t) ? " overdue" : "") + '">' + (isOverdue(t) ? "متأخرة · " : "متوقع ") + esc(fd(t.due_date)) + "</span>");
    const it = t.cost_item_id ? S.items.find((i) => i.id === t.cost_item_id) : null;
    if (it) { const c = itemCalc(it, pm); meta.push('<span class="num money">' + (c.est == null ? '<span class="need">بلا تقدير</span>' : "التقدير " + money(c.est)) + " · مدفوع " + money(c.paid) + "</span>"); }
    else if (t.expected_cost) meta.push('<span class="num money">متوقع ' + money(t.expected_cost) + "</span>");
    const nComments = S.comments.filter((c) => c.task_id === t.id).length;
    if (nComments) meta.push('<span class="num">' + nComments + (nComments === 1 ? " تعليق" : " تعليقات") + "</span>");
    if (t.notes) meta.push("<span>" + esc(t.notes.length > 80 ? t.notes.slice(0, 80) + "…" : t.notes) + "</span>");
    const assign = '<select class="assign' + (t.owner ? " has" : "") + '" data-assign="' + t.id + '" aria-label="المسؤول عن: ' + esc(t.title) + '">' +
      '<option value="">+ إسناد</option>' + S.members.map((m) => '<option value="' + esc(m.id) + '"' + (m.id === t.owner ? " selected" : "") + ">" + esc(m.name) + "</option>").join("") + "</select>";
    let row = '<li class="task s-' + st + (open ? " is-open" : "") + '">' +
      '<button type="button" class="check" data-act="toggle" data-id="' + t.id + '" role="checkbox" aria-checked="' + (st === "done") + '" aria-label="' + esc(t.title) + '">' + CHECK + "</button>" +
      '<button type="button" class="t-main" data-act="open-task" data-id="' + t.id + '" aria-expanded="' + open + '"><span class="t-title">' + esc(t.title) + "</span>" +
      (meta.length ? '<span class="meta">' + meta.join("") + "</span>" : "") + "</button>" +
      '<span class="side">' + (st === "doing" || st === "blocked" ? '<span class="chip c-' + st + '">' + statusLabel(st) + "</span>" : "") + assign + "</span></li>";
    if (open) row += taskEditor(t, it, pm);
    return row;
  }

  function taskEditor(t, it, pm) {
    const k = "task:" + t.id + ":";
    let linked = "";
    if (it) {
      const c = itemCalc(it, pm), pays = S.payments.filter((p) => p.item_id === it.id);
      linked = '<div class="linked"><div class="facts num"><b>' + esc(it.name) + '</b><span class="chip ' + c.cls + '">' + esc(c.status) + "</span></div>" +
        '<div class="facts num"><span>التقدير: <b>' + money(c.est) + "</b></span><span>مدفوع: <b>" + money(c.paid) + "</b></span><span>متبقٍ: <b>" + money(c.remaining) + "</b></span></div>" +
        (pays.length ? '<ul class="paylist">' + pays.map((p) => "<li><span>" + esc(p.paid_on ? fd(p.paid_on, true) : "بدون تاريخ") + (p.method ? " · " + esc(p.method) : "") + '</span><b class="num">' + money(p.amount) + "</b></li>").join("") + "</ul>" : "") +
        '<div><button type="button" class="linkbtn" data-act="goto-item" data-id="' + it.id + '">فتح البند في التكاليف وتسجيل دفعة ←</button></div></div>';
    }
    const stampTxt = t.updated_by ? '<span class="stamp">آخر تعديل: ' + esc(nameOf(t.updated_by)) + " · " + esc(ago(t.updated_at)) + "</span>" : "<span></span>";
    const del = S.confirmDel === t.id
      ? '<span class="grp"><span class="stamp">حذف المهمة نهائياً؟</span><button type="button" class="btn-danger" data-act="task-del-yes" data-id="' + t.id + '">حذف</button><button type="button" class="btn-ghost" data-act="task-del-no">تراجع</button></span>'
      : '<button type="button" class="btn-text-danger" data-act="task-del" data-id="' + t.id + '">حذف المهمة</button>';
    return '<li class="editor"><div class="fields">' +
      '<label class="field wide">المهمة<input data-k="' + k + 'title" id="eTitle" type="text" maxlength="200" value="' + esc(t.title) + '"></label>' +
      '<label class="field">الحالة<select data-k="' + k + 'status" id="eStatus">' + STATUS.map((s) => '<option value="' + s.key + '"' + (s.key === statusOf(t) ? " selected" : "") + ">" + s.label + "</option>").join("") + "</select></label>" +
      '<label class="field">المسؤول<select data-k="' + k + 'owner" id="eOwner">' + memberOptions(t.owner || "") + "</select></label>" +
      '<label class="field">التاريخ المتوقع للإنجاز<input data-k="' + k + 'due" id="eDue" type="date" value="' + esc(t.due_date || "") + '"></label>' +
      '<label class="field">بند التكلفة المرتبط<select data-k="' + k + 'item" id="eItem">' + itemOptions(t.cost_item_id || null) + "</select></label>" +
      '<label class="field">تكلفة متوقعة (إن لم ترتبط ببند)<input data-k="' + k + 'cost" id="eCost" type="number" min="0" step="1" inputmode="numeric" value="' + esc(t.expected_cost == null ? "" : t.expected_cost) + '"></label>' +
      '<label class="field wide">ملاحظات<textarea data-k="' + k + 'notes" id="eNotes" maxlength="2000">' + esc(t.notes || "") + "</textarea></label>" +
      "</div>" + linked + commentsBlock(t) +
      '<div class="ed-actions">' + stampTxt + '<span class="grp">' + del +
      '<button type="button" class="btn-ghost" data-act="task-close">إغلاق</button><button type="button" class="btn" data-act="task-save" data-id="' + t.id + '">حفظ</button></span></div></li>';
  }

  function commentsBlock(t) {
    const list = S.comments.filter((c) => c.task_id === t.id);
    const k = "comment:" + t.id + ":";
    return '<div class="comments"><div class="comments-head">التعليقات والتحديثات <span class="num muted">(' + list.length + ")</span></div>" +
      (list.length ? '<ul class="clist">' + list.map((c) => {
        const del = c.author !== S.me.id ? "" : S.confirmCommentDel === c.id
          ? '<span class="grp"><button type="button" class="btn-danger" data-act="comment-del-yes" data-id="' + c.id + '">حذف</button><button type="button" class="btn-ghost" data-act="comment-del-no">لا</button></span>'
          : '<button type="button" class="btn-text-danger" data-act="comment-del" data-id="' + c.id + '">حذف</button>';
        return '<li class="c-item">' + (ini(c.author, true) || '<span class="ini sm">؟</span>') + '<div class="c-body"><div class="post-head"><b>' + esc(nameOf(c.author) || "عضو سابق") +
          '</b><span class="muted">' + esc(ago(c.created_at)) + '</span><span class="post-actions">' + del + '</span></div><p class="post-body">' + esc(c.body) + "</p></div></li>";
      }).join("") + "</ul>" : '<p class="muted" style="margin:4px 0;font-size:13px">لا توجد تعليقات بعد. اكتب أول تحديث عن هذه المهمة.</p>') +
      '<div class="c-compose"><textarea data-k="' + k + 'body" id="cBody" maxlength="2000" rows="2" placeholder="اكتب تعليقاً أو تحديثاً عن هذه المهمة…" aria-label="تعليق جديد"></textarea>' +
      '<button type="button" class="btn" data-act="comment-add" data-id="' + t.id + '">إرسال</button></div></div>';
  }

  // ---------------------------------------------------------------- view: costs
  function viewCosts() {
    const T = totals();
    const pct = Math.round(T.pct * 100);
    const settings = S.editSettings
      ? '<div class="panel" style="padding:14px 16px"><div class="fields">' +
        '<label class="field">قيمة الأمانة (رأس المال)<input data-k="set:deposit" id="setDeposit" type="number" min="0" step="1" value="' + esc(T.deposit) + '"></label>' +
        '<label class="field">احتياطي الطوارئ (%)<input data-k="set:pct" id="setPct" type="number" min="0" max="100" step="1" value="' + esc(pct) + '"></label>' +
        '<label class="field">العملة<input data-k="set:cur" id="setCur" type="text" maxlength="5" value="' + esc(cur()) + '"></label></div>' +
        '<div class="ed-actions"><span></span><span class="grp"><button type="button" class="btn-ghost" data-act="settings-cancel">إلغاء</button><button type="button" class="btn" data-act="settings-save">حفظ</button></span></div></div>'
      : '<div class="facts num"><span>قيمة الأمانة: <b>' + money(T.deposit) + "</b></span><span>احتياطي الطوارئ: <b>" + pct + "%</b></span>" +
        '<button type="button" class="linkbtn" data-act="settings-edit">تعديل</button></div>';
    const kpis = '<div class="kpis">' +
      '<div class="kpi"><span>إجمالي التقديرات</span><b class="num">' + money(T.est) + "</b></div>" +
      '<div class="kpi"><span>المدفوع حتى الآن</span><b class="num">' + money(T.paid) + "</b></div>" +
      '<div class="kpi"><span>المتبقي للدفع</span><b class="num">' + money(T.remaining) + "</b></div>" +
      '<div class="kpi"><span>احتياطي الطوارئ</span><b class="num">' + money(T.reserve) + "</b></div>" +
      '<div class="kpi"><span>الرصيد المتبقي من الأمانة</span><b class="num">' + money(T.balance) + "</b></div>" +
      '<div class="kpi key ' + (T.surplus < 0 ? "bad" : "good") + '"><span>' + (T.surplus < 0 ? "العجز المتوقع" : "الفائض المتوقع") + '</span><b class="num">' + money(Math.abs(T.surplus)) + "</b></div>" +
      '<div class="kpi' + (T.missing ? " bad" : "") + '"><span>بنود تحتاج تقدير سعر</span><b class="num">' + T.missing + "</b></div>" +
      "</div>" +
      (T.missing ? '<p class="muted" style="margin:0;font-size:13px">الفائض أو العجز لا يشمل البنود التي لم يُدخل سعرها بعد. أدخل التقديرات في تبويب «البنود» ليصبح الرقم دقيقاً.</p>' : "");
    const tabs = [["items", "البنود", S.items.length], ["payments", "الدفعات", S.payments.length], ["stages", "حسب المرحلة"], ["cats", "حسب الفئة"]];
    const body = S.costTab === "payments" ? costPayments() : S.costTab === "stages" ? costByStage(T) : S.costTab === "cats" ? costByCat() : costItems();
    return '<section class="ph-row" style="justify-content:space-between"><h1>التكاليف</h1><button type="button" class="btn-ghost" data-act="export">تنزيل نسخة Excel</button></section>' +
      settings + kpis +
      '<section class="panel"><div class="subtabs" style="padding-bottom:12px;border-bottom:1px solid var(--line)">' +
      tabs.map(([key, label, n]) => '<button type="button" class="subtab" data-act="cost-tab" data-id="' + key + '" aria-pressed="' + (S.costTab === key) + '">' + label + (n != null ? '<span class="num">' + n + "</span>" : "") + "</button>").join("") +
      "</div>" + body + "</section>";
  }

  function costItems() {
    const pm = paidMap(), q = (S.q || "").trim();
    let list = S.items.slice().sort((a, b) => {
      const sa = (S.stages.find((s) => s.id === a.stage_id) || { sort: 99 }).sort, sb2 = (S.stages.find((s) => s.id === b.stage_id) || { sort: 99 }).sort;
      return sa - sb2 || a.id - b.id;
    });
    if (S.stageFilter === "__none") list = list.filter((i) => !i.stage_id);
    else if (S.stageFilter) list = list.filter((i) => i.stage_id === S.stageFilter);
    if (q) list = list.filter((i) => (i.name + " " + (i.category || "") + " " + (i.supplier || "")).includes(q));
    const linkedCount = (id) => S.tasks.filter((t) => t.cost_item_id === id).length;
    let tEst = 0, tPaid = 0, tRem = 0;
    const rows = list.map((it) => {
      const c = itemCalc(it, pm); tPaid += c.paid; if (c.est != null) { tEst += c.est; tRem += c.remaining; }
      const open = S.openItem === it.id;
      return '<tr class="clickable' + (open ? " open" : "") + '" data-act="open-item" data-id="' + it.id + '">' +
        '<td class="num muted">' + it.id + "</td><td><b>" + esc(it.name) + "</b>" + (it.supplier ? '<div class="muted" style="font-size:12px">' + esc(it.supplier) + "</div>" : "") + "</td>" +
        "<td>" + esc(stageName(it.stage_id) || "—") + '</td><td class="n">' + (it.qty == null ? "—" : esc(it.qty)) + "</td>" +
        '<td class="n">' + (c.est == null ? '<span class="need">أدخل السعر</span>' : money(c.est)) + '</td><td class="n">' + money(c.paid) + '</td><td class="n">' + (c.remaining == null ? "—" : money(c.remaining)) + "</td>" +
        '<td><span class="chip ' + c.cls + '">' + esc(c.status) + '</span></td><td class="n muted">' + (linkedCount(it.id) || "—") + "</td></tr>" +
        (open ? '<tr class="edit-row"><td colspan="9">' + itemEditor(it, c) + "</td></tr>" : "");
    }).join("");
    const adding = S.addingItem ? '<tr class="edit-row"><td colspan="9">' + itemEditor(null, null) + "</td></tr>" : "";
    return '<div class="toolbar"><input class="grow" type="search" data-k="cost:q" id="costQ" placeholder="ابحث عن بند…" value="' + esc(S.q) + '">' +
      '<select data-k="cost:stage" id="costStage">' + stageOptions(S.stageFilter, "كل المراحل") + '<option value="__none"' + (S.stageFilter === "__none" ? " selected" : "") + ">بدون مرحلة</option></select>" +
      '<button type="button" class="btn" data-act="item-new">+ بند جديد</button></div>' +
      '<div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>البند</th><th>المرحلة</th><th class="n">الكمية</th><th class="n">التقدير</th><th class="n">المدفوع</th><th class="n">المتبقي</th><th>الحالة</th><th class="n">مهام</th></tr></thead>' +
      "<tbody>" + adding + (rows || '<tr><td colspan="9" class="muted" style="text-align:center;padding:24px">لا توجد بنود مطابقة.</td></tr>') + "</tbody>" +
      '<tfoot><tr><td></td><td>الإجمالي (' + list.length + ' بند)</td><td></td><td></td><td class="n">' + money(tEst) + '</td><td class="n">' + money(tPaid) + '</td><td class="n">' + money(tRem) + "</td><td></td><td></td></tr></tfoot></table></div>";
  }

  function itemEditor(it, c) {
    const id = it ? it.id : "new", k = "item:" + id + ":";
    const pays = it ? S.payments.filter((p) => p.item_id === it.id) : [];
    const tasks = it ? S.tasks.filter((t) => t.cost_item_id === it.id) : [];
    const del = !it ? "" : S.confirmItemDel === it.id
      ? '<span class="grp"><span class="stamp">حذف البند؟ ستبقى دفعاته في السجل بدون بند.</span><button type="button" class="btn-danger" data-act="item-del-yes" data-id="' + it.id + '">حذف</button><button type="button" class="btn-ghost" data-act="item-del-no">تراجع</button></span>'
      : '<button type="button" class="btn-text-danger" data-act="item-del" data-id="' + it.id + '">حذف البند</button>';
    return '<div class="fields" style="padding-top:8px">' +
      '<label class="field wide">اسم البند<input data-k="' + k + 'name" id="iName" type="text" maxlength="200" value="' + esc(it ? it.name : "") + '"></label>' +
      '<label class="field">الفئة<select data-k="' + k + 'cat" id="iCat"><option value="">—</option>' + CATEGORIES.map((x) => "<option" + (it && it.category === x ? " selected" : "") + ">" + esc(x) + "</option>").join("") +
      (it && it.category && !CATEGORIES.includes(it.category) ? "<option selected>" + esc(it.category) + "</option>" : "") + "</select></label>" +
      '<label class="field">المرحلة<select data-k="' + k + 'stage" id="iStage">' + stageOptions(it ? it.stage_id : S.stageFilter && S.stageFilter !== "__none" ? S.stageFilter : "", "— بدون مرحلة —") + "</select></label>" +
      '<label class="field">الكمية<input data-k="' + k + 'qty" id="iQty" type="number" min="0" step="any" value="' + esc(it && it.qty != null ? it.qty : "") + '"></label>' +
      '<label class="field">التكلفة التقديرية الإجمالية (' + esc(cur()) + ')<input data-k="' + k + 'est" id="iEst" type="number" min="0" step="1" inputmode="numeric" value="' + esc(it && it.estimate != null ? it.estimate : "") + '"></label>' +
      '<label class="field">المورد / المسؤول<input data-k="' + k + 'sup" id="iSup" type="text" maxlength="120" value="' + esc(it ? it.supplier || "" : "") + '"></label>' +
      '<label class="field">تاريخ الاستحقاق<input data-k="' + k + 'due" id="iDue" type="date" value="' + esc(it ? it.due_date || "" : "") + '"></label>' +
      '<label class="field wide">ملاحظات<textarea data-k="' + k + 'notes" id="iNotes" maxlength="2000">' + esc(it ? it.notes || "" : "") + "</textarea></label></div>" +
      (it ? '<div class="linked"><div class="facts num"><b>الدفعات</b><span>مدفوع ' + money(c.paid) + "</span>" + (c.remaining != null ? "<span>متبقٍ " + money(c.remaining) + "</span>" : "") + "</div>" +
        (pays.length ? '<ul class="paylist">' + pays.map((p) => "<li><span>" + esc(p.paid_on ? fd(p.paid_on, true) : "بدون تاريخ") + (p.method ? " · " + esc(p.method) : "") + (p.paid_by ? " · " + esc(p.paid_by) : "") + (p.notes ? " · " + esc(p.notes) : "") + '</span><b class="num">' + money(p.amount) + "</b></li>").join("") + "</ul>" : '<span class="muted">لا توجد دفعات بعد.</span>') +
        '<div class="fields" style="margin-top:6px"><label class="field">مبلغ دفعة جديدة<input data-k="' + k + 'pamt" id="pqAmt" type="number" min="0" step="1" inputmode="numeric"></label>' +
        '<label class="field">التاريخ<input data-k="' + k + 'pdate" id="pqDate" type="date" value="' + todayStr() + '"></label>' +
        '<label class="field">طريقة الدفع<select data-k="' + k + 'pmeth" id="pqMeth"><option value="">—</option>' + METHODS.map((m) => "<option>" + m + "</option>").join("") + "</select></label>" +
        '<div class="field"><span>&nbsp;</span><button type="button" class="btn-ghost" data-act="pay-quick" data-id="' + it.id + '">تسجيل الدفعة</button></div></div>' +
        (tasks.length ? '<div class="muted" style="font-size:12.5px">المهام المرتبطة: ' + tasks.map((t) => esc(t.title)).join("، ") + "</div>" : "") + "</div>" : "") +
      '<div class="ed-actions"><span class="stamp">' + (it && it.updated_by ? "آخر تعديل: " + esc(nameOf(it.updated_by)) + " · " + esc(ago(it.updated_at)) : "") + '</span><span class="grp">' + del +
      '<button type="button" class="btn-ghost" data-act="item-close">إغلاق</button><button type="button" class="btn" data-act="item-save" data-id="' + id + '">' + (it ? "حفظ" : "إضافة البند") + "</button></span></div>";
  }

  function costPayments() {
    const k = "pay:new:";
    const opts = '<option value="">— اختر البند —</option>' + sortedStages().map((s) => {
      const its = S.items.filter((i) => i.stage_id === s.id);
      return its.length ? '<optgroup label="' + esc(s.name) + '">' + its.map((i) => '<option value="' + i.id + '">' + esc(i.name) + "</option>").join("") + "</optgroup>" : "";
    }).join("") + S.items.filter((i) => !i.stage_id).map((i) => '<option value="' + i.id + '">' + esc(i.name) + "</option>").join("");
    const list = S.payments.slice().sort((a, b) => (b.paid_on || "").localeCompare(a.paid_on || "") || b.id - a.id);
    const total = list.reduce((a, p) => a + Number(p.amount), 0);
    return '<div class="composer"><b>تسجيل دفعة جديدة</b><div class="fields">' +
      '<label class="field">البند<select data-k="' + k + 'item" id="pItem">' + opts + "</select></label>" +
      '<label class="field">المبلغ (' + esc(cur()) + ')<input data-k="' + k + 'amt" id="pAmt" type="number" min="0" step="1" inputmode="numeric"></label>' +
      '<label class="field">التاريخ<input data-k="' + k + 'date" id="pDate" type="date" value="' + todayStr() + '"></label>' +
      '<label class="field">طريقة الدفع<select data-k="' + k + 'meth" id="pMeth"><option value="">—</option>' + METHODS.map((m) => "<option>" + m + "</option>").join("") + "</select></label>" +
      '<label class="field">رقم الإيصال / الفاتورة<input data-k="' + k + 'rec" id="pRec" type="text" maxlength="60"></label>' +
      '<label class="field">دفع بواسطة<input data-k="' + k + 'by" id="pBy" type="text" maxlength="60" value="' + esc(S.me.name) + '"></label>' +
      '<label class="field wide">ملاحظات<input data-k="' + k + 'notes" id="pNotes" type="text" maxlength="300"></label></div>' +
      '<div class="composer-row"><span class="muted" style="font-size:13px">تُضاف الدفعة إلى البند والمرحلة والملخص فوراً.</span><button type="button" class="btn" data-act="pay-add">تسجيل الدفعة</button></div></div>' +
      '<div class="table-wrap"><table class="t"><thead><tr><th>التاريخ</th><th>البند</th><th class="n">المبلغ</th><th>الطريقة</th><th>الإيصال</th><th>دفع بواسطة</th><th>ملاحظات</th><th></th></tr></thead><tbody>' +
      (list.map((p) => {
        const it = S.items.find((i) => i.id === p.item_id);
        const del = S.confirmPayDel === p.id
          ? '<span class="grp"><button type="button" class="btn-danger" data-act="pay-del-yes" data-id="' + p.id + '">حذف</button><button type="button" class="btn-ghost" data-act="pay-del-no">لا</button></span>'
          : '<button type="button" class="btn-text-danger" data-act="pay-del" data-id="' + p.id + '">حذف</button>';
        return "<tr><td class=\"num\">" + (p.paid_on ? esc(fd(p.paid_on, true)) : '<span class="need">بدون تاريخ</span>') + "</td><td>" + (it ? esc(it.name) : '<span class="muted">بدون بند</span>') + '</td><td class="n"><b>' + money(p.amount) + "</b></td>" +
          "<td>" + esc(p.method || "—") + "</td><td>" + esc(p.receipt || "—") + "</td><td>" + esc(p.paid_by || "—") + '</td><td class="muted">' + esc(p.notes || "") + "</td><td>" + del + "</td></tr>";
      }).join("") || '<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">لا توجد دفعات بعد.</td></tr>') +
      '</tbody><tfoot><tr><td></td><td>الإجمالي</td><td class="n">' + money(total) + '</td><td colspan="5"></td></tr></tfoot></table></div>';
  }

  function costByStage(T) {
    let cum = 0;
    const rows = sortedStages().map((s) => {
      const g = groupTotals("stage_id", s.id); cum += g.remaining;
      const ok = cum <= T.balance;
      return '<tr class="clickable" data-act="filter-stage" data-id="' + esc(s.id) + '"><td><b>' + esc(s.name) + '</b><div class="muted num" style="font-size:12px">' + esc(fd(s.start_date)) + " – " + esc(fd(s.end_date)) + "</div></td>" +
        '<td class="n">' + money(g.est) + '</td><td class="n">' + money(g.paid) + '</td><td class="n">' + money(g.remaining) + '</td><td class="n">' + money(cum) + "</td>" +
        '<td><span class="chip ' + (ok ? "c-done" : "c-over") + '">' + (ok ? "يكفي" : "عجز " + money(cum - T.balance)) + "</span>" + (g.missing ? ' <span class="need">' + g.missing + " بلا تقدير</span>" : "") + "</td></tr>";
    }).join("");
    const loose = groupTotals("stage_id", "");
    return '<div class="table-wrap"><table class="t"><thead><tr><th>المرحلة</th><th class="n">التقدير</th><th class="n">المدفوع</th><th class="n">المتبقي</th><th class="n">المتبقي التراكمي</th><th>هل يكفي رصيد الأمانة؟</th></tr></thead><tbody>' + rows +
      (loose.count ? '<tr><td class="muted">بنود بدون مرحلة</td><td class="n">' + money(loose.est) + '</td><td class="n">' + money(loose.paid) + '</td><td class="n">' + money(loose.remaining) + "</td><td></td><td></td></tr>" : "") +
      '</tbody><tfoot><tr><td>الإجمالي</td><td class="n">' + money(T.est) + '</td><td class="n">' + money(T.paid) + '</td><td class="n">' + money(T.remaining) + '</td><td></td><td class="muted" style="font-weight:600">الرصيد المتاح: ' + money(T.balance) + "</td></tr></tfoot></table></div>";
  }

  function costByCat() {
    const cats = CATEGORIES.concat([...new Set(S.items.map((i) => i.category).filter((c) => c && !CATEGORIES.includes(c)))]);
    const rows = cats.map((c) => ({ c, g: groupTotals("category", c) })).filter((x) => x.g.count).map(({ c, g }) =>
      "<tr><td><b>" + esc(c) + '</b></td><td class="n">' + money(g.est) + '</td><td class="n">' + money(g.paid) + '</td><td class="n">' + money(g.remaining) + '</td><td class="n">' + g.count + '</td><td class="n">' + (g.missing ? '<span class="need">' + g.missing + "</span>" : "—") + "</td></tr>").join("");
    return '<div class="table-wrap"><table class="t"><thead><tr><th>الفئة</th><th class="n">التقدير</th><th class="n">المدفوع</th><th class="n">المتبقي</th><th class="n">البنود</th><th class="n">بلا تقدير</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }

  // ---------------------------------------------------------------- view: updates
  function viewUpdates() {
    const list = S.posts.filter((p) => S.feedFilter === "all" || p.kind === S.feedFilter);
    const counts = Object.fromEntries(KINDS.map((k) => [k.key, S.posts.filter((p) => p.kind === k.key).length]));
    const kindInfo = (k) => KINDS.find((x) => x.key === k) || KINDS[0];
    return '<section><h1>التحديثات والأفكار</h1><p class="muted" style="margin:4px 0 0">شارك ما تم إنجازه، أو فكرة جديدة، أو ملاحظة يحتاج الفريق أن يعرفها.</p></section>' +
      '<section class="panel"><form class="composer" id="postForm">' +
      '<div class="composer-row"><div class="seg" role="group" aria-label="نوع المنشور">' +
      KINDS.map((k) => '<button type="button" data-act="kind" data-id="' + k.key + '" aria-pressed="' + (S.kind === k.key) + '">' + k.label + "</button>").join("") + "</div>" +
      '<select data-k="post:stage" id="postStage" aria-label="المرحلة">' + stageOptions("", "بدون مرحلة محددة") + "</select></div>" +
      '<textarea data-k="post:body" id="postBody" maxlength="4000" placeholder="' + (S.kind === "idea" ? "ما فكرتك؟" : S.kind === "note" ? "اكتب الملاحظة…" : "ما الجديد اليوم؟") + '" aria-label="نص المنشور"></textarea>' +
      '<div class="composer-row"><span class="muted" style="font-size:13px">يظهر باسمك لكل الفريق.</span><button class="btn" type="submit">نشر</button></div></form>' +
      '<div class="subtabs"><button type="button" class="subtab" data-act="feed" data-id="all" aria-pressed="' + (S.feedFilter === "all") + '">الكل<span class="num">' + S.posts.length + "</span></button>" +
      KINDS.map((k) => '<button type="button" class="subtab" data-act="feed" data-id="' + k.key + '" aria-pressed="' + (S.feedFilter === k.key) + '">' + k.label + '<span class="num">' + counts[k.key] + "</span></button>").join("") + "</div>" +
      (list.length ? '<ul class="feed">' + list.map((p) => {
        const k = kindInfo(p.kind);
        const mine = p.author === S.me.id;
        const del = !mine ? "" : S.confirmPostDel === p.id
          ? '<span class="grp"><button type="button" class="btn-danger" data-act="post-del-yes" data-id="' + p.id + '">حذف</button><button type="button" class="btn-ghost" data-act="post-del-no">لا</button></span>'
          : '<button type="button" class="btn-text-danger" data-act="post-del" data-id="' + p.id + '">حذف</button>';
        return '<li class="post">' + (ini(p.author) || '<span class="ini">؟</span>') + "<div>" +
          '<div class="post-head"><b>' + esc(nameOf(p.author) || "عضو سابق") + '</b><span class="chip ' + k.cls + '">' + k.label + "</span>" +
          (p.stage_id ? '<span class="muted">' + esc(stageName(p.stage_id)) + "</span>" : "") + '<span class="muted">' + esc(ago(p.created_at)) + '</span><span class="post-actions">' + del + "</span></div>" +
          '<p class="post-body">' + esc(p.body) + "</p></div></li>";
      }).join("") + "</ul>"
        : '<div class="empty"><b>لا توجد منشورات بعد</b><span>اكتب أول تحديث للفريق من الحقل في الأعلى.</span></div>') +
      "</section>";
  }

  // ---------------------------------------------------------------- export to Excel
  function exportXlsx() {
    if (!window.XLSX) { toast("تعذّر تحميل أداة Excel. تحقق من الاتصال."); return; }
    const T = totals(), pm = paidMap();
    const summary = [["البند", "القيمة"], ["قيمة الأمانة", T.deposit], ["إجمالي التقديرات", T.est], ["المدفوع", T.paid], ["المتبقي للدفع", T.remaining],
      ["احتياطي الطوارئ (" + Math.round(T.pct * 100) + "%)", Math.round(T.reserve)], ["الرصيد المتبقي من الأمانة", T.balance], ["الفائض / العجز", Math.round(T.surplus)],
      ["بنود تحتاج تقدير", T.missing], ["الافتتاح المتوقع", launchDate() ? launchDate().toISOString().slice(0, 10) : ""], ["تاريخ التصدير", todayStr()]];
    const items = [["#", "الفئة", "البند", "المرحلة", "الكمية", "التقدير", "المدفوع", "المتبقي", "الحالة", "المورد", "ملاحظات"]].concat(
      S.items.map((i) => { const c = itemCalc(i, pm); return [i.id, i.category || "", i.name, stageName(i.stage_id), i.qty, c.est, c.paid, c.remaining, c.status, i.supplier || "", i.notes || ""]; }));
    const pays = [["التاريخ", "البند", "المبلغ", "الطريقة", "الإيصال", "دفع بواسطة", "ملاحظات"]].concat(
      S.payments.map((p) => [p.paid_on || "", (S.items.find((i) => i.id === p.item_id) || {}).name || "", Number(p.amount), p.method || "", p.receipt || "", p.paid_by || "", p.notes || ""]));
    const stages = [["المرحلة", "البداية", "النهاية", "المسؤول", "التقدير", "المدفوع", "المتبقي", "المهام المنجزة"]].concat(
      sortedStages().map((s) => { const g = groupTotals("stage_id", s.id), ts = tasksOf(s.id); return [s.name, s.start_date || "", s.end_date || "", nameOf(s.owner), g.est, g.paid, g.remaining, ts.filter((t) => statusOf(t) === "done").length + "/" + ts.length]; }));
    const tasks = [["المرحلة", "المهمة", "الحالة", "المسؤول", "التاريخ المتوقع", "بند التكلفة", "تكلفة متوقعة", "ملاحظات"]].concat(
      sortedStages().flatMap((s) => tasksOf(s.id).map((t) => [s.name, t.title, statusLabel(statusOf(t)), nameOf(t.owner), t.due_date || "", (S.items.find((i) => i.id === t.cost_item_id) || {}).name || "", t.expected_cost, t.notes || ""])));
    const posts = [["التاريخ", "الكاتب", "النوع", "المرحلة", "النص"]].concat(
      S.posts.map((p) => [p.created_at.slice(0, 16).replace("T", " "), nameOf(p.author), (KINDS.find((k) => k.key === p.kind) || {}).label || "", stageName(p.stage_id), p.body]));
    const comments = [["التاريخ", "المهمة", "الكاتب", "التعليق"]].concat(
      S.comments.map((c) => [c.created_at.slice(0, 16).replace("T", " "), (S.tasks.find((t) => t.id === c.task_id) || {}).title || "", nameOf(c.author), c.body]));
    const wb = XLSX.utils.book_new();
    [["الملخص", summary], ["البنود", items], ["الدفعات", pays], ["المراحل", stages], ["المهام", tasks], ["تعليقات المهام", comments], ["التحديثات", posts]].forEach(([n, rows]) => {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = rows[0].map((_, i) => ({ wch: Math.min(40, Math.max(10, ...rows.map((r) => String(r[i] == null ? "" : r[i]).length + 2))) }));
      XLSX.utils.book_append_sheet(wb, ws, n);
    });
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.writeFile(wb, "alaraby-workspace-" + todayStr() + ".xlsx");
  }

  // ---------------------------------------------------------------- actions
  function selectStage(id) {
    S.sel = id; S.openTask = null; S.confirmDel = null; S.editStage = false; store.set("sel", id);
    render();
    if (window.matchMedia("(max-width: 860px)").matches) { const p = app.querySelector(".panel"); if (p) p.scrollIntoView({ behavior: "smooth", block: "start" }); }
  }
  const val = (id) => { const el = $(id); return el ? el.value.trim() : ""; };

  document.addEventListener("click", async (ev) => {
    const el = ev.target.closest("[data-act]");
    if (!el || !app.contains(el)) return;
    const act = el.dataset.act, id = el.dataset.id, nid = id != null && /^\d+$/.test(id) ? Number(id) : id;
    switch (act) {
      case "pick": S.loginPick = id; S.loginErr = ""; store.set("who", id); { const pw = $("pw") ? $("pw").value : ""; renderLogin(); if ($("pw")) { $("pw").value = pw; $("pw").focus(); } } return;
      case "logout": await sb.auth.signOut(); return;
      // tasks
      case "sel": selectStage(id); return;
      case "filter": S.filter = id; store.set("filter", id); render(); return;
      case "toggle": {
        const t = S.tasks.find((x) => x.id === nid); if (!t) return;
        const done = statusOf(t) !== "done";
        t.status = done ? "done" : "todo"; render(); // optimistic
        await run("tasks", sb.from("tasks").update(Object.assign({ status: t.status, done_at: done ? todayStr() : null }, stamp())).eq("id", t.id));
        return;
      }
      case "open-task": S.openTask = S.openTask === nid ? null : nid; S.confirmDel = null; dropPrefix = "task:" + nid + ":"; render(); return;
      case "task-close": S.openTask = null; S.confirmDel = null; render(); return;
      case "task-save": {
        const t = S.tasks.find((x) => x.id === nid); if (!t) return;
        const title = val("eTitle"); if (!title) { toast("اكتب اسم المهمة."); return; }
        const cost = num(val("eCost")); if (Number.isNaN(cost) || (cost != null && cost < 0)) { toast("التكلفة المتوقعة يجب أن تكون رقماً موجباً."); return; }
        const status = val("eStatus"), wasDone = statusOf(t) === "done";
        const ok = await run("tasks", sb.from("tasks").update(Object.assign({
          title, status, owner: val("eOwner") || null, due_date: val("eDue") || null,
          cost_item_id: val("eItem") ? Number(val("eItem")) : null, expected_cost: cost, notes: val("eNotes") || null,
          done_at: status === "done" ? (wasDone ? t.done_at : todayStr()) : null
        }, stamp())).eq("id", t.id), "حُفظت المهمة.");
        if (ok) { dropPrefix = "task:" + t.id + ":"; S.openTask = null; render(); }
        return;
      }
      case "comment-add": {
        const body = val("cBody"); if (!body) { toast("اكتب نص التعليق."); return; }
        const ok = await run("task_comments", sb.from("task_comments").insert({ task_id: nid, body, author: S.me.id }));
        if (ok) { dropPrefix = "comment:" + nid + ":"; render(); }
        return;
      }
      case "comment-del": S.confirmCommentDel = nid; render(); return;
      case "comment-del-no": S.confirmCommentDel = null; render(); return;
      case "comment-del-yes": S.confirmCommentDel = null; await run("task_comments", sb.from("task_comments").delete().eq("id", nid), "حُذف التعليق."); return;
      case "task-del": S.confirmDel = nid; render(); return;
      case "task-del-no": S.confirmDel = null; render(); return;
      case "task-del-yes": S.confirmDel = null; S.openTask = null; await run("tasks", sb.from("tasks").delete().eq("id", nid), "حُذفت المهمة."); return;
      case "goto-item": {
        const it = S.items.find((i) => i.id === nid);
        S.costTab = "items"; S.openItem = nid; S.stageFilter = it && it.stage_id ? it.stage_id : ""; S.q = "";
        location.hash = "#costs"; return;
      }
      case "stage-edit": S.editStage = true; render(); return;
      case "stage-cancel": S.editStage = false; dropPrefix = "stage:"; render(); return;
      case "stage-save": {
        const s = val("sStart"), e = val("sEnd");
        if (s && e && s > e) { toast("تاريخ النهاية يجب أن يكون بعد تاريخ البداية."); return; }
        const ok = await run("stages", sb.from("stages").update(Object.assign({ start_date: s || null, end_date: e || null, owner: val("sOwner") || null }, stamp())).eq("id", S.sel), "حُفظت المرحلة.");
        if (ok) { S.editStage = false; dropPrefix = "stage:"; render(); }
        return;
      }
      // costs
      case "cost-tab": S.costTab = id; S.openItem = null; S.addingItem = false; render(); return;
      case "filter-stage": S.costTab = "items"; S.stageFilter = id; S.openItem = null; render(); return;
      case "open-item": if (ev.target.closest("input,select,textarea,button") && ev.target.closest(".edit-row")) return;
        S.openItem = S.openItem === nid ? null : nid; S.addingItem = false; S.confirmItemDel = null; dropPrefix = "item:" + nid + ":"; render(); return;
      case "item-new": S.addingItem = true; S.openItem = null; dropPrefix = "item:new:"; render(); { const n = $("iName"); if (n) n.focus(); } return;
      case "item-close": S.openItem = null; S.addingItem = false; S.confirmItemDel = null; render(); return;
      case "item-save": {
        const name = val("iName"); if (!name) { toast("اكتب اسم البند."); return; }
        const qty = num(val("iQty")), est = num(val("iEst"));
        if (Number.isNaN(qty) || Number.isNaN(est) || (est != null && est < 0)) { toast("الكمية والتقدير يجب أن يكونا أرقاماً موجبة."); return; }
        const row = Object.assign({ name, category: val("iCat") || null, stage_id: val("iStage") || null, qty, estimate: est,
          supplier: val("iSup") || null, due_date: val("iDue") || null, notes: val("iNotes") || null }, stamp());
        const ok = id === "new"
          ? await run("cost_items", sb.from("cost_items").insert(row), "أُضيف البند.")
          : await run("cost_items", sb.from("cost_items").update(row).eq("id", nid), "حُفظ البند.");
        if (ok) { dropPrefix = "item:" + id + ":"; S.openItem = null; S.addingItem = false; render(); }
        return;
      }
      case "item-del": S.confirmItemDel = nid; render(); return;
      case "item-del-no": S.confirmItemDel = null; render(); return;
      case "item-del-yes": S.confirmItemDel = null; S.openItem = null; await run("cost_items", sb.from("cost_items").delete().eq("id", nid), "حُذف البند."); refresh("tasks"); refresh("payments"); return;
      case "pay-quick": {
        const amt = num(val("pqAmt")); if (!amt || Number.isNaN(amt) || amt <= 0) { toast("أدخل مبلغ الدفعة."); return; }
        const ok = await run("payments", sb.from("payments").insert({ item_id: nid, amount: amt, paid_on: val("pqDate") || null, method: val("pqMeth") || null, paid_by: S.me.name, created_by: S.me.id }), "سُجّلت الدفعة.");
        if (ok) { dropPrefix = "item:" + nid + ":p"; render(); }
        return;
      }
      case "pay-add": {
        const item = val("pItem"), amt = num(val("pAmt"));
        if (!item) { toast("اختر البند الذي دُفعت له الدفعة."); return; }
        if (!amt || Number.isNaN(amt) || amt <= 0) { toast("أدخل مبلغ الدفعة."); return; }
        const ok = await run("payments", sb.from("payments").insert({ item_id: Number(item), amount: amt, paid_on: val("pDate") || null, method: val("pMeth") || null,
          receipt: val("pRec") || null, paid_by: val("pBy") || null, notes: val("pNotes") || null, created_by: S.me.id }), "سُجّلت الدفعة.");
        if (ok) { dropPrefix = "pay:new:"; render(); }
        return;
      }
      case "pay-del": S.confirmPayDel = nid; render(); return;
      case "pay-del-no": S.confirmPayDel = null; render(); return;
      case "pay-del-yes": S.confirmPayDel = null; await run("payments", sb.from("payments").delete().eq("id", nid), "حُذفت الدفعة."); return;
      case "settings-edit": S.editSettings = true; dropPrefix = "set:"; render(); return;
      case "settings-cancel": S.editSettings = false; render(); return;
      case "settings-save": {
        const dep = num(val("setDeposit")), pct = num(val("setPct")), c = val("setCur") || "$";
        if (dep == null || Number.isNaN(dep) || dep < 0 || pct == null || Number.isNaN(pct) || pct < 0 || pct > 100) { toast("تحقق من قيمة الأمانة ونسبة الاحتياطي."); return; }
        const by = S.me.id, at = new Date().toISOString();
        const ok = await run("settings", sb.from("settings").upsert([
          { key: "deposit", value: dep, updated_by: by, updated_at: at },
          { key: "contingency", value: pct / 100, updated_by: by, updated_at: at },
          { key: "currency", value: c, updated_by: by, updated_at: at }]), "حُفظت الإعدادات.");
        if (ok) { S.editSettings = false; render(); }
        return;
      }
      case "export": exportXlsx(); return;
      // updates
      case "kind": S.kind = id; render(); return;
      case "feed": S.feedFilter = id; render(); return;
      case "post-del": S.confirmPostDel = nid; render(); return;
      case "post-del-no": S.confirmPostDel = null; render(); return;
      case "post-del-yes": S.confirmPostDel = null; await run("posts", sb.from("posts").delete().eq("id", nid), "حُذف المنشور."); return;
    }
  });

  let qTimer = null;
  document.addEventListener("input", (ev) => {
    if (ev.target.id === "costQ") { clearTimeout(qTimer); qTimer = setTimeout(() => { S.q = ev.target.value; S.openItem = null; render(); }, 200); }
  });
  document.addEventListener("change", (ev) => {
    if (ev.target.id === "costStage") { S.stageFilter = ev.target.value; S.openItem = null; S.addingItem = false; render(); }
    if (ev.target.dataset && ev.target.dataset.assign) {
      const tid = Number(ev.target.dataset.assign), owner = ev.target.value || null, t = S.tasks.find((x) => x.id === tid);
      if (!t) return;
      t.owner = owner; render(); // optimistic
      run("tasks", sb.from("tasks").update(Object.assign({ owner }, stamp())).eq("id", tid), owner ? "أُسندت المهمة إلى " + nameOf(owner) + "." : "أُزيل المسؤول عن المهمة.");
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && (S.openTask || S.openItem || S.addingItem)) { S.openTask = null; S.openItem = null; S.addingItem = false; render(); }
  });

  document.addEventListener("submit", async (ev) => {
    const f = ev.target;
    if (f.id === "loginForm") {
      ev.preventDefault();
      const m = member(S.loginPick), pw = $("pw").value;
      if (!m) { S.loginErr = "اختر اسمك أولاً."; renderLogin(); return; }
      if (!pw) { S.loginErr = "اكتب كلمة المرور."; renderLogin(); return; }
      S.loggingIn = true; S.loginErr = ""; renderLogin(); $("pw").value = pw;
      const { data, error } = await sb.auth.signInWithPassword({ email: m.email, password: pw });
      S.loggingIn = false;
      if (error) {
        S.loginErr = /invalid/i.test(error.message) ? "كلمة المرور غير صحيحة. تأكد منها واطلبها من عمر إن نسيتها." : "تعذّر تسجيل الدخول: " + error.message;
        renderLogin(); return;
      }
      await onSession(data.session);
    } else if (f.id === "addTask") {
      ev.preventDefault();
      const input = $("addInput"), title = input.value.trim();
      if (!title || !S.sel || S.sel === "__open") return;
      const sort = tasksOf(S.sel).reduce((m, t) => Math.max(m, t.sort || 0), 0) + 1;
      const { data, error } = await sb.from("tasks").insert(Object.assign({ stage_id: S.sel, title, sort, status: "todo" }, stamp())).select("id").single();
      if (error) { toast("لم تُضف المهمة: " + error.message); return; }
      dropPrefix = "addtask:"; if (S.filter === "done") S.filter = "open";
      S.openTask = data.id; refresh("tasks");
    } else if (f.id === "postForm") {
      ev.preventDefault();
      const body = val("postBody"); if (!body) { toast("اكتب نص المنشور."); return; }
      const ok = await run("posts", sb.from("posts").insert({ kind: S.kind, body, stage_id: val("postStage") || null, author: S.me.id }), "نُشر.");
      if (ok) { dropPrefix = "post:"; render(); }
    }
  });

  // ---------------------------------------------------------------- session
  async function onSession(session) {
    S.session = session || null;
    if (!session) { S.me = null; S.loaded = false; render(); return; }
    const email = (session.user.email || "").toLowerCase();
    S.me = S.members.find((m) => m.email.toLowerCase() === email) || null;
    if (!S.me) { S.loginErr = "هذا الحساب غير موجود في قائمة الفريق."; await sb.auth.signOut(); S.session = null; renderLogin(); return; }
    render();
    try { await loadAll(); subscribe(); }
    catch (e) { console.error(e); toast("تعذّر تحميل البيانات. تحقق من الاتصال ثم أعد تحميل الصفحة."); }
    render();
  }

  async function boot() {
    renderLogin();
    const { data: m, error } = await sb.from("members").select("*").order("sort");
    if (error) { app.innerHTML = '<div class="boot">تعذّر الاتصال بالخادم. تحقق من الإنترنت ثم أعد تحميل الصفحة.</div>'; return; }
    S.members = m || [];
    if (S.loginPick && !member(S.loginPick)) S.loginPick = null;
    const { data } = await sb.auth.getSession();
    await onSession(data.session);
    sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") { if (channel) { sb.removeChannel(channel); channel = null; } S.session = null; S.me = null; S.loaded = false; renderLogin(); }
      else if (event === "TOKEN_REFRESHED") S.session = session;
    });
  }

  // debugging hook for local previews only (no data or keys exposed beyond what the page already holds)
  window.__workspace = { state: S, render };
  boot();
})();
