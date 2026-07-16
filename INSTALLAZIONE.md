# Installazione di VANTA 11

VANTA è una web app installabile. Deve essere pubblicata su un indirizzo HTTPS, ad esempio GitHub Pages o Netlify.

## Pubblicazione

1. Decomprimi il pacchetto ZIP.
2. Carica **tutti** i file e tutte le cartelle mantenendo `index.html` nella cartella principale.
3. Non eliminare la cartella `vendor`: contiene i lettori PDF, Office e OCR necessari all’importazione.
4. Verifica la presenza di:

```text
index.html
app.js
styles.css
exercise-catalog.js
pdf-import.js
universal-import.js
sw.js
manifest.webmanifest
assets/
icons/
vendor/
```

5. Apri l’indirizzo HTTPS fornito dal servizio di hosting.

## iPhone

1. Apri il sito in Safari.
2. Tocca **Condividi**.
3. Seleziona **Aggiungi alla schermata Home**.
4. Conferma con **Aggiungi**.

Per fotografare una scheda usa **Schede → Importa scheda → Scatta una foto**. Safari chiederà l’autorizzazione alla fotocamera o aprirà il selettore previsto da iOS.

## Android

1. Apri il sito in Chrome.
2. Apri il menu con i tre puntini.
3. Seleziona **Installa app** oppure **Aggiungi alla schermata Home**.
4. Conferma.

## Computer

Apri il link con Chrome, Edge, Safari o un browser moderno. Puoi usare VANTA direttamente oppure scegliere il comando di installazione del browser.

## Aggiornamenti

Prima di ogni aggiornamento usa **Profilo → Esporta backup**. Carica poi i nuovi file sullo stesso dominio. Schede, storico e foto profilo continueranno a essere letti dalla stessa memoria locale.
