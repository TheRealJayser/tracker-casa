// Tracker Casa — app principale (vanilla JS + Firebase via CDN, nessuna build).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  writeBatch, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { VERSION } from "./version.js";
import { SEED_PEOPLE, SEED_PRODUCTS, SEED_COUNTS } from "./seed.js";

// ---------------------------------------------------------------- Stato
const S = {
  user: null, me: null,               // utente Firebase e documento members
  people: [], products: [], purchases: [], missing: {}, members: [],
  view: localStorage.getItem("view") || "manca",
  logFilter: "all", search: "",
  unsub: []
};
const $app = document.getElementById("app");
const $sheet = document.getElementById("sheet-root");
const $toast = document.getElementById("toast");

// ---------------------------------------------------------------- Utility
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "x";
const weight = (p) => p.count || 1;
const toDate = (ts) => (ts && ts.toDate ? ts.toDate() : null);
const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
function fmtDay(d) {
  if (!d) return "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((today - x) / 86400000);
  if (diff === 0) return "oggi";
  if (diff === 1) return "ieri";
  if (diff > 1 && diff < 7) return `${diff} giorni fa`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== today.getFullYear() ? " " + d.getFullYear() : ""}`;
}
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const isoToTs = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Timestamp.fromDate(new Date(y, m - 1, d, 12, 0, 0)); };

const person = (id) => S.people.find((p) => p.id === id);
const product = (id) => S.products.find((p) => p.id === id);
const activeProducts = () => S.products.filter((p) => !p.archived);
const myPersonId = () => (S.me && S.me.personId && person(S.me.personId) ? S.me.personId : null);
const isAdmin = () => S.me && S.me.role === "admin";

function avatar(p, size = 36) {
  if (!p) return `<span class="avatar" style="background:#999;width:${size}px;height:${size}px">?</span>`;
  return `<span class="avatar" style="background:${esc(p.color || "#888")};width:${size}px;height:${size}px;font-size:${Math.round(size * .42)}px">${esc(p.name[0] || "?").toUpperCase()}</span>`;
}

let toastTimer;
function toast(msg) {
  $toast.textContent = msg; $toast.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $toast.classList.remove("show"), 2400);
}
function fail(e) { console.error(e); toast(e?.code === "permission-denied" ? "Permesso negato" : "Errore: " + (e?.message || e)); }

// ---------------------------------------------------------------- Statistiche
function computeStats() {
  const byProduct = {}, byPerson = {};
  let total = 0, lastAny = null;
  for (const p of S.people) byPerson[p.id] = 0;
  for (const pr of S.products) byProduct[pr.id] = { total: 0, per: {}, last: null };
  for (const pu of S.purchases) {
    const w = weight(pu);
    total += w;
    byPerson[pu.personId] = (byPerson[pu.personId] || 0) + w;
    const b = byProduct[pu.productId] || (byProduct[pu.productId] = { total: 0, per: {}, last: null });
    b.total += w;
    b.per[pu.personId] = (b.per[pu.personId] || 0) + w;
    const d = toDate(pu.date);
    if (d && (!b.last || d > b.last.date)) b.last = { date: d, personId: pu.personId };
    if (d && (!lastAny || d > lastAny.date)) lastAny = { date: d, personId: pu.personId, productId: pu.productId };
  }
  return { total, byPerson, byProduct, lastAny };
}
// Turno suggerito: chi ha comprato meno quel prodotto; a parità, chi l'ha comprato meno di recente.
function suggestedTurn(stats, productId) {
  if (!S.people.length) return null;
  const b = stats.byProduct[productId] || { per: {} };
  const lastBy = {};
  for (const pu of S.purchases) {
    if (pu.productId !== productId) continue;
    const d = toDate(pu.date); if (!d) continue;
    if (!lastBy[pu.personId] || d > lastBy[pu.personId]) lastBy[pu.personId] = d;
  }
  return [...S.people].sort((a, b2) =>
    (b.per[a.id] || 0) - (b.per[b2.id] || 0) ||
    ((lastBy[a.id]?.getTime() || 0) - (lastBy[b2.id]?.getTime() || 0)) ||
    (a.order || 0) - (b2.order || 0)
  )[0];
}

// ---------------------------------------------------------------- Firebase
const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("INCOLLA");
let auth, db;
if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
}

async function login() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) {
      await signInWithRedirect(auth, provider);
    } else if (e.code !== "auth/popup-closed-by-user") fail(e);
  }
}

function stopListeners() { S.unsub.forEach((u) => u()); S.unsub = []; }

