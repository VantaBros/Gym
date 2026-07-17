# Report verifiche — VANTA 15

## Ambito
Aggiornamento grafico della versione VANTA 12 senza rimuovere o modificare le funzioni di calendario, Fantasma, catalogo, importazione universale, profilo, schede e storico.

## Asset verificati
- Background verticale fornito: `941 × 1672`, applicato all'intera PWA.
- Immagine orizzontale fornita: `1817 × 866`, applicata alla card **Prossimo allenamento**.
- Logo fornito: convertito in PNG trasparente `1292 × 682`, mantenendo l'effetto ghiaccio.
- Icone PWA rigenerate: `192 × 192` e `512 × 512`.

## Palette verificata
Sono presenti e utilizzati i colori richiesti:

- `#060B13`
- `#23354B`
- `#304964`
- `#515965`
- `#55728F`
- `#678AA9`
- `#60A3D0`
- `#ABCDE3`
- `#E4E6E8`
- `#9A9FA5`

I precedenti codici viola principali non risultano più presenti in CSS o JavaScript.

## Controlli tecnici
- Sintassi valida per `app.js`, `exercise-catalog.js`, `pdf-import.js`, `universal-import.js` e `sw.js`.
- Bilanciamento delle parentesi CSS verificato.
- Manifest JSON valido e tema browser impostato su `#060B13`.
- Tutti gli asset elencati nel Service Worker esistono.
- Cache PWA aggiornata a `vanta-v15-ice-branding`.
- Versione visualizzata nel Profilo: `VANTA v15`.
- Catalogo invariato: 121 esercizi con identificativi presenti.

## Prova interfaccia mobile
Verifica eseguita a `390 × 844` pixel:

- Home caricata correttamente.
- Card principale con nuova immagine ICE caricata.
- Nuovo logo caricato.
- Navigazione verso Calendario, Profilo e ritorno alla Home funzionante.
- Nessun errore JavaScript rilevato durante il rendering e la navigazione provata.
- Larghezza documento uguale alla viewport: nessun overflow orizzontale rilevato.

## Compatibilità
La struttura tecnica resta la stessa di VANTA 12: PWA responsive basata su HTML, CSS e JavaScript, destinata a Safari su iPhone, Chrome su Android e browser desktop moderni. La verifica non sostituisce una prova su ogni specifico modello fisico e versione del sistema operativo.
