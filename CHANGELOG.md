# Changelog

Tutte le modifiche all'app sono registrate qui. Formato: [Keep a Changelog](https://keepachangelog.com/it/1.1.0/), versioni [SemVer](https://semver.org/lang/it/).

## [1.4.2] — 2026-11-15
### Corretto
- Anche la grafica (styles.css) si aggiorna subito dopo ogni release, senza aspettare la cache del browser.

## [1.4.1] — 2026-11-15
### Corretto
- Le icone si aggiornano subito anche sui telefoni che avevano ancora in memoria quella vecchia.

## [1.4.0] — 2026-11-15
### Aggiunto
- **Nuova icona dell'app** (casa con spunta, sfondo viola sfumato) per la schermata Home dell'iPhone, Android e il browser; sorgente in `icons/icon.svg`.
- Icona mostrata anche nella schermata di accesso e di caricamento.
- Pagina GitHub rinnovata: banner, schermate dell'app, elenco delle funzioni (`docs/`).

### Modificato
- `docs/` esclusa dalla pubblicazione su Firebase Hosting.

## [1.3.2] — 2026-11-15
### Aggiunto
- Pubblicazione automatica con GitHub Actions (`.github/workflows/deploy.yml`): ogni push su `main` pubblica l'app su Firebase Hosting, senza Terminale.

## [1.3.1] — 2026-11-15
### Modificato
- Progetto Firebase `tracker-casa-a0c47` già collegato in `.firebaserc`: per pubblicare basta `firebase deploy`.

## [1.3.0] — 2026-11-15
### Modificato
- **Hosting spostato da Netlify a Firebase Hosting** (gratuito, non consuma i crediti Netlify).
- La configurazione Firebase viene letta in automatico da `/__/firebase/init.json`: non serve più incollarla.
- Login su iPhone sullo stesso dominio dell'app senza proxy né passaggi su Google Cloud.
- Le regole Firestore si pubblicano con `firebase deploy` insieme all'app.
- Il service worker non mette mai in cache gli indirizzi `/__/` (login e configurazione).

### Rimosso
- `netlify.toml`.

## [1.2.0] — 2026-11-15
### Aggiunto
- **Richieste di accesso**: chi entra con Google senza essere autorizzato invia una richiesta e aspetta; l'amministratore in Admin tocca "chi è" (Fede, Berta, Minkia) e l'app le si apre da sola. Non serve più conoscere le email in anticipo.
- Nome vero delle coinquiline (Federica, Beatrice, Rosi) accanto al soprannome.
- Badge sulla scheda Admin con le richieste in attesa.

### Modificato
- Regole Firestore: nuova raccolta `requests`.

## [1.1.0] — 2026-11-15
### Aggiunto
- **Partecipanti per prodotto**: ogni prodotto può essere di tutte o solo di alcune coinquiline. Ognuna vede (lista, prodotti, registro, statistiche) solo ciò a cui partecipa; turni calcolati solo tra le partecipanti.
- Prodotti del bagno in comune (Carta Igienica, Dentifricio, Sapone Mani) assegnati a Fede e Berta, nuova categoria "Bagno".
- Ottimizzazione iPhone: login Google tramite redirect sullo stesso dominio (proxy Netlify `/__/auth`), niente zoom sui campi, menu e date in stile iOS, aree sicure.
- Uso solo in verticale: in orizzontale compare l'invito a ruotare il telefono.

## [1.0.0] — 2026-11-15
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