function startListeners() {
  stopListeners();
  const sortByOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name);
  const listen = (name, fn) => S.unsub.push(onSnapshot(collection(db, name), fn, fail));
  listen("people", (snap) => { S.people = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(sortByOrder); render(); });
  listen("products", (snap) => { S.products = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(sortByOrder); render(); });
  listen("purchases", (snap) => { S.purchases = snap.docs.map((d) => ({ id: d.id, ...d.data() })); render(); });
  listen("missing", (snap) => { S.missing = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()])); render(); });
  if (isAdmin()) listen("members", (snap) => { S.members = snap.docs.map((d) => ({ email: d.id, ...d.data() })); render(); });
  // Aggiorna il proprio profilo membro (es. persona collegata) in tempo reale
  S.unsub.push(onSnapshot(doc(db, "members", S.user.email.toLowerCase()), (d) => {
    if (!d.exists()) { S.me = null; stopListeners(); renderShell(); return; }
    const wasAdmin = isAdmin();
    S.me = { email: d.id, ...d.data() };
    if (wasAdmin !== isAdmin()) startListeners(); else render();
  }, fail));
}

// ---------------------------------------------------------------- Azioni dati
async function registerPurchase(productId, personId, iso, note) {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, "purchases")), {
    productId, personId, date: isoToTs(iso), note: note || "",
    createdBy: S.user.email.toLowerCase(), createdAt: serverTimestamp(), historical: false
  });
  batch.delete(doc(db, "missing", productId));
  await batch.commit();
}
async function setMissing(productId, on) {
  if (on) await setDoc(doc(db, "missing", productId), { addedBy: myPersonId() || "", addedByEmail: S.user.email.toLowerCase(), addedAt: serverTimestamp() });
  else await deleteDoc(doc(db, "missing", productId));
}
async function importSeed() {
  if (S.purchases.some((p) => p.historical)) return toast("Dati del foglio già importati");
  const batch = writeBatch(db);
  SEED_PEOPLE.forEach((p) => { if (!person(p.id)) batch.set(doc(db, "people", p.id), { name: p.name, color: p.color, order: p.order }); });
  SEED_PRODUCTS.forEach(([id, name, emoji, category], i) => {
    if (!product(id)) batch.set(doc(db, "products", id), { name, emoji, category, order: i + 1, archived: false });
  });
  let n = 0;
  for (const [personId, counts] of Object.entries(SEED_COUNTS)) {
    counts.forEach((c, i) => {
      if (!c) return;
      n += c;
      batch.set(doc(collection(db, "purchases")), {
        productId: SEED_PRODUCTS[i][0], personId, count: c, date: null, note: "Importato dal foglio",
        createdBy: S.user.email.toLowerCase(), createdAt: serverTimestamp(), historical: true
      });
    });
  }
  await batch.commit();
  toast(`Importati ${n} acquisti dal foglio ✓`);
}

// ---------------------------------------------------------------- Bottom sheet
function openSheet(html, mount) {
  $sheet.innerHTML = `<div class="sheet-backdrop" data-close></div><div class="sheet" role="dialog"><div class="grab"></div>${html}</div>`;
  const el = $sheet.querySelector(".sheet");
  $sheet.querySelector("[data-close]").onclick = closeSheet;
  el.querySelectorAll("[data-dismiss]").forEach((b) => (b.onclick = closeSheet));
  mount && mount(el);
}
function closeSheet() { $sheet.innerHTML = ""; }
function confirmSheet(title, text, okLabel = "Conferma", danger = true) {
  return new Promise((resolve) => {
    openSheet(`<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
      <button class="btn big ${danger ? "warn" : "primary"}" data-ok>${esc(okLabel)}</button>
      <button class="btn big ghost" data-dismiss>Annulla</button>`, (el) => {
      el.querySelector("[data-ok]").onclick = () => { closeSheet(); resolve(true); };
      el.querySelectorAll("[data-dismiss]").forEach((b) => (b.onclick = () => { closeSheet(); resolve(false); }));
    });
  });
}

