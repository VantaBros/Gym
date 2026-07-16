# Aggiornare VANTA a versione 11 su GitHub

## 1. Esporta prima il backup

Apri l’app attuale e seleziona **Profilo → Esporta backup**. Conserva il file JSON prima di sostituire i file pubblicati.

## 2. Scarica e decomprimi il pacchetto

1. Scarica `vanta-webapp-v11-importazione-universale.zip`.
2. Fai clic destro sul file e seleziona **Estrai tutto**.
3. Apri la cartella estratta: `index.html` deve essere visibile direttamente al suo interno.

## 3. Sostituisci i file su GitHub

1. Accedi a GitHub.
2. Apri il repository nel quale hai pubblicato VANTA.
3. Premi **Add file → Upload files**.
4. Trascina tutti i file e tutte le cartelle estratte.
5. Verifica che vengano caricati o sostituiti almeno:

```text
app.js
pdf-import.js
universal-import.js
styles.css
sw.js
index.html
exercise-catalog.js
manifest.webmanifest
assets/
icons/
vendor/
```

La cartella `vendor` è più grande rispetto alle versioni precedenti perché include il riconoscimento OCR. Attendi che GitHub completi il caricamento prima di premere il pulsante finale.

6. Nel messaggio scrivi `Aggiornamento VANTA 11`.
7. Premi **Commit changes**.

Non modificare le impostazioni di GitHub Pages e non cambiare il nome del repository.

## 4. Aggiorna la versione sul telefono

1. Attendi alcuni minuti dopo il commit.
2. Apri il link GitHub Pages direttamente in Safari o Chrome.
3. Ricarica la pagina due volte.
4. Chiudi completamente la PWA installata e riaprila.
5. Vai in **Profilo** e controlla che in fondo compaia `VANTA v11`.

La nuova cache si chiama `vanta-v11-universal-import` e sostituisce i file principali delle versioni precedenti.

## 5. Verifica l’importazione

Apri **Schede → Importa scheda**. Dovrai vedere:

- **Scegli un file**;
- **Scatta una foto**;
- **Incolla testo o Note**.

Come prova puoi incollare:

```text
GIORNO 1 - DORSO
LAT MACHINE
2x8-10 + 1 DROP
```

Nell’anteprima deve comparire un solo esercizio con le serie `1`, `2`, `DROP`.

Prima del primo allenamento controlla sempre nomi, serie, ripetizioni e recuperi riconosciuti.
