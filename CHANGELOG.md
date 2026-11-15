# Changelog

Tutte le modifiche all'app sono registrate qui. Formato: [Keep a Changelog](https://keepachangelog.com/it/1.1.0/), versioni [SemVer](https://semver.org/lang/it/).

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