function openPurchase(productId) {
  const pr = product(productId); if (!pr) return;
  if (!S.people.length) return toast("Prima aggiungi le coinquiline (Admin)");
  const stats = computeStats();
  let chosen = myPersonId() || suggestedTurn(stats, productId)?.id;
  const chips = () => S.people.map((p) =>
    `<button class="chip ${p.id === chosen ? "on" : ""}" data-person="${p.id}"><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}</button>`).join("");
  openSheet(`
    <div class="row" style="margin-bottom:6px"><div class="emoji">${esc(pr.emoji || "📦")}</div>
      <div class="grow"><h2>${esc(pr.name)}</h2><div class="sub">Registra un acquisto</div></div></div>
    <label class="lbl">Chi l'ha comprato?</label><div class="chips" data-chips>${chips()}</div>
    <label class="lbl">Quando</label><input class="field" type="date" data-date value="${todayISO()}" max="${todayISO()}">
    <label class="lbl">Nota (facoltativa)</label><input class="field" data-note placeholder="es. offerta Lidl, 2 confezioni…" maxlength="120">
    <div style="height:18px"></div>
    <button class="btn big primary" data-save>✓ Registra acquisto</button>
    <button class="btn big ghost" data-dismiss>Annulla</button>`, (el) => {
    el.querySelector("[data-chips]").onclick = (e) => {
      const b = e.target.closest("[data-person]"); if (!b) return;
      chosen = b.dataset.person; el.querySelector("[data-chips]").innerHTML = chips();
    };
    el.querySelector("[data-save]").onclick = async (e) => {
      const iso = el.querySelector("[data-date]").value || todayISO();
      e.target.disabled = true;
      try {
        await registerPurchase(productId, chosen, iso, el.querySelector("[data-note]").value.trim());
        closeSheet(); toast(`${pr.emoji || "📦"} ${pr.name} registrato per ${person(chosen)?.name}`);
      } catch (err) { e.target.disabled = false; fail(err); }
    };
  });
}

function openAddMissing() {
  const list = activeProducts().filter((p) => !S.missing[p.id]);
  openSheet(`<h2>Cosa manca?</h2><div class="sub">Tocca un prodotto per aggiungerlo alla lista</div>
    <input class="search" style="margin-top:12px" placeholder="Cerca…" data-q>
    <div class="pick-list" data-list></div>`, (el) => {
    const draw = (q = "") => {
      const f = list.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
      el.querySelector("[data-list]").innerHTML = f.length ? f.map((p) =>
        `<button class="pick" data-id="${p.id}"><div class="emoji">${esc(p.emoji || "📦")}</div><div class="grow name">${esc(p.name)}</div><span class="muted">＋</span></button>`).join("")
        : `<div class="empty">Niente da aggiungere${isAdmin() ? " — crea nuovi prodotti da Admin" : ""}</div>`;
    };
    draw();
    el.querySelector("[data-q]").oninput = (e) => draw(e.target.value);
    el.querySelector("[data-list]").onclick = async (e) => {
      const b = e.target.closest("[data-id]"); if (!b) return;
      b.remove(); list.splice(list.findIndex((p) => p.id === b.dataset.id), 1);
      try { await setMissing(b.dataset.id, true); toast(`${product(b.dataset.id)?.name} aggiunto alla lista`); } catch (err) { fail(err); }
    };
  });
}

// ---------- Sheet admin
function openProductEdit(id) {
  const pr = id ? product(id) : { name: "", emoji: "", category: "", archived: false };
  const cats = [...new Set(S.products.map((p) => p.category).filter(Boolean))];
  const used = id && S.purchases.some((p) => p.productId === id);
  openSheet(`<h2>${id ? "Modifica prodotto" : "Nuovo prodotto"}</h2>
    <label class="lbl">Nome</label>
    <div class="form-row"><input class="field narrow" data-emoji value="${esc(pr.emoji)}" placeholder="📦" maxlength="4">
      <input class="field" data-name value="${esc(pr.name)}" placeholder="es. Detersivo lavatrice" maxlength="40"></div>
    <label class="lbl">Categoria</label>
    <input class="field" data-cat value="${esc(pr.category)}" list="cats" placeholder="Pulizia, Igiene, Cucina, Cibo…" maxlength="24">
    <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
    <div style="height:18px"></div>
    <button class="btn big primary" data-save>Salva</button>
    ${id ? `<button class="btn big ghost" data-archive>${pr.archived ? "↩︎ Riattiva prodotto" : "🗄 Archivia (nascondi)"}</button>` : ""}
    ${id && !used ? `<button class="btn big ghost" style="color:var(--warn)" data-del>Elimina definitivamente</button>` : ""}
    <button class="btn big ghost" data-dismiss>Annulla</button>`, (el) => {
    el.querySelector("[data-save]").onclick = async () => {
      const name = el.querySelector("[data-name]").value.trim();
      if (!name) return toast("Scrivi un nome");
      const data = { name, emoji: el.querySelector("[data-emoji]").value.trim() || "📦", category: el.querySelector("[data-cat]").value.trim() || "Altro" };
      try {
        if (id) await updateDoc(doc(db, "products", id), data);
        else {
          let nid = slug(name); while (product(nid)) nid += "-2";
          await setDoc(doc(db, "products", nid), { ...data, archived: false, order: Math.max(0, ...S.products.map((p) => p.order || 0)) + 1 });
        }
        closeSheet(); toast("Prodotto salvato ✓");
      } catch (e) { fail(e); }
    };
    el.querySelector("[data-archive]")?.addEventListener("click", async () => {
      try { await updateDoc(doc(db, "products", id), { archived: !pr.archived }); if (!pr.archived) await setMissing(id, false); closeSheet(); } catch (e) { fail(e); }
    });
    el.querySelector("[data-del]")?.addEventListener("click", async () => {
      try { await deleteDoc(doc(db, "products", id)); await setMissing(id, false); closeSheet(); toast("Prodotto eliminato"); } catch (e) { fail(e); }
    });
  });
}

