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
import { writeXlsx, readXlsx } from "./xlsx.js";

// ---------------------------------------------------------------- Stato
const S = {
  user: null, me: null,               // utente Firebase e documento members
  people: [], products: [], purchases: [], missing: {}, members: [], requests: [],
  view: localStorage.getItem("view") || "manca",
  logFilter: "all", search: "",
  loaded: {},                         // raccolte già arrivate dal database
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
// Partecipanti di un prodotto: lista vuota/assente = tutte le coinquiline
const participantIds = (pr) => (pr && pr.participants && pr.participants.length ? pr.participants.filter((id) => person(id)) : S.people.map((p) => p.id));
const participants = (pr) => S.people.filter((p) => participantIds(pr).includes(p.id));
const isShared = (pr) => !(pr && pr.participants && pr.participants.length && pr.participants.length < S.people.length);
// Ogni coinquilina vede solo i prodotti a cui partecipa (l'admin senza persona collegata vede tutto)
const canSee = (pr) => !!pr && (!myPersonId() || participantIds(pr).includes(myPersonId()));
const visibleProducts = () => activeProducts().filter(canSee);
const visiblePurchases = () => S.purchases.filter((pu) => canSee(product(pu.productId)));
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
  for (const pu of visiblePurchases()) {
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
  return participants(product(productId)).sort((a, b2) =>
    (b.per[a.id] || 0) - (b.per[b2.id] || 0) ||
    ((lastBy[a.id]?.getTime() || 0) - (lastBy[b2.id]?.getTime() || 0)) ||
    (a.order || 0) - (b2.order || 0)
  )[0];
}
// Tutte quelle a cui tocca: chi ha comprato meno volte quel prodotto (a pari merito, tutte).
function turnPeople(stats, productId) {
  const b = stats.byProduct[productId] || { per: {} };
  const who = participants(product(productId));
  if (!who.length) return [];
  const min = Math.min(...who.map((p) => b.per[p.id] || 0));
  return who.filter((p) => (b.per[p.id] || 0) === min);
}
const joinNames = (list) => list.length < 2 ? (list[0]?.name || "") : list.slice(0, -1).map((p) => p.name).join(", ") + " e " + list[list.length - 1].name;

// ---------------------------------------------------------------- Firebase
// Su Firebase Hosting la configurazione arriva da sola (/__/firebase/init.json): non serve incollarla.
// iPhone: Safari blocca i cookie di terze parti, quindi il login usa lo stesso dominio dell'app e il redirect.
const hosted = /\.(web\.app|firebaseapp\.com)$/.test(location.hostname);
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let cfg = firebaseConfig;
if (hosted) {
  try { const r = await fetch("/__/firebase/init.json"); if (r.ok) cfg = await r.json(); } catch (e) { console.warn(e); }
}
const configured = !!cfg.apiKey && !cfg.apiKey.includes("INCOLLA");
let auth, db;
if (configured) {
  // authDomain resta quello di Firebase (progetto.firebaseapp.com), già autorizzato da Google:
  // con il login a popup funziona anche su iPhone senza configurazioni extra.
  const app = initializeApp(cfg);
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
  S.loaded = {};
  const listen = (name, fn) => S.unsub.push(onSnapshot(collection(db, name), (snap) => { S.loaded[name] = true; fn(snap); }, fail));
  listen("people", (snap) => { S.people = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(sortByOrder); render(); });
  listen("products", (snap) => { S.products = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(sortByOrder); render(); });
  listen("purchases", (snap) => { S.purchases = snap.docs.map((d) => ({ id: d.id, ...d.data() })); render(); });
  listen("missing", (snap) => { S.missing = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()])); render(); });
  if (isAdmin()) {
    listen("members", (snap) => { S.members = snap.docs.map((d) => ({ email: d.id, ...d.data() })); render(); });
    listen("requests", (snap) => { S.requests = snap.docs.map((d) => ({ email: d.id, ...d.data() })); render(); });
  }
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
// ID fissi per lo storico del foglio ("seed-persona-prodotto"): anche se l'import parte due volte
// (doppio tocco, due telefoni, dati non ancora caricati) riscrive gli stessi documenti invece di duplicarli.
const seedId = (personId, productId) => `seed-${personId}-${productId}`;
let importing = false;
async function importSeed() {
  if (importing) return;
  if (!S.loaded.purchases || !S.loaded.products) return toast("Attendi il caricamento dei dati…");
  if (S.purchases.some((p) => p.historical)) return toast("Dati del foglio già importati");
  importing = true;
  try {
    const batch = writeBatch(db);
    SEED_PEOPLE.forEach((p) => { if (!person(p.id)) batch.set(doc(db, "people", p.id), { name: p.name, fullName: p.fullName, color: p.color, order: p.order }); });
    SEED_PRODUCTS.forEach(([id, name, emoji, category, parts], i) => {
      if (!product(id)) batch.set(doc(db, "products", id), { name, emoji, category, participants: parts || [], order: i + 1, archived: false });
    });
    let n = 0;
    for (const [personId, counts] of Object.entries(SEED_COUNTS)) {
      counts.forEach((c, i) => {
        if (!c) return;
        n += c;
        const productId = SEED_PRODUCTS[i][0];
        batch.set(doc(db, "purchases", seedId(personId, productId)), {
          productId, personId, count: c, date: null, note: "Importato dal foglio",
          createdBy: S.user.email.toLowerCase(), createdAt: serverTimestamp(), historical: true
        });
      });
    }
    await batch.commit();
    toast(`Importati ${n} acquisti dal foglio ✓`);
  } finally { importing = false; }
}

