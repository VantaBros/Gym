# Report verifiche — VANTA 12

Data test: 16 luglio 2026

## Test funzionali automatizzati

Superati:

- rendering del calendario con 42 celle;
- navigazione tra luglio e agosto 2026;
- sei voci nella navigazione principale;
- creazione di una programmazione per la data selezionata;
- persistenza di data, scheda e giorno nello stato locale;
- Home senza deduzione automatica del prossimo allenamento;
- visualizzazione dell’allenamento pianificato per oggi;
- avvio della sessione dal calendario;
- collegamento tramite `scheduleId`;
- uso della data selezionata nello storico;
- completamento della sessione e passaggio automatico a `completed`;
- collegamento della programmazione alla sessione tramite `sessionId`;
- stato saltato, ripristino e rimozione;
- migrazione automatica da stato versione 11 senza calendario;
- eliminazione delle programmazioni collegate quando si elimina una scheda;
- assenza di errori JavaScript nei flussi testati.

## Verifica responsive

Test eseguito in Chromium alle larghezze 320, 375, 390, 430 e 768 pixel:

- nessun overflow orizzontale in tutte le larghezze;
- navigazione inferiore contenuta nel viewport;
- 42 celle del calendario visibili in ogni configurazione;
- card programmata correttamente renderizzata;
- verifica specifica 390 × 844 pixel con documento, viewport e navigazione larghi 390 px.

## Compatibilità progettata

- Safari iPhone;
- Chrome Android;
- Chrome/Edge su PC;
- PWA installata e uso offline.

L’ambiente automatico non sostituisce una prova sul modello esatto di telefono dell’utente, ma i flussi, la persistenza e il layout mobile sono stati verificati in DOM reale e Chromium headless.