const COLORS = ["#7c5cff", "#ff7a59", "#1fb58f", "#e6a400", "#e0458f", "#2d8cf0", "#6b7280"];
function openPersonEdit(id) {
  const p = id ? person(id) : { name: "", color: COLORS[S.people.length % COLORS.length] };
  let color = p.color;
  const sw = () => COLORS.map((c) => `<button class="avatar" data-c="${c}" style="background:${c};outline:${c === color ? "3px solid var(--ink)" : "none"};outline-offset:2px"></button>`).join("");
  openSheet(`<h2>${id ? "Modifica coinquilina" : "Nuova coinquilina"}</h2>
    <label class="lbl">Nome</label><input class="field" data-name value="${esc(p.name)}" maxlength="20">
    <label class="lbl">Colore</label><div class="chips" data-sw>${sw()}</div>
    <div style="height:18px"></div>
    <button class="btn big primary" data-save>Salva</button>
    <button class="btn big ghost" data-dismiss>Annulla</button>`, (el) => {
    el.querySelector("[data-sw]").onclick = (e) => { const b = e.target.closest("[data-c]"); if (b) { color = b.dataset.c; el.querySelector("[data-sw]").innerHTML = sw(); } };
    el.querySelector("[data-save]").onclick = async () => {
      const name = el.querySelector("[data-name]").value.trim(); if (!name) return toast("Scrivi un nome");
      try {
        if (id) await updateDoc(doc(db, "people", id), { name, color });
        else {
          let nid = slug(name); while (person(nid)) nid += "-2";
          await setDoc(doc(db, "people", nid), { name, color, order: Math.max(0, ...S.people.map((x) => x.order || 0)) + 1 });
        }
        closeSheet(); toast("Salvato ✓");
      } catch (e) { fail(e); }
    };
  });
}

function openMemberEdit(email) {
  const m = email ? S.members.find((x) => x.email === email) : { email: "", role: "member", personId: "" };
  const self = email && email === S.me.email;
  openSheet(`<h2>${email ? "Modifica accesso" : "Autorizza un account"}</h2>
    <label class="lbl">Email Google</label>
    <input class="field" data-email type="email" value="${esc(m.email)}" ${email ? "disabled" : ""} placeholder="nome@gmail.com" autocapitalize="off">
    <label class="lbl">È la coinquilina…</label>
    <select class="field" data-person><option value="">— nessuna (solo gestione) —</option>
      ${S.people.map((p) => `<option value="${p.id}" ${p.id === m.personId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
    <label class="lbl">Ruolo</label>
    <select class="field" data-role ${self ? "disabled" : ""}>
      <option value="member" ${m.role !== "admin" ? "selected" : ""}>Coinquilina (registra acquisti e lista)</option>
      <option value="admin" ${m.role === "admin" ? "selected" : ""}>Amministratore</option></select>
    <div style="height:18px"></div>
    <button class="btn big primary" data-save>Salva</button>
    ${email && !self ? `<button class="btn big ghost" style="color:var(--warn)" data-del>Revoca accesso</button>` : ""}
    <button class="btn big ghost" data-dismiss>Annulla</button>`, (el) => {
    el.querySelector("[data-save]").onclick = async () => {
      const em = (email || el.querySelector("[data-email]").value).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return toast("Email non valida");
      const data = { personId: el.querySelector("[data-person]").value, role: self ? "admin" : el.querySelector("[data-role]").value };
      try { await setDoc(doc(db, "members", em), data, { merge: true }); closeSheet(); toast("Accesso salvato ✓"); } catch (e) { fail(e); }
    };
    el.querySelector("[data-del]")?.addEventListener("click", async () => {
      if (!(await confirmSheet("Revocare l'accesso?", `${email} non potrà più entrare nell'app.`, "Revoca"))) return;
      try { await deleteDoc(doc(db, "members", email)); toast("Accesso revocato"); } catch (e) { fail(e); }
    });
  });
}

