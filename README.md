# 🏡 Tracker Casa

Web app per tre coinquiline: lista di **cosa manca in casa**, **registro acquisti**, **statistiche** (chi ha comprato di più, chi per ultimo, a chi tocca). Login con Google, solo account autorizzati. Installabile sul telefono come app.

**Stack (tutto gratuito):** HTML/CSS/JS senza build · Firebase Authentication + Cloud Firestore (piano Spark) · Netlify collegato a GitHub.

---

## 1. Crea il progetto Firebase (≈10 minuti)

1. Vai su <https://console.firebase.google.com> → **Aggiungi progetto** → nome `tracker-casa` → Google Analytics: **disattiva** → Crea.
2. Menu **Build → Authentication** → *Inizia* → scheda *Metodo di accesso* → **Google** → Abilita → scegli la tua email di assistenza → Salva.
3. Menu **Build → Firestore Database** → *Crea database* → località **eur3 (Europe)** → *Avvia in modalità produzione* → Crea.
4. Sempre in Firestore, scheda **Regole** → cancella tutto, incolla il contenuto di `firestore.rules` → **Pubblica**.
5. Scheda **Dati** → *Avvia raccolta*:
   - ID raccolta: `members`
   - ID documento: **la tua email Google, tutta minuscola** (es. `mario.rossi@gmail.com`)
   - Campo: `role` · tipo *string* · valore `admin` → Salva.
   (È l'unico dato da inserire a mano: da qui in poi gestisci tutto dall'app.)
6. ⚙️ **Impostazioni progetto** → in fondo *Le tue app* → icona **`</>`** (Web) → nickname `tracker-casa` → *non* spuntare Hosting → Registra.
   Copia i valori di `firebaseConfig` e incollali in **`firebase-config.js`** al posto di `INCOLLA_QUI`.

## 2. Pubblica su GitHub + Netlify

1. Apri `netlify.toml` e sostituisci le due volte `TUO-PROJECT-ID` con il `projectId` di `firebase-config.js` (serve al login su iPhone).
2. Su GitHub crea un repository (es. `tracker-casa`, anche privato) e carica tutti i file di questa cartella.
3. Su <https://app.netlify.com> → **Add new site → Import an existing project → GitHub** → scegli il repo.
   - Build command: *vuoto* · Publish directory: `.` → **Deploy**.
4. Copia l'indirizzo del sito (es. `tracker-casa-xyz.netlify.app`; puoi rinominarlo in *Site configuration → Change site name*).
5. Torna su Firebase → **Authentication → Impostazioni → Domini autorizzati** → *Aggiungi dominio* → incolla `tracker-casa-xyz.netlify.app`.
6. **Solo per iPhone (importante):** vai su <https://console.cloud.google.com/apis/credentials> (stesso account, progetto `tracker-casa`) → *ID client OAuth 2.0* → **Web client (auto created by Google Service)** → in *URI di reindirizzamento autorizzati* aggiungi
   `https://tracker-casa-xyz.netlify.app/__/auth/handler` → Salva (può servire qualche minuto).

Da ora ogni modifica caricata su GitHub viene pubblicata da Netlify in automatico.

## 3. Primo avvio

1. Apri il sito, **Accedi con Google** con l'account admin.
2. Scheda **Admin → Importa dati dal foglio Google**: crea le 3 coinquiline, i 15 prodotti e i 42 acquisti del foglio (come "storico senza data").
3. **Admin → Autorizza un account Google**: aggiungi la Gmail di Fede, Minkia e Berta e collegale al loro nome.
   Se anche tu sei una delle coinquiline, tocca il tuo account e collegalo al tuo nome.

## 4. Installarla su iPhone

Apri il sito in **Safari** (non Chrome) → tasto **Condividi** → **Aggiungi alla schermata Home** → Aggiungi. Si apre a schermo intero come un'app, in verticale.

<details><summary>Android</summary>Chrome → menu ⋮ → <i>Installa app</i>.</details>

## Prodotti del bagno

Ogni prodotto ha i suoi **partecipanti** (Admin → Prodotti → tocca un prodotto → *Chi lo compra e lo vede?*).
- *Tutte*: lo vedono e lo comprano tutte e tre.
- Solo alcune: lo vedono solo loro; turni e statistiche contano solo loro.

All'import, **Carta Igienica, Dentifricio e Sapone Mani** sono assegnati a **Fede e Berta** (bagno in comune); Minkia non li vede.

---

## Come funziona

| Scheda | Cosa fa |
|---|---|
| 📝 **Manca** | Lista condivisa di cosa è finito. Per ogni voce: a chi tocca (chi l'ha comprato meno), chi l'ha comprato per ultimo, chi l'ha segnato. "✓ Preso" registra l'acquisto e lo toglie dalla lista. |
| 🧺 **Prodotti** | Tutti i prodotti per categoria: "Manca" lo mette in lista, "✓ Preso" registra un acquisto (chi, quando, nota). |
| 🧾 **Registro** | Tutti gli acquisti per giorno, filtrabili per coinquilina. Ognuna può eliminare quelli che ha inserito lei; l'admin tutti. |
| 📊 **Statistiche** | Totale, top coinquilina, top prodotto, ultimo acquisto, classifica e tabella prodotto × coinquilina (come nel foglio). |
| ⚙️ **Admin** | Solo amministratore: account autorizzati, coinquiline, prodotti (aggiungi/modifica/archivia), import dal foglio. |

### Dati su Firestore
- `members/{email}` → `role` (`admin`/`member`), `personId`
- `people/{id}` → `name`, `color`, `order`
- `products/{id}` → `name`, `emoji`, `category`, `order`, `archived`
- `purchases/{auto}` → `productId`, `personId`, `date`, `note`, `createdBy`, `createdAt`, `historical`, `count` (solo storico)
- `missing/{productId}` → `addedBy`, `addedByEmail`, `addedAt`

La sicurezza è nelle regole (`firestore.rules`): chi non è in `members` non legge e non scrive nulla.

## Release

Ogni modifica è una release, registrata in `CHANGELOG.md`:
1. aumenta la versione in `version.js` **e** `CACHE` in `sw.js` (es. `1.0.0` → `1.1.0`);
2. aggiungi la voce in cima a `CHANGELOG.md`;
3. commit `Release vX.Y.Z` + tag `vX.Y.Z` (opzionale: *Releases → Draft new release* su GitHub).

Versioni: **MAJOR** = cambia la struttura dati · **MINOR** = nuova funzione · **PATCH** = correzione.
