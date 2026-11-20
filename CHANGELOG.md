# Changelog

Tutte le modifiche all'app sono registrate qui. Formato del titolo: `## [versione] — data — titolo`: a ogni push su `main` GitHub crea in automatico la Release corrispondente. Formato: [Keep a Changelog](https://keepachangelog.com/it/1.1.0/), versioni [SemVer](https://semver.org/lang/it/).

## [1.6.0] — 2026-11-20 — Backup Excel e turni a pari merito
### Aggiunto
- **Backup Excel** (Admin → Backup): esporta in un file `.xlsx` coinquiline, prodotti, tutti gli acquisti, la lista "Manca", gli account e un riepilogo prodotto × coinquilina. Su iPhone si salva in File/iCloud dal pannello Condividi.
- **Ripristina da Excel**: rilegge il backup con due modalità, *Unisci* (aggiunge/aggiorna senza doppioni grazie agli ID) e *Sostituisci tutto*. Gli account non vengono mai tolti.
- **Elimina i doppioni** (Admin → Dati): compare quando lo storico del foglio risulta importato più di una volta e lo riporta ai 42 acquisti giusti.

### Modificato
- **Turno a pari merito**: in "Manca in casa" compaiono tutte le coinquiline che hanno comprato quel prodotto meno volte (es. "Turno: Minkia e Berta"), non solo una.
- Regole Firestore: l'amministratore può ricreare acquisti registrati da altre (serve per il ripristino).

### Corretto
- **Import del foglio doppio**: lo storico ora ha ID fissi, quindi un doppio tocco o un secondo telefono non lo duplicano più; il pulsante di import compare solo dopo che i dati sono caricati.

## [1.5.2] — 2026-11-16 — Barra in alto simmetrica
### Modificato
- **Barra in alto più bassa e simmetrica**: stesso spazio sopra e sotto il titolo, e titolo e avatar della stessa altezza, così sono perfettamente centrati come nelle app di iOS.

## [1.5.1] — 2026-11-15 — Release automatiche su GitHub
### Aggiunto
- **Release su GitHub**: ogni versione di questo registro diventa una Release del repository, creata in automatico a ogni pubblicazione (`.github/workflows/release.yml` + `.github/scripts/releases.py`). Create anche tutte le Release passate.
- Schermate della pagina GitHub aggiornate con la nuova barra in stile iOS.

## [1.5.0] — 2026-11-15 — Barra in stile iOS e pannelli trascinabili
### Aggiunto
- **Nuova barra in basso in stile iOS**: capsula "di vetro" sospesa, icone disegnate come quelle di iOS, pillola che scorre con effetto molla sotto la scheda attiva, numeri che saltano quando cambiano, tocco con piccolo rimbalzo.
- Cambio scheda con dissolvenza del contenuto; toccare la scheda già aperta riporta in cima.

### Corretto
- I pannelli dal basso (es. "Cosa manca?") ora si chiudono **trascinandoli giù**, con la **X** in alto a destra, toccando la lineetta o toccando fuori; la chiusura è animata.

## [1.4.3] — 2026-11-15 — Login su iPhone corretto
### Corretto
- Login con Google su iPhone: risolto "Errore 400: redirect_uri_mismatch". Ora il login si apre in una finestra (popup) sul dominio già autorizzato di Firebase, senza bisogno di configurare Google Cloud.

## [1.4.2] — 2026-11-15 — Grafica sempre aggiornata
### Corretto
- Anche la grafica (styles.css) si aggiorna subito dopo ogni release, senza aspettare la cache del browser.

## [1.4.1] — 2026-11-15 — Icone sempre aggiornate
### Corretto
- Le icone si aggiornano subito anche sui telefoni che avevano ancora in memoria quella vecchia.