// Doppioni dello storico: stessa coinquilina + stesso prodotto importati più volte.
// Ne resta uno solo (quello con ID fisso, altrimenti il primo creato).
function seedDuplicates() {
  const groups = {};
  for (const pu of S.purchases) if (pu.historical) (groups[pu.personId + "|" + pu.productId] ||= []).push(pu);
  const extra = [];
  for (const list of Object.values(groups)) {
    if (list.length < 2) continue;
    list.sort((a, b) => (b.id === seedId(b.personId, b.productId)) - (a.id === seedId(a.personId, a.productId)) ||
      (toDate(a.createdAt)?.getTime() || 0) - (toDate(b.createdAt)?.getTime() || 0) || a.id.localeCompare(b.id));
    extra.push(...list.slice(1));
  }
  return extra;
}
async function removeSeedDuplicates() {
  const extra = seedDuplicates();
  if (!extra.length) return toast("Nessun doppione");
  const n = extra.reduce((s, p) => s + weight(p), 0);
  if (!(await confirmSheet("Eliminare i doppioni?", `Lo storico del foglio risulta importato due volte: tolgo ${extra.length} righe doppie (${n} acquisti contati in più). Gli acquisti registrati nell'app non vengono toccati.`, "Elimina doppioni"))) return;
  await commitInChunks(extra.map((p) => (b) => b.delete(doc(db, "purchases", p.id))));
  toast(`Doppioni eliminati: ${extra.length} ✓`);
}

// Scritture in blocchi (Firestore accetta al massimo 500 operazioni per batch)
async function commitInChunks(ops, size = 400) {
  for (let i = 0; i < ops.length; i += size) {
    const batch = writeBatch(db);
    ops.slice(i, i + size).forEach((op) => op(batch));
    await batch.commit();
  }
}

