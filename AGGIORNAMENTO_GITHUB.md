# Aggiornare VANTA a versione 12 su GitHub

## Prima dell’aggiornamento

Apri l’app attuale e usa:

**Profilo → Esporta backup**

## Caricamento

1. Scarica e decomprimi lo ZIP di VANTA 12.
2. Accedi a GitHub e apri il repository dell’app.
3. Seleziona **Add file → Upload files**.
4. Trascina tutti i file e tutte le cartelle contenuti nello ZIP estratto.
5. Conferma la sostituzione dei file esistenti.
6. Inserisci come messaggio: `Aggiornamento VANTA 12`.
7. Premi **Commit changes**.
8. Attendi alcuni minuti.
9. Apri il normale link GitHub Pages in Safari o Chrome e ricaricalo due volte.
10. Chiudi completamente la PWA installata e riaprila.

In fondo a **Profilo** deve comparire `VANTA v12`.

## File importanti da sostituire

- `app.js`
- `styles.css`
- `index.html`
- `sw.js`
- `manifest.webmanifest`
- tutte le cartelle `assets`, `icons` e `vendor`

Non modificare le impostazioni di GitHub Pages e non cambiare dominio: mantenendo lo stesso indirizzo, i dati locali esistenti vengono migrati automaticamente.