// ---------------------------------------------------------------- Viste
const TABS = [
  { id: "manca", ico: "📝", label: "Manca" },
  { id: "prodotti", ico: "🧺", label: "Prodotti" },
  { id: "registro", ico: "🧾", label: "Registro" },
  { id: "stats", ico: "📊", label: "Statistiche" }
];
const TITLES = { manca: "Manca in casa", prodotti: "Prodotti", registro: "Registro", stats: "Statistiche", admin: "Gestione" };

function viewManca(stats) {
  const items = Object.entries(S.missing).map(([id, m]) => ({ pr: product(id), m })).filter((x) => x.pr && !x.pr.archived)
    .sort((a, b) => (toDate(a.m.addedAt)?.getTime() || Date.now()) - (toDate(b.m.addedAt)?.getTime() || Date.now()));
  const add = `<button class="btn big primary" data-act="add-missing" style="margin:6px 0 4px">＋ Segna cosa manca</button>`;
  if (!S.products.length) return emptyFirstRun();
  if (!items.length) return `<div class="empty"><div class="hero">🎉</div><h3>Casa rifornita!</h3><p>Non manca niente. Se finisce qualcosa, segnalo qui.</p></div>${add}`;
  return `<div class="sub" style="margin:0 4px 10px">${items.length} ${items.length === 1 ? "cosa da comprare" : "cose da comprare"}</div>` +
    items.map(({ pr, m }) => {
      const turn = suggestedTurn(stats, pr.id);
      const last = stats.byProduct[pr.id]?.last;
      const who = person(m.addedBy);
      return `<div class="card"><div class="row">
        <div class="emoji">${esc(pr.emoji || "📦")}</div>
        <div class="grow"><div class="name">${esc(pr.name)}</div>
          <div class="sub">${turn ? `<span class="tag turn">Turno: ${esc(turn.name)}</span> ` : ""}${last ? `ultimo: <b>${esc(person(last.personId)?.name)}</b> ${fmtDay(last.date)}` : ""}</div>
          <div class="sub">segnato ${who ? `da ${esc(who.name)} ` : ""}${fmtDay(toDate(m.addedAt)) || "ora"}</div></div>
        <button class="btn ok" data-act="buy" data-id="${pr.id}">✓ Preso</button>
      </div></div>`;
    }).join("") + add;
}

function emptyFirstRun() {
  return `<div class="empty"><div class="hero">🏡</div><h3>Benvenuti!</h3>
    <p>${isAdmin() ? "Importa i dati dal foglio Google per partire con prodotti, coinquiline e i 42 acquisti già segnati." : "L'amministratore deve ancora configurare i prodotti."}</p>
    ${isAdmin() ? `<button class="btn big primary" data-act="import">⤵︎ Importa dati dal foglio</button>` : ""}</div>`;
}

function viewProdotti(stats) {
  if (!S.products.length) return emptyFirstRun();
  return `<input class="search" type="search" placeholder="🔍 Cerca un prodotto" value="${esc(S.search)}" data-search>
    <div data-grid>${productsGrid(stats)}</div>`;
}
function productsGrid(stats) {
  const q = S.search.toLowerCase();
  const list = activeProducts().filter((p) => p.name.toLowerCase().includes(q));
  if (!list.length) return `<div class="empty">Nessun prodotto trovato</div>`;
  const cats = [...new Set(list.map((p) => p.category || "Altro"))];
  return cats.map((c) => `<div class="section-title">${esc(c)}</div><div class="grid">` +
    list.filter((p) => (p.category || "Altro") === c).map((p) => {
      const miss = !!S.missing[p.id], last = stats.byProduct[p.id]?.last;
      return `<div class="pcard ${miss ? "missing" : ""}">
        <div class="top"><div class="emoji">${esc(p.emoji || "📦")}</div><div class="grow name">${esc(p.name)}</div></div>
        <div class="sub">${miss ? `<span class="tag" style="margin:0">Manca</span> ` : ""}${last ? `${esc(person(last.personId)?.name)} · ${fmtDay(last.date)}` : ((n) => `${n} ${n === 1 ? "acquisto" : "acquisti"}`)(stats.byProduct[p.id]?.total || 0)}</div>
        <div class="actions">
          <button class="btn ${miss ? "warn" : ""}" data-act="toggle-missing" data-id="${p.id}">${miss ? "✕ Tolto" : "Manca"}</button>
          <button class="btn ok" data-act="buy" data-id="${p.id}">✓ Preso</button>
        </div></div>`;
    }).join("") + `</div>`).join("");
}