// ---------------------------------------------------------------- Backup Excel
// Fogli e colonne del backup: il ripristino legge le colonne per nome, quindi l'ordine può cambiare.
// Le colonne "ID" collegano le righe tra loro: non vanno modificate (righe nuove: ID vuoto).
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const yn = (b) => (b ? "SÌ" : "NO");
const isYes = (v) => v === true || /^(s|si|sì|yes|y|true|1|x|vero)$/i.test(String(v ?? "").trim());
const str = (v) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v).trim());
const num = (v, d = 0) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : d; };
function cellDate(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  const t = str(v); if (!t) return null;
  let m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(t);
  if (m) return new Date(+m[3] < 100 ? 2000 + +m[3] : +m[3], m[2] - 1, +m[1], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0);
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) { const d = new Date(t); return isNaN(d) ? new Date(+m[1], m[2] - 1, +m[3], 12) : d; }
  return null;
}
const stamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}`; };

function buildBackup() {
  const pName = (id) => person(id)?.name || "";
  const prName = (id) => product(id)?.name || "";
  const memberOf = (pid) => S.members.find((m) => m.personId === pid)?.email || "";
  const purchases = [...S.purchases].sort((a, b) =>
    (toDate(a.date)?.getTime() ?? -Infinity) - (toDate(b.date)?.getTime() ?? -Infinity) ||
    (toDate(a.createdAt)?.getTime() || 0) - (toDate(b.createdAt)?.getTime() || 0));
  const totPer = {}, totProd = {}, cell = {};
  for (const pu of S.purchases) {
    const w = weight(pu);
    totPer[pu.personId] = (totPer[pu.personId] || 0) + w;
    totProd[pu.productId] = (totProd[pu.productId] || 0) + w;
    cell[pu.productId + "|" + pu.personId] = (cell[pu.productId + "|" + pu.personId] || 0) + w;
  }
  const lastOf = (prId) => S.purchases.filter((p) => p.productId === prId && toDate(p.date)).sort((a, b) => toDate(b.date) - toDate(a.date))[0];
  const total = Object.values(totPer).reduce((a, b) => a + b, 0);
  const sheets = [
    { name: "Info", widths: [26, 70], header: true, rows: [
      ["Tracker Casa — backup", ""],
      ["Versione app", VERSION],
      ["Esportato il", new Date()],
      ["Esportato da", S.user.email],
      ["Coinquiline", S.people.length],
      ["Prodotti", S.products.length],
      ["Righe acquisto", S.purchases.length],
      ["Acquisti contati", total],
      ["Cose che mancano", Object.keys(S.missing).length],
      ["Account", S.members.length],
      ["", ""],
      ["Come ripristinare", "App → Admin → Dati → Ripristina da Excel, poi scegli questo file."],
      ["Colonne ID", "Collegano le righe tra i fogli: non modificarle. Per aggiungere una riga a mano lascia l'ID vuoto."],
      ["Riepilogo", "Il foglio Riepilogo è solo da leggere: al ripristino viene ignorato."]
    ] },
    { name: "Coinquiline", widths: [14, 16, 18, 10, 8, 32], header: true, rows: [
      ["ID", "Soprannome", "Nome vero", "Colore", "Ordine", "Account Google"],
      ...S.people.map((p) => [p.id, p.name, p.fullName || "", p.color || "", p.order ?? "", memberOf(p.id)])
    ] },
    { name: "Prodotti", widths: [24, 7, 26, 12, 22, 24, 8, 11], header: true, rows: [
      ["ID", "Emoji", "Nome", "Categoria", "Partecipanti ID", "Partecipanti", "Ordine", "Archiviato"],
      ...S.products.map((p) => [p.id, p.emoji || "", p.name, p.category || "", (p.participants || []).join(", "),
        p.participants?.length ? p.participants.map(pName).join(", ") : "Tutte", p.order ?? "", yn(p.archived)])
    ] },
    { name: "Acquisti", widths: [24, 12, 22, 22, 14, 14, 9, 9, 30, 30, 17], header: true, rows: [
      ["ID", "Data", "Prodotto ID", "Prodotto", "Coinquilina ID", "Coinquilina", "Quantità", "Storico", "Nota", "Registrato da", "Registrato il"],
      ...purchases.map((pu) => [pu.id, toDate(pu.date), pu.productId, prName(pu.productId), pu.personId, pName(pu.personId),
        weight(pu), yn(pu.historical), pu.note || "", pu.createdBy || "", toDate(pu.createdAt)])
    ] },
    { name: "Manca", widths: [24, 22, 14, 14, 30, 17], header: true, rows: [
      ["Prodotto ID", "Prodotto", "Segnato da ID", "Segnato da", "Email", "Segnato il"],
      ...Object.entries(S.missing).map(([id, m]) => [id, prName(id), m.addedBy || "", pName(m.addedBy), m.addedByEmail || "", toDate(m.addedAt)])
    ] },
    { name: "Account", widths: [32, 12, 14, 14], header: true, rows: [
      ["Email", "Ruolo", "Coinquilina ID", "Coinquilina"],
      ...S.members.map((m) => [m.email, m.role === "admin" ? "admin" : "member", m.personId || "", pName(m.personId)])
    ] },
    { name: "Riepilogo", widths: [26, ...S.people.map(() => 11), 8, 14, 12], header: true, rows: [
      ["Prodotto", ...S.people.map((p) => p.name), "Totale", "Ultimo", "Ultima data"],
      ...[...S.products].sort((a, b) => (totProd[b.id] || 0) - (totProd[a.id] || 0)).map((pr) => {
        const l = lastOf(pr.id);
        return [`${pr.emoji || ""} ${pr.name}`.trim(), ...S.people.map((p) => cell[pr.id + "|" + p.id] || 0), totProd[pr.id] || 0, l ? pName(l.personId) : "", l ? toDate(l.date) : null];
      }),
      ["Totale", ...S.people.map((p) => totPer[p.id] || 0), total, "", null]
    ] }
  ];
  return writeXlsx(sheets);
}

async function saveFile(bytes, name) {
  const file = new File([bytes], name, { type: XLSX_TYPE });
  // iPhone: il pannello Condividi permette "Salva in File", AirDrop, Mail…
  if (isIOS && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (e) { if (e.name === "AbortError") return false; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}

async function exportBackup() {
  if (!S.loaded.purchases || !S.loaded.products || !S.loaded.people) return toast("Attendi il caricamento dei dati…");
  const ok = await saveFile(buildBackup(), `tracker-casa-backup_${stamp()}.xlsx`);
  if (ok) { localStorage.setItem("lastBackup", new Date().toISOString()); render(); toast("Backup Excel pronto ✓"); }
}

// Righe di un foglio → oggetti { "intestazione in minuscolo": valore }
function sheetObjects(book, name) {
  const key = Object.keys(book).find((k) => k.trim().toLowerCase() === name.toLowerCase());
  if (!key) return null;
  const [head = [], ...rows] = book[key];
  const h = head.map((x) => str(x).toLowerCase());
  return rows.filter((r) => r && r.some((v) => str(v) !== "")).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

function parseBackup(book) {
  const people = sheetObjects(book, "Coinquiline"), products = sheetObjects(book, "Prodotti"),
    purchases = sheetObjects(book, "Acquisti"), missing = sheetObjects(book, "Manca"), members = sheetObjects(book, "Account");
  if (!people && !products && !purchases) throw new Error("Nel file non trovo i fogli Coinquiline, Prodotti e Acquisti: è un backup di Tracker Casa?");
  const warn = [];
  const out = { people: null, products: null, purchases: null, missing: null, members: null, warn };
  const takenP = new Set(), takenPr = new Set();
  if (people) out.people = people.filter((r) => str(r["soprannome"]) || str(r["id"])).map((r, i) => {
    let id = str(r["id"]) || slug(str(r["soprannome"]));
    while (takenP.has(id) && !str(r["id"])) id += "-2";
    takenP.add(id);
    return { id, data: { name: str(r["soprannome"]) || id, fullName: str(r["nome vero"]), color: str(r["colore"]) || COLORS[i % COLORS.length], order: num(r["ordine"], i + 1) } };
  });
  const personIds = new Set([...(out.people || []).map((p) => p.id), ...(out.people ? [] : S.people.map((p) => p.id))]);
  const personByName = (n) => (out.people || S.people.map((p) => ({ id: p.id, data: p }))).find((p) => p.data.name.toLowerCase() === n.toLowerCase())?.id;
  if (products) out.products = products.filter((r) => str(r["nome"]) || str(r["id"])).map((r, i) => {
    let id = str(r["id"]) || slug(str(r["nome"]));
    while (takenPr.has(id) && !str(r["id"])) id += "-2";
    takenPr.add(id);
    const parts = str(r["partecipanti id"]).split(/[,;]/).map((x) => x.trim()).filter((x) => x && personIds.has(x));
    return { id, data: { name: str(r["nome"]) || id, emoji: str(r["emoji"]) || "📦", category: str(r["categoria"]) || "Altro",
      participants: parts.length >= personIds.size ? [] : parts, order: num(r["ordine"], i + 1), archived: isYes(r["archiviato"]) } };
  });
  const productIds = new Set([...(out.products || []).map((p) => p.id), ...(out.products ? [] : S.products.map((p) => p.id))]);
  const productByName = (n) => (out.products || S.products.map((p) => ({ id: p.id, data: p }))).find((p) => p.data.name.toLowerCase() === n.toLowerCase())?.id;
  const me = S.user.email.toLowerCase();
  if (purchases) {
    out.purchases = [];
    let skipped = 0;
    purchases.forEach((r) => {
      const productId = str(r["prodotto id"]) || productByName(str(r["prodotto"])) || "";
      const personId = str(r["coinquilina id"]) || personByName(str(r["coinquilina"])) || "";
      if (!productIds.has(productId) || !personIds.has(personId)) { skipped++; return; }
      const historical = isYes(r["storico"]);
      const date = cellDate(r["data"]);
      const q = Math.max(1, Math.round(num(r["quantità"] ?? r["quantita"], 1)));
      const created = cellDate(r["registrato il"]);
      const data = { productId, personId, date: date ? Timestamp.fromDate(date) : null, note: str(r["nota"]), historical,
        createdBy: str(r["registrato da"]).toLowerCase() || me, createdAt: created ? Timestamp.fromDate(created) : serverTimestamp() };
      if (q > 1 || historical) data.count = q;
      out.purchases.push({ id: str(r["id"]) || doc(collection(db, "purchases")).id, data });
    });
    if (skipped) warn.push(`${skipped} righe di acquisto saltate (prodotto o coinquilina non trovati)`);
  }
  if (missing) out.missing = missing.filter((r) => productIds.has(str(r["prodotto id"]) || productByName(str(r["prodotto"])) || "")).map((r) => {
    const added = cellDate(r["segnato il"]);
    return { id: str(r["prodotto id"]) || productByName(str(r["prodotto"])),
      data: { addedBy: personIds.has(str(r["segnato da id"])) ? str(r["segnato da id"]) : "", addedByEmail: str(r["email"]).toLowerCase() || me,
        addedAt: added ? Timestamp.fromDate(added) : serverTimestamp() } };
  });
  if (members) out.members = members.filter((r) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(r["email"]))).map((r) => {
    const email = str(r["email"]).toLowerCase();
    const pid = str(r["coinquilina id"]);
    return { id: email, data: { role: email === me ? "admin" : (str(r["ruolo"]).toLowerCase() === "admin" ? "admin" : "member"), personId: personIds.has(pid) ? pid : "" } };
  });
  return out;
}

async function restoreBackup(plan, replace) {
  const ops = [];
  const sets = { people: plan.people, products: plan.products, purchases: plan.purchases, missing: plan.missing };
  for (const [col, list] of Object.entries(sets)) {
    if (!list) continue; // foglio assente nel file: quella parte non si tocca
    list.forEach((x) => ops.push((b) => b.set(doc(db, col, x.id), x.data)));
    if (replace) {
      const keep = new Set(list.map((x) => x.id));
      const current = col === "missing" ? Object.keys(S.missing) : S[col].map((x) => x.id);
      current.filter((id) => !keep.has(id)).forEach((id) => ops.push((b) => b.delete(doc(db, col, id))));
    }
  }
  // Account: solo aggiunti/aggiornati, mai tolti (così nessuno resta chiuso fuori per errore)
  (plan.members || []).forEach((x) => ops.push((b) => b.set(doc(db, "members", x.id), x.data, { merge: true })));
  await commitInChunks(ops);
}

function pickBackupFile() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".xlsx," + XLSX_TYPE; inp.style.display = "none";
  document.body.appendChild(inp);
  inp.onchange = async () => {
    const f = inp.files && inp.files[0]; inp.remove();
    if (!f) return;
    let plan;
    try { plan = parseBackup(await readXlsx(await f.arrayBuffer())); } catch (e) { return toast(e.message || "File non valido"); }
    const n = (l) => (l ? l.length : "—");
    const w = (plan.purchases || []).reduce((s, x) => s + (x.data.count || 1), 0);
    openSheet(`<h2>Ripristina da Excel</h2><div class="sub">${esc(f.name)}</div>
      <div class="card" style="margin-top:12px">
        <div class="log-item"><div class="grow">👭 Coinquiline</div><b>${n(plan.people)}</b></div>
        <div class="log-item"><div class="grow">📦 Prodotti</div><b>${n(plan.products)}</b></div>
        <div class="log-item"><div class="grow">🧾 Acquisti</div><b>${n(plan.purchases)}${plan.purchases ? ` <span class="muted">(${w} contati)</span>` : ""}</b></div>
        <div class="log-item"><div class="grow">🛒 Mancano</div><b>${n(plan.missing)}</b></div>
        <div class="log-item"><div class="grow">🔑 Account</div><b>${n(plan.members)}</b></div>
      </div>
      ${plan.warn.map((x) => `<div class="sub" style="color:var(--warn);margin:4px 2px">⚠️ ${esc(x)}</div>`).join("")}
      <p class="muted" style="margin:10px 2px"><b>Unisci</b>: aggiunge e aggiorna usando gli ID del file, senza creare doppioni.<br>
      <b>Sostituisci</b>: l'app diventa uguale al file (cancella quello che nel file non c'è). Gli account non vengono mai tolti.</p>
      <button class="btn big primary" data-merge>⤵︎ Unisci</button>
      <button class="btn big warn" data-replace>Sostituisci tutto</button>
      <button class="btn big ghost" data-dismiss>Annulla</button>`, (el) => {
      const run = async (replace, btn) => {
        if (replace && !(await confirmSheet("Sostituire tutti i dati?", "Quello che c'è nell'app e non nel file verrà cancellato. Se non hai un backup recente, esportalo prima.", "Sostituisci"))) return;
        btn.disabled = true;
        try { await restoreBackup(plan, replace); closeSheet(); toast("Dati ripristinati ✓"); }
        catch (e) {
          btn.disabled = false;
          if (e?.code === "permission-denied") toast("Permesso negato: aggiorna le regole Firestore (vedi README)"); else fail(e);
        }
      };
      el.querySelector("[data-merge]").onclick = (e) => run(false, e.target);
      el.querySelector("[data-replace]").onclick = (e) => run(true, e.target);
    });
  };
  inp.click();
}

async function approveRequest(email, personId) {
  const batch = writeBatch(db);
  batch.set(doc(db, "members", email), { role: "member", personId });
  batch.delete(doc(db, "requests", email));
  await batch.commit();
  toast(`${person(personId)?.name} può entrare ✓`);
}

// ---------------------------------------------------------------- Bottom sheet
let sheetToken = 0;
function openSheet(html, mount) {
  sheetToken++;
  $sheet.innerHTML = `<div class="sheet-backdrop" data-close></div><div class="sheet" role="dialog" aria-modal="true">
    <div class="grab-zone" data-grab><div class="grab"></div></div>
    <button class="sheet-x" data-x aria-label="Chiudi"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>${html}</div>`;
  const el = $sheet.querySelector(".sheet");
  $sheet.querySelector("[data-close]").onclick = closeSheet;
  el.querySelector("[data-x]").onclick = closeSheet;
  el.querySelector("[data-grab]").onclick = closeSheet;
  el.querySelectorAll("[data-dismiss]").forEach((b) => (b.onclick = closeSheet));
  enableSheetDrag(el);
  mount && mount(el);
}
function closeSheet() {
  const el = $sheet.querySelector(".sheet");
  if (!el) return;
  const token = sheetToken;
  el.style.transition = ""; el.style.transform = "";
  $sheet.classList.add("closing");
  setTimeout(() => { if (token === sheetToken) $sheet.innerHTML = ""; $sheet.classList.remove("closing"); }, 260);
}
// Trascina giù il pannello per chiuderlo (come su iOS)
function enableSheetDrag(el) {
  const bd = $sheet.querySelector(".sheet-backdrop");
  let y0 = null, dy = 0, t0 = 0, dragging = false;
  el.addEventListener("touchstart", (e) => {
    if (el.scrollTop > 0 && !e.target.closest("[data-grab]")) { y0 = null; return; }
    y0 = e.touches[0].clientY; t0 = Date.now(); dy = 0; dragging = false;
  }, { passive: true });
  el.addEventListener("touchmove", (e) => {
    if (y0 === null) return;
    dy = e.touches[0].clientY - y0;
    if (!dragging && dy > 6) { dragging = true; el.style.transition = "none"; }
    if (!dragging) { if (dy < 0) y0 = null; return; }
    e.preventDefault();
    const d = Math.max(0, dy);
    el.style.transform = `translateY(${d}px)`;
    bd.style.opacity = String(Math.max(0.15, 1 - d / 400));
  }, { passive: false });
  el.addEventListener("touchend", () => {
    if (y0 === null || !dragging) { y0 = null; return; }
    const v = dy / Math.max(1, Date.now() - t0);
    y0 = null; dragging = false;
    el.style.transition = "transform .3s cubic-bezier(.2,.9,.3,1)"; bd.style.opacity = "";
    if (dy > 110 || v > 0.6) closeSheet();
    else el.style.transform = "";
  });
}
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
  const who = participants(pr);
  let chosen = who.some((p) => p.id === myPersonId()) ? myPersonId() : suggestedTurn(stats, productId)?.id;
  const chips = () => who.map((p) =>
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
  const list = visibleProducts().filter((p) => !S.missing[p.id]);
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
  let parts = isShared(pr) ? [] : [...participantIds(pr)];
  const partChips = () => `<button class="chip ${parts.length ? "" : "on"}" data-part="">Tutte</button>` +
    S.people.map((p) => `<button class="chip ${parts.includes(p.id) ? "on" : ""}" data-part="${p.id}"><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}</button>`).join("");
  openSheet(`<h2>${id ? "Modifica prodotto" : "Nuovo prodotto"}</h2>
    <label class="lbl">Nome</label>
    <div class="form-row"><input class="field narrow" data-emoji value="${esc(pr.emoji)}" placeholder="📦" maxlength="4">
      <input class="field" data-name value="${esc(pr.name)}" placeholder="es. Detersivo lavatrice" maxlength="40"></div>
    <label class="lbl">Categoria</label>
    <input class="field" data-cat value="${esc(pr.category)}" list="cats" placeholder="Pulizia, Igiene, Cucina, Cibo…" maxlength="24">
    <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
    <label class="lbl">Chi lo compra e lo vede?</label><div class="chips" data-parts>${partChips()}</div>
    <div class="sub" style="margin:0 2px">Es. i prodotti del bagno in comune: solo chi lo condivide.</div>
    <div style="height:18px"></div>
    <button class="btn big primary" data-save>Salva</button>
    ${id ? `<button class="btn big ghost" data-archive>${pr.archived ? "↩︎ Riattiva prodotto" : "🗄 Archivia (nascondi)"}</button>` : ""}
    ${id && !used ? `<button class="btn big ghost" style="color:var(--warn)" data-del>Elimina definitivamente</button>` : ""}
    <button class="btn big ghost" data-dismiss>Annulla</button>`, (el) => {
    el.querySelector("[data-save]").onclick = async () => {
      const name = el.querySelector("[data-name]").value.trim();
      if (!name) return toast("Scrivi un nome");
      const data = { name, emoji: el.querySelector("[data-emoji]").value.trim() || "📦", category: el.querySelector("[data-cat]").value.trim() || "Altro", participants: parts };
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
    el.querySelector("[data-parts]").onclick = (e) => {
      const b = e.target.closest("[data-part]"); if (!b) return;
      const pid = b.dataset.part;
      if (!pid) parts = [];
      else parts = parts.includes(pid) ? parts.filter((x) => x !== pid) : [...parts, pid];
      if (parts.length >= S.people.length) parts = [];
      el.querySelector("[data-parts]").innerHTML = partChips();
    };
  });
}

const COLORS = ["#7c5cff", "#ff7a59", "#1fb58f", "#e6a400", "#e0458f", "#2d8cf0", "#6b7280"];
function openPersonEdit(id) {
  const p = id ? person(id) : { name: "", color: COLORS[S.people.length % COLORS.length] };
  let color = p.color;
  const sw = () => COLORS.map((c) => `<button class="avatar" data-c="${c}" style="background:${c};outline:${c === color ? "3px solid var(--ink)" : "none"};outline-offset:2px"></button>`).join("");
  openSheet(`<h2>${id ? "Modifica coinquilina" : "Nuova coinquilina"}</h2>
    <label class="lbl">Soprannome (quello che si vede nell'app)</label><input class="field" data-name value="${esc(p.name)}" maxlength="20">
    <label class="lbl">Nome vero (facoltativo)</label><input class="field" data-full value="${esc(p.fullName || "")}" maxlength="30">
    <label class="lbl">Colore</label><div class="chips" data-sw>${sw()}</div>
    <div style="height:18px"></div>
    <button class="btn big primary" data-save>Salva</button>
    <button class="btn big ghost" data-dismiss>Annulla</button>`, (el) => {
    el.querySelector("[data-sw]").onclick = (e) => { const b = e.target.closest("[data-c]"); if (b) { color = b.dataset.c; el.querySelector("[data-sw]").innerHTML = sw(); } };
    el.querySelector("[data-save]").onclick = async () => {
      const name = el.querySelector("[data-name]").value.trim(); if (!name) return toast("Scrivi un nome");
      try {
        const fullName = el.querySelector("[data-full]").value.trim();
        if (id) await updateDoc(doc(db, "people", id), { name, fullName, color });
        else {
          let nid = slug(name); while (person(nid)) nid += "-2";
          await setDoc(doc(db, "people", nid), { name, fullName, color, order: Math.max(0, ...S.people.map((x) => x.order || 0)) + 1 });
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
  { id: "manca", label: "Manca" },
  { id: "prodotti", label: "Prodotti" },
  { id: "registro", label: "Registro" },
  { id: "stats", label: "Statistiche" }
];
const ICONS = {
  manca: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M3.5 6l1.5 1.5L8 4.5M3.5 12l1.5 1.5L8 10.5M3.5 18l1.5 1.5L8 16.5"/>',
  prodotti: '<path d="M4 10h16l-1.6 8.6A2 2 0 0 1 16.4 20H7.6a2 2 0 0 1-2-1.4L4 10z"/><path d="M8 10l4-6 4 6M9.5 14v2.5M14.5 14v2.5"/>',
  registro: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  stats: '<path d="M5 20v-7M12 20V5M19 20v-10"/>',
  admin: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'
};

// Barra in basso "a capsula" in stile iOS: i pulsanti restano gli stessi, la pillola scorre sotto quello attivo.
function renderTabs(missCount) {
  const nav = $app.querySelector("[data-tabs]");
  const tabs = [...TABS, ...(isAdmin() ? [{ id: "admin", label: "Admin" }] : [])];
  const key = tabs.map((t) => t.id).join();
  if (nav.dataset.key !== key) {
    nav.dataset.key = key;
    nav.innerHTML = `<span class="tab-pill" aria-hidden="true"></span>` + tabs.map((t) =>
      `<button class="tab" data-tab="${t.id}"><span class="ico"><svg viewBox="0 0 24 24">${ICONS[t.id]}</svg><span class="badge" hidden></span></span><span class="lbl">${t.label}</span></button>`).join("");
    nav.classList.add("no-anim");
  }
  nav.querySelectorAll(".tab").forEach((b) => {
    const on = b.dataset.tab === S.view;
    b.classList.toggle("active", on);
    b.setAttribute("aria-current", on ? "page" : "false");
    const n = b.dataset.tab === "manca" ? missCount : b.dataset.tab === "admin" ? S.requests.length : 0;
    const badge = b.querySelector(".badge");
    if (String(n) !== badge.textContent && n) { badge.classList.remove("bump"); void badge.offsetWidth; badge.classList.add("bump"); }
    badge.hidden = !n; badge.textContent = n ? String(n) : "";
  });
  requestAnimationFrame(() => { movePill(nav); requestAnimationFrame(() => nav.classList.remove("no-anim")); });
}
function movePill(nav = $app.querySelector("[data-tabs]")) {
  const a = nav && nav.querySelector(".tab.active"), pill = nav && nav.querySelector(".tab-pill");
  if (!a || !pill) return;
  pill.style.width = a.offsetWidth + "px";
  pill.style.transform = `translateX(${a.offsetLeft}px)`;
}
window.addEventListener("resize", () => movePill());
const TITLES = { manca: "Manca in casa", prodotti: "Prodotti", registro: "Registro", stats: "Statistiche", admin: "Gestione" };

function viewManca(stats) {
  const items = Object.entries(S.missing).map(([id, m]) => ({ pr: product(id), m })).filter((x) => x.pr && !x.pr.archived && canSee(x.pr))
    .sort((a, b) => (toDate(a.m.addedAt)?.getTime() || Date.now()) - (toDate(b.m.addedAt)?.getTime() || Date.now()));
  const add = `<button class="btn big primary" data-act="add-missing" style="margin:6px 0 4px">＋ Segna cosa manca</button>`;
  if (!S.products.length) return emptyFirstRun();
  if (!items.length) return `<div class="empty"><div class="hero">🎉</div><h3>Casa rifornita!</h3><p>Non manca niente. Se finisce qualcosa, segnalo qui.</p></div>${add}`;
  return `<div class="sub" style="margin:0 4px 10px">${items.length} ${items.length === 1 ? "cosa da comprare" : "cose da comprare"}</div>` +
    items.map(({ pr, m }) => {
      const turn = turnPeople(stats, pr.id);
      const last = stats.byProduct[pr.id]?.last;
      const who = person(m.addedBy);
      return `<div class="card"><div class="row">
        <div class="emoji">${esc(pr.emoji || "📦")}</div>
        <div class="grow"><div class="name">${esc(pr.name)}</div>
          <div class="sub">${turn.length ? `<span class="tag turn">Turno: ${esc(joinNames(turn))}</span> ` : ""}${last ? `ultimo: <b>${esc(person(last.personId)?.name)}</b> ${fmtDay(last.date)}` : ""}</div>
          <div class="sub">segnato ${who ? `da ${esc(who.name)} ` : ""}${fmtDay(toDate(m.addedAt)) || "ora"}</div></div>
        <button class="btn ok" data-act="buy" data-id="${pr.id}">✓ Preso</button>
      </div></div>`;
    }).join("") + add;
}

function emptyFirstRun() {
  if (!S.loaded.products || !S.loaded.purchases) return `<div class="empty"><div class="hero">⏳</div><p>Caricamento…</p></div>`;
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
  const list = visibleProducts().filter((p) => p.name.toLowerCase().includes(q));
  if (!list.length) return `<div class="empty">Nessun prodotto trovato</div>`;
  const cats = [...new Set(list.map((p) => p.category || "Altro"))];
  return cats.map((c) => `<div class="section-title">${esc(c)}</div><div class="grid">` +
    list.filter((p) => (p.category || "Altro") === c).map((p) => {
      const miss = !!S.missing[p.id], last = stats.byProduct[p.id]?.last;
      return `<div class="pcard ${miss ? "missing" : ""}">
        <div class="top"><div class="emoji">${esc(p.emoji || "📦")}</div><div class="grow name">${esc(p.name)}${isShared(p) ? "" : `<div class="sub">👥 ${participants(p).map((x) => esc(x.name)).join(" e ")}</div>`}</div></div>
        <div class="sub">${miss ? `<span class="tag" style="margin:0">Manca</span> ` : ""}${last ? `${esc(person(last.personId)?.name)} · ${fmtDay(last.date)}` : ((n) => `${n} ${n === 1 ? "acquisto" : "acquisti"}`)(stats.byProduct[p.id]?.total || 0)}</div>
        <div class="actions">
          <button class="btn ${miss ? "warn" : ""}" data-act="toggle-missing" data-id="${p.id}">${miss ? "✕ Tolto" : "Manca"}</button>
          <button class="btn ok" data-act="buy" data-id="${p.id}">✓ Preso</button>
        </div></div>`;
    }).join("") + `</div>`).join("");
}

function viewRegistro() {
  const f = S.logFilter;
  const list = visiblePurchases().filter((p) => f === "all" || p.personId === f);
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
  if (!visiblePurchases().length) return `<div class="empty"><div class="hero">📊</div><h3>Ancora niente</h3><p>Le statistiche si riempiono con i primi acquisti.</p></div>`;
  const ranking = [...S.people].sort((a, b) => (stats.byPerson[b.id] || 0) - (stats.byPerson[a.id] || 0));
  const top = ranking[0];
  const topProd = [...visibleProducts()].sort((a, b) => (stats.byProduct[b.id]?.total || 0) - (stats.byProduct[a.id]?.total || 0))[0];
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
  const prods = visibleProducts().sort((a, b) => (stats.byProduct[b.id]?.total || 0) - (stats.byProduct[a.id]?.total || 0));
  html += `<div class="section-title">Per prodotto</div><div class="card"><div class="matrix-wrap"><table class="matrix">
    <thead><tr><th>Prodotto</th>${S.people.map((p) => `<th>${esc(p.name)}</th>`).join("")}<th>Tot</th><th>Ultimo</th></tr></thead><tbody>` +
    prods.map((pr) => {
      const b = stats.byProduct[pr.id] || { per: {}, total: 0 };
      const mx = Math.max(0, ...S.people.map((p) => b.per[p.id] || 0));
      return `<tr><td>${esc(pr.emoji || "")} ${esc(pr.name)}</td>` +
        S.people.map((p) => { if (!participantIds(pr).includes(p.id)) return `<td class="zero">—</td>`; const v = b.per[p.id] || 0; return `<td class="num ${v ? (v === mx ? "lead" : "") : "zero"}">${v}</td>`; }).join("") +
        `<td class="num lead">${b.total}</td><td class="sub">${b.last ? esc(person(b.last.personId)?.name) : "—"}</td></tr>`;
    }).join("") +
    `<tr class="tot"><td>Totale</td>${S.people.map((p) => `<td class="num">${stats.byPerson[p.id] || 0}</td>`).join("")}<td class="num">${stats.total}</td><td></td></tr>
    </tbody></table></div></div>`;
  return html;
}

function viewAdmin() {
  if (!isAdmin()) return "";
  const hasHist = S.purchases.some((p) => p.historical);
  const dups = seedDuplicates();
  const lastBackup = (() => { const d = new Date(localStorage.getItem("lastBackup") || ""); return isNaN(d) ? null : d; })();
  const linked = new Set(S.members.map((m) => m.personId).filter(Boolean));
  const free = S.people.filter((p) => !linked.has(p.id));
  const reqs = S.requests.length ? `<div class="section-title">🔔 Richieste di accesso</div>` + S.requests.map((r) => `<div class="card">
      <div class="row">${r.photo ? `<img src="${esc(r.photo)}" class="avatar" style="object-fit:cover" referrerpolicy="no-referrer" alt="">` : avatar({ name: r.name || r.email, color: "#888" })}
        <div class="grow"><div class="name">${esc(r.name || "Senza nome")}</div><div class="sub">${esc(r.email)}</div></div></div>
      <div class="sub" style="margin:10px 2px 6px">Chi è?</div>
      <div class="chips" style="flex-wrap:wrap">${(free.length ? free : S.people).map((p) => `<button class="chip" data-act="approve" data-email="${esc(r.email)}" data-id="${p.id}"><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}${p.fullName ? ` <span class="muted">· ${esc(p.fullName)}</span>` : ""}</button>`).join("")}
        <button class="chip" data-act="reject" data-email="${esc(r.email)}" style="color:var(--warn)">Rifiuta</button></div>
    </div>`).join("") : "";
  return reqs + `
  <div class="section-title">Account autorizzati</div><div class="card">
    ${S.members.map((m) => `<div class="log-item" style="cursor:pointer" data-act="edit-member" data-id="${esc(m.email)}">
      ${avatar(person(m.personId), 38)}<div class="grow"><div class="name">${esc(m.email)}</div>
      <div class="sub">${m.role === "admin" ? "Amministratore" : "Coinquilina"}${person(m.personId) ? " · " + esc(person(m.personId).name) : ""}</div></div><span class="muted">›</span></div>`).join("")}
    <button class="btn big" style="margin-top:8px" data-act="new-member">＋ Autorizza un account Google</button></div>

  <div class="section-title">Coinquiline</div><div class="card">
    ${S.people.map((p) => `<div class="log-item" style="cursor:pointer" data-act="edit-person" data-id="${p.id}">${avatar(p, 38)}<div class="grow"><div class="name">${esc(p.name)}</div><div class="sub">${esc(p.fullName || "")}${S.members.find((m) => m.personId === p.id) ? ` · ${esc(S.members.find((m) => m.personId === p.id).email)}` : " · non ancora collegata"}</div></div><span class="muted">›</span></div>`).join("") || `<div class="sub">Nessuna ancora.</div>`}
    <button class="btn big" style="margin-top:8px" data-act="new-person">＋ Aggiungi coinquilina</button></div>

  <div class="section-title">Prodotti</div><div class="card">
    ${S.products.map((p) => `<div class="log-item" style="cursor:pointer;${p.archived ? "opacity:.5" : ""}" data-act="edit-product" data-id="${p.id}">
      <div class="emoji">${esc(p.emoji || "📦")}</div><div class="grow"><div class="name">${esc(p.name)}</div><div class="sub">${esc(p.category || "Altro")} · ${isShared(p) ? "tutte" : participants(p).map((x) => esc(x.name)).join(" e ")}${p.archived ? " · archiviato" : ""}</div></div><span class="muted">›</span></div>`).join("") || `<div class="sub">Nessuno ancora.</div>`}
    <button class="btn big" style="margin-top:8px" data-act="new-product">＋ Nuovo prodotto</button></div>

  <div class="section-title">Dati</div><div class="card">
    ${dups.length ? `<div class="sub" style="color:var(--warn);margin:2px 2px 8px">⚠️ Lo storico del foglio risulta importato più volte: ${dups.length} righe doppie (${dups.reduce((s, p) => s + weight(p), 0)} acquisti contati in più).</div>
    <button class="btn big warn" data-act="fix-dups">🧹 Elimina i doppioni</button>` : ""}
    <button class="btn big ${hasHist ? "ghost" : "primary"}" data-act="import" ${hasHist || !S.loaded.purchases ? "disabled" : ""}>${hasHist ? "✓ Dati del foglio già importati" : "⤵︎ Importa dati dal foglio Google"}</button></div>

  <div class="section-title">Backup</div><div class="card">
    <div class="sub" style="margin:2px 2px 10px">Un file Excel con tutto: coinquiline, prodotti, acquisti, lista "Manca", account e un riepilogo. Salvalo in File o iCloud: se serve, si ripristina da qui.</div>
    <button class="btn big primary" data-act="export">⬇︎ Esporta backup Excel</button>
    <button class="btn big" data-act="restore">⬆︎ Ripristina da Excel</button>
    <div class="sub" style="margin:8px 2px 0">${lastBackup ? `Ultimo backup da questo dispositivo: ${fmtDay(lastBackup)}` : "Nessun backup esportato da questo dispositivo"}</div></div>
  <div class="footer-ver">Tracker Casa v${VERSION}</div>`;
}

// ---------------------------------------------------------------- Render
function renderShell() {
  closeSheet();
  if (!configured) {
    $app.innerHTML = `<div class="center"><div class="login"><div class="logo">🛠️</div><h1>Quasi pronto</h1>
      <p>Manca la configurazione di Firebase: pubblica l'app con <b>firebase deploy</b> (vedi README).</p></div></div>`;
    return;
  }
  if (S.user === undefined) { $app.innerHTML = `<div class="splash"><img class="app-icon splash-logo" src="icons/icon-192.png?v=2" alt=""></div>`; return; }
  if (!S.user) {
    $app.innerHTML = `<div class="center"><div class="login"><img class="app-icon" src="icons/icon-192.png?v=2" alt=""><h1>Tracker Casa</h1>
      <p>Cosa manca, chi ha comprato cosa, e a chi tocca la prossima volta.</p>
      <button class="gbtn" data-act="login"><svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Accedi con Google</button>
      <div class="footer-ver">v${VERSION}</div></div></div>`;
    return;
  }
  if (!S.me) {
    $app.innerHTML = `<div class="center"><div class="login"><div class="logo">⏳</div><h1>Richiesta inviata</h1>
      <p>Ciao ${esc((S.user.displayName || "").split(" ")[0])}! L'amministratore deve confermare chi sei. Appena lo fa, l'app si apre da sola.</p>
      <div class="sub" style="margin-bottom:16px">${esc(S.user.email)}</div>
      <button class="btn big" data-act="logout">Cambia account</button></div></div>`;
    return;
  }
  $app.innerHTML = `<header class="topbar"><h1 data-title></h1><button data-act="menu" aria-label="Profilo" data-avatar></button></header>
    <main data-main></main><nav class="tabbar" data-tabs></nav>`;
  render();
}