## [1.4.0] — 2026-11-15 — Nuova icona e pagina GitHub
### Aggiunto
- **Nuova icona dell'app** (casa con spunta, sfondo viola sfumato) per la schermata Home dell'iPhone, Android e il browser; sorgente in `icons/icon.svg`.
- Icona mostrata anche nella schermata di accesso e di caricamento.
- Pagina GitHub rinnovata: banner, schermate dell'app, elenco delle funzioni (`docs/`).

### Modificato
- `docs/` esclusa dalla pubblicazione su Firebase Hosting.

## [1.3.2] — 2026-11-15 — Pubblicazione automatica da GitHub
### Aggiunto
- Pubblicazione automatica con GitHub Actions (`.github/workflows/deploy.yml`): ogni push su `main` pubblica l'app su Firebase Hosting, senza Terminale.

## [1.3.1] — 2026-11-15 — Progetto Firebase collegato
### Modificato
- Progetto Firebase `tracker-casa-a0c47` già collegato in `.firebaserc`: per pubblicare basta `firebase deploy`.

## [1.3.0] — 2026-11-15 — Passaggio a Firebase Hosting
### Modificato
- **Hosting spostato da Netlify a Firebase Hosting** (gratuito, non consuma i crediti Netlify).
- La configurazione Firebase viene letta in automatico da `/__/firebase/init.json`: non serve più incollarla.
- Login su iPhone sullo stesso dominio dell'app senza proxy né passaggi su Google Cloud.
- Le regole Firestore si pubblicano con `firebase deploy` insieme all'app.
- Il service worker non mette mai in cache gli indirizzi `/__/` (login e configurazione).

### Rimosso
- `netlify.toml`.

## [1.2.0] — 2026-11-15 — Richieste di accesso
### Aggiunto
- **Richieste di accesso**: chi entra con Google senza essere autorizzato invia una richiesta e aspetta; l'amministratore in Admin tocca "chi è" (Fede, Berta, Minkia) e l'app le si apre da sola. Non serve più conoscere le email in anticipo.
- Nome vero delle coinquiline (Federica, Beatrice, Rosi) accanto al soprannome.
- Badge sulla scheda Admin con le richieste in attesa.

### Modificato
- Regole Firestore: nuova raccolta `requests`.

## [1.1.0] — 2026-11-15 — Bagno condiviso e iPhone
### Aggiunto
- **Partecipanti per prodotto**: ogni prodotto può essere di tutte o solo di alcune coinquiline. Ognuna vede (lista, prodotti, registro, statistiche) solo ciò a cui partecipa; turni calcolati solo tra le partecipanti.
- Prodotti del bagno in comune (Carta Igienica, Dentifricio, Sapone Mani) assegnati a Fede e Berta, nuova categoria "Bagno".
- Ottimizzazione iPhone: login Google tramite redirect sullo stesso dominio (proxy Netlify `/__/auth`), niente zoom sui campi, menu e date in stile iOS, aree sicure.
- Uso solo in verticale: in orizzontale compare l'invito a ruotare il telefono.

## [1.0.0] — 2026-11-15 — Prima versione
Prima release.

### Aggiunto
- Login con Google; accesso solo agli account autorizzati (raccolta `members`), ruoli amministratore / coinquilina.
- **Manca in casa**: lista condivisa con turno suggerito, ultimo acquirente e chi ha segnalato.
- **Prodotti**: griglia per categoria con ricerca, "Manca" e "✓ Preso".
- **Registra acquisto**: chi, data, nota; toglie automaticamente il prodotto dalla lista.
- **Registro** acquisti per giorno con filtro per coinquilina ed eliminazione.
- **Statistiche**: totale, top coinquilina, top prodotto, ultimo acquisto, classifica, tabella prodotto × coinquilina.
- **Admin**: gestione account, coinquiline, prodotti (aggiungi, modifica, archivia).
- Import una tantum dal foglio Google "To Buy List 🛍️": 3 coinquiline, 15 prodotti, 42 acquisti storici.
- PWA installabile (manifest, icone, service worker), funzionamento offline con cache Firestore, tema chiaro/scuro.
- Regole di sicurezza Firestore.