function viewRegistro() {
  const f = S.logFilter;
  const list = S.purchases.filter((p) => f === "all" || p.personId === f);
  const chips = `<div class="chips"><button class="chip ${f === "all" ? "on" : ""}" data-filter="all">Tutte</button>` +
    S.people.map((p) => `<button class="chip ${f === p.id ? "on" : ""}" data-filter="${p.id}"><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}</button>`).join("") + `</div>`;
  if (!list.length) return chips + `<div class="empty"><div class="hero">🧾</div><h3>Nessun acquisto</h3><p>Gli acquisti registrati compariranno qui.</p></div>`;
  const dated = list.filter((p) => toDate(p.date)).sort((a, b) => toDate(b.date) - toDate(a.date) || (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
  const hist = list.filter((p) => !toDate(p.date));
  const item = (pu) => {
    const pr = product(pu.productId), pe = person(pu.personId);
    const canDel = isAdmin() || pu.createdBy === S.me.email;
    return `<div class="log-item"><div class="emoji">${esc(pr?.emoji || "📦")}</div>
      <div class="grow"><div class="name">${esc(pr?.name || "Prodotto rimosso")}${pu.count > 1 ? ` <span class="muted">×${pu.count}</span>` : ""}</div>
        <div class="sub"><span class="dot" style="background:${esc(pe?.color || "#999")}"></span> ${esc(pe?.name || "?")}${pu.note && !pu.historical ? ` · ${esc(pu.note)}` : ""}</div></div>
      ${canDel ? `<button class="btn icon ghost" data-act="del-purchase" data-id="${pu.id}" aria-label="Elimina">🗑</button>` : ""}</div>`;
  };
  let html = chips, day = "";
  for (const pu of dated) {
    const d = fmtDay(toDate(pu.date));
    if (d !== day) { if (day) html += `</div>`; html += `<div class="log-day">${d}</div><div class="card">`; day = d; }
    html += item(pu);
  }
  if (day) html += `</div>`;
  if (hist.length) html += `<div class="log-day">Storico dal foglio (senza data)</div><div class="card">${hist.map(item).join("")}</div>`;
  return html;
}

function viewStats(stats) {
  if (!S.purchases.length) return `<div class="empty"><div class="hero">📊</div><h3>Ancora niente</h3><p>Le statistiche si riempiono con i primi acquisti.</p></div>`;
  const ranking = [...S.people].sort((a, b) => (stats.byPerson[b.id] || 0) - (stats.byPerson[a.id] || 0));
  const top = ranking[0];
  const topProd = [...activeProducts()].sort((a, b) => (stats.byProduct[b.id]?.total || 0) - (stats.byProduct[a.id]?.total || 0))[0];
  const max = Math.max(1, ...Object.values(stats.byPerson));
  const la = stats.lastAny;
  let html = `<div class="kpis">
    <div class="kpi"><div class="label">📦 Totale acquisti</div><div class="value">${stats.total}</div></div>
    <div class="kpi"><div class="label">👑 Top coinquilina</div><div class="value small">${esc(top?.name || "—")}</div></div>
    <div class="kpi"><div class="label">🛒 Top prodotto</div><div class="value small">${esc(topProd ? topProd.emoji + " " + topProd.name : "—")}</div></div>
    <div class="kpi"><div class="label">🕒 Ultimo acquisto</div><div class="value small">${la ? `${esc(person(la.personId)?.name)}` : "—"}</div>
      <div class="sub">${la ? `${esc(product(la.productId)?.name)} · ${fmtDay(la.date)}` : "nessuno con data"}</div></div>
  </div>
  <div class="section-title">Chi ha comprato di più</div><div class="card">` +
    ranking.map((p) => `<div class="bar-row"><div class="lbl">${esc(p.name)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${((stats.byPerson[p.id] || 0) / max) * 100}%;background:${esc(p.color)}"></div></div>
      <div class="num">${stats.byPerson[p.id] || 0}</div></div>`).join("") + `</div>`;

  // Tabella prodotto × coinquilina (come nel foglio) + ultimo acquirente
  const prods = activeProducts().sort((a, b) => (stats.byProduct[b.id]?.total || 0) - (stats.byProduct[a.id]?.total || 0));
  html += `<div class="section-title">Per prodotto</div><div class="card"><div class="matrix-wrap"><table class="matrix">
    <thead><tr><th>Prodotto</th>${S.people.map((p) => `<th>${esc(p.name)}</th>`).join("")}<th>Tot</th><th>Ultimo</th></tr></thead><tbody>` +
    prods.map((pr) => {
      const b = stats.byProduct[pr.id] || { per: {}, total: 0 };
      const mx = Math.max(0, ...S.people.map((p) => b.per[p.id] || 0));
      return `<tr><td>${esc(pr.emoji || "")} ${esc(pr.name)}</td>` +
        S.people.map((p) => { const v = b.per[p.id] || 0; return `<td class="num ${v ? (v === mx ? "lead" : "") : "zero"}">${v}</td>`; }).join("") +
        `<td class="num lead">${b.total}</td><td class="sub">${b.last ? esc(person(b.last.personId)?.name) : "—"}</td></tr>`;
    }).join("") +
    `<tr class="tot"><td>Totale</td>${S.people.map((p) => `<td class="num">${stats.byPerson[p.id] || 0}</td>`).join("")}<td class="num">${stats.total}</td><td></td></tr>
    </tbody></table></div></div>`;
  return html;
}

function viewAdmin() {
  if (!isAdmin()) return "";
  const hasHist = S.purchases.some((p) => p.historical);
  return `
  <div class="section-title">Account autorizzati</div><div class="card">
    ${S.members.map((m) => `<div class="log-item" style="cursor:pointer" data-act="edit-member" data-id="${esc(m.email)}">
      ${avatar(person(m.personId), 38)}<div class="grow"><div class="name">${esc(m.email)}</div>
      <div class="sub">${m.role === "admin" ? "Amministratore" : "Coinquilina"}${person(m.personId) ? " · " + esc(person(m.personId).name) : ""}</div></div><span class="muted">›</span></div>`).join("")}
    <button class="btn big" style="margin-top:8px" data-act="new-member">＋ Autorizza un account Google</button></div>

  <div class="section-title">Coinquiline</div><div class="card">
    ${S.people.map((p) => `<div class="log-item" style="cursor:pointer" data-act="edit-person" data-id="${p.id}">${avatar(p, 38)}<div class="grow name">${esc(p.name)}</div><span class="muted">›</span></div>`).join("") || `<div class="sub">Nessuna ancora.</div>`}
    <button class="btn big" style="margin-top:8px" data-act="new-person">＋ Aggiungi coinquilina</button></div>

  <div class="section-title">Prodotti</div><div class="card">
    ${S.products.map((p) => `<div class="log-item" style="cursor:pointer;${p.archived ? "opacity:.5" : ""}" data-act="edit-product" data-id="${p.id}">
      <div class="emoji">${esc(p.emoji || "📦")}</div><div class="grow"><div class="name">${esc(p.name)}</div><div class="sub">${esc(p.category || "Altro")}${p.archived ? " · archiviato" : ""}</div></div><span class="muted">›</span></div>`).join("") || `<div class="sub">Nessuno ancora.</div>`}
    <button class="btn big" style="margin-top:8px" data-act="new-product">＋ Nuovo prodotto</button></div>

  <div class="section-title">Dati</div><div class="card">
    <button class="btn big ${hasHist ? "ghost" : "primary"}" data-act="import" ${hasHist ? "disabled" : ""}>${hasHist ? "✓ Dati del foglio già importati" : "⤵︎ Importa dati dal foglio Google"}</button></div>
  <div class="footer-ver">Tracker Casa v${VERSION}</div>`;
}

// ---------------------------------------------------------------- Render
function renderShell() {
  closeSheet();
  if (!configured) {
    $app.innerHTML = `<div class="center"><div class="login"><div class="logo">🛠️</div><h1>Quasi pronto</h1>
      <p>Manca la configurazione di Firebase: incolla i valori del tuo progetto nel file <b>firebase-config.js</b> e ripubblica.</p></div></div>`;
    return;
  }
  if (S.user === undefined) { $app.innerHTML = `<div class="splash"><div class="splash-logo">🏡</div></div>`; return; }
  if (!S.user) {
    $app.innerHTML = `<div class="center"><div class="login"><div class="logo">🏡</div><h1>Tracker Casa</h1>
      <p>Cosa manca, chi ha comprato cosa, e a chi tocca la prossima volta.</p>
      <button class="gbtn" data-act="login"><svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Accedi con Google</button>
      <div class="footer-ver">v${VERSION}</div></div></div>`;
    return;
  }
  if (!S.me) {
    $app.innerHTML = `<div class="center"><div class="login"><div class="logo">🔒</div><h1>Accesso non autorizzato</h1>
      <p>L'account <b>${esc(S.user.email)}</b> non è nella lista. Chiedi all'amministratore di aggiungerlo.</p>
      <button class="btn big" data-act="logout">Cambia account</button></div></div>`;
    return;
  }
  $app.innerHTML = `<header class="topbar"><h1 data-title></h1><button data-act="menu" aria-label="Profilo">${avatar(person(myPersonId()) || { name: S.user.displayName || S.user.email, color: "#5b4bdb" })}</button></header>
    <main data-main></main><nav class="tabbar" data-tabs></nav>`;
  render();
}

function render() {
  const main = $app.querySelector("[data-main]");
  if (!main) return;
  if (S.view === "admin" && !isAdmin()) S.view = "manca";
  const stats = computeStats();
  $app.querySelector("[data-title]").textContent = TITLES[S.view];
  const tabs = [...TABS, ...(isAdmin() ? [{ id: "admin", ico: "⚙️", label: "Admin" }] : [])];
  const missCount = Object.keys(S.missing).filter((id) => product(id) && !product(id).archived).length;
  $app.querySelector("[data-tabs]").innerHTML = tabs.map((t) =>
    `<button class="tab ${S.view === t.id ? "active" : ""}" data-tab="${t.id}"><span class="ico">${t.ico}</span>${t.label}${t.id === "manca" && missCount ? `<span class="badge">${missCount}</span>` : ""}</button>`).join("");
  const focused = document.activeElement?.matches?.("[data-search]");
  main.innerHTML = { manca: viewManca, prodotti: viewProdotti, registro: viewRegistro, stats: viewStats, admin: viewAdmin }[S.view](stats);
  if (focused) { const s = main.querySelector("[data-search]"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}

// ---------------------------------------------------------------- Eventi (delegati)
$app.addEventListener("click", async (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) { S.view = tab.dataset.tab; localStorage.setItem("view", S.view); render(); window.scrollTo({ top: 0 }); return; }
  const filt = e.target.closest("[data-filter]");
  if (filt) { S.logFilter = filt.dataset.filter; render(); return; }
  const a = e.target.closest("[data-act]"); if (!a) return;
  const id = a.dataset.id;
  try {
    switch (a.dataset.act) {
      case "login": return login();
      case "logout": return signOut(auth);
      case "menu":
        return openSheet(`<h2>${esc(S.user.displayName || "Profilo")}</h2><div class="sub">${esc(S.user.email)}${person(myPersonId()) ? ` · ${esc(person(myPersonId()).name)}` : ""}</div>
          <div style="height:16px"></div><button class="btn big" data-out>Esci</button><button class="btn big ghost" data-dismiss>Chiudi</button>
          <div class="footer-ver">Tracker Casa v${VERSION}</div>`, (el) => { el.querySelector("[data-out]").onclick = () => { closeSheet(); signOut(auth); }; });
      case "buy": return openPurchase(id);
      case "add-missing": return openAddMissing();
      case "toggle-missing": {
        const on = !S.missing[id]; await setMissing(id, on);
        return toast(on ? `${product(id)?.name} aggiunto a "Manca"` : `${product(id)?.name} tolto dalla lista`);
      }
      case "del-purchase": {
        const pu = S.purchases.find((p) => p.id === id);
        if (await confirmSheet("Eliminare l'acquisto?", `${product(pu?.productId)?.name || ""} di ${person(pu?.personId)?.name || ""}`, "Elimina"))
          await deleteDoc(doc(db, "purchases", id)), toast("Acquisto eliminato");
        return;
      }
      case "import": a.disabled = true; return importSeed();
      case "new-member": return openMemberEdit(null);
      case "edit-member": return openMemberEdit(id);
      case "new-person": return openPersonEdit(null);
      case "edit-person": return openPersonEdit(id);
      case "new-product": return openProductEdit(null);
      case "edit-product": return openProductEdit(id);
    }
  } catch (err) { fail(err); }
});
$app.addEventListener("input", (e) => {
  if (e.target.matches("[data-search]")) {
    S.search = e.target.value;
    $app.querySelector("[data-grid]").innerHTML = productsGrid(computeStats());
  }
});

// ---------------------------------------------------------------- Avvio
S.user = configured ? undefined : null;
renderShell();
if (configured) {
  getRedirectResult(auth).catch(fail);
  onAuthStateChanged(auth, async (u) => {
    stopListeners();
    S.user = u; S.me = null;
    if (u) {
      try {
        const snap = await getDoc(doc(db, "members", u.email.toLowerCase()));
        if (snap.exists()) { S.me = { email: snap.id, ...snap.data() }; }
      } catch (e) { if (e.code !== "permission-denied") fail(e); }
      renderShell();
      if (S.me) startListeners();
    } else renderShell();
  });
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
