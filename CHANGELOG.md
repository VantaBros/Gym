# Changelog — VANTA 12

## Calendario selezionabile

- Nuova sezione **Calendario** nella navigazione principale.
- Vista mensile con 42 celle, selezione del giorno e cambio mese.
- Programmazione manuale di scheda e giorno per una data precisa.
- Stato **Programmato**, **Completato** e **Saltato**.
- Modifica, ripristino, avvio e rimozione delle programmazioni.
- Collegamento automatico tra programmazione e sessione salvata.
- Accesso alla sessione completata direttamente dal calendario.
- Avviso prima di avviare una programmazione futura.

## Home e Allenati

- La Home non deduce più automaticamente il prossimo giorno.
- Mostra l’allenamento pianificato per oggi oppure invita a sceglierlo.
- Riquadro con le prossime programmazioni.
- La schermata Allenati mostra prima gli appuntamenti odierni e mantiene l’allenamento libero.

## Dati e compatibilità

- Nuovo campo `scheduledWorkouts` nello stato locale.
- Migrazione automatica e immediata dai backup/versioni precedenti.
- Calendario incluso nei backup JSON.
- Pulizia delle programmazioni quando una scheda o un giorno vengono eliminati.
- Cache PWA aggiornata a `vanta-v12-selectable-calendar`.
- Navigazione mobile ottimizzata a sei voci senza overflow orizzontale.
