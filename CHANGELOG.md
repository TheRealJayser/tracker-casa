# Changelog

Tutte le modifiche all'app sono registrate qui. Formato: [Keep a Changelog](https://keepachangelog.com/it/1.1.0/), versioni [SemVer](https://semver.org/lang/it/).

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