function render() {
  const main = $app.querySelector("[data-main]");
  if (!main) return;
  if (S.view === "admin" && !isAdmin()) S.view = "manca";
  const stats = computeStats();
  $app.querySelector("[data-title]").textContent = TITLES[S.view];
  $app.querySelector("[data-avatar]").innerHTML = avatar(person(myPersonId()) || { name: S.user.displayName || S.user.email, color: "#5b4bdb" });
  const missCount = Object.keys(S.missing).filter((id) => product(id) && !product(id).archived && canSee(product(id))).length;
  renderTabs(missCount);
  const focused = document.activeElement?.matches?.("[data-search]");
  main.innerHTML = { manca: viewManca, prodotti: viewProdotti, registro: viewRegistro, stats: viewStats, admin: viewAdmin }[S.view](stats);
  if (focused) { const s = main.querySelector("[data-search]"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}

// ---------------------------------------------------------------- Eventi (delegati)
$app.addEventListener("click", async (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    if (S.view === tab.dataset.tab) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    S.view = tab.dataset.tab; localStorage.setItem("view", S.view); render(); window.scrollTo({ top: 0 });
    const m = $app.querySelector("[data-main]"); m.classList.remove("view-enter"); void m.offsetWidth; m.classList.add("view-enter");
    return;
  }
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
      case "fix-dups": return removeSeedDuplicates();
      case "export": return exportBackup();
      case "restore": return pickBackupFile();
      case "approve": return approveRequest(a.dataset.email, id);
      case "reject":
        if (await confirmSheet("Rifiutare la richiesta?", `${a.dataset.email} non potrà entrare.`, "Rifiuta")) await deleteDoc(doc(db, "requests", a.dataset.email));
        return;
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
      else {
        const em = u.email.toLowerCase();
        setDoc(doc(db, "requests", em), { name: u.displayName || "", photo: u.photoURL || "", requestedAt: serverTimestamp() }, { merge: true }).catch(fail);
        // resta in attesa: quando l'admin approva, entra automaticamente
        S.unsub.push(onSnapshot(doc(db, "members", em), (d) => {
          if (!d.exists()) return;
          stopListeners(); S.me = { email: d.id, ...d.data() }; renderShell(); startListeners();
        }, () => {}));
      }
    } else renderShell();
  });
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
