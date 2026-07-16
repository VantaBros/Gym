# Changelog — VANTA 11.0

## Importazione universale

- Sostituito il comando limitato ai PDF con **Importa scheda**.
- Aggiunta l’importazione da fotografie e screenshot tramite OCR italiano e inglese.
- Aggiunta la fotocamera diretta su iPhone e Android.
- Aggiunta la selezione multipla fino a 12 fotografie, utile quando una scheda è composta da più pagine.
- Aggiunta l’importazione da DOCX, XLSX/XLSM, PPTX, ODT, ODS, TXT, Markdown, CSV, TSV, RTF, HTML e XML.
- Aggiunta la lettura di Pages, Numbers e Keynote quando contengono un’anteprima PDF o immagine accessibile.
- Aggiunta la funzione **Incolla testo o Note**.
- Aggiunto l’OCR automatico dei PDF costituiti soltanto da scansioni.
- Aggiunto il fallback OCR per documenti Office/OpenDocument nei quali la scheda è inserita come immagine.

## Parser più flessibile

- Riconosciuti nome e prescrizione su righe separate anche nelle fotografie.
- Raggruppate le parole OCR vicine, evitando che `LAT MACHINE` venga diviso in più campi.
- Mantenute separate le vere colonne quando la distanza orizzontale è ampia.
- Aggiunto il riconoscimento di `2x10-12 + 1 BO 15`: due serie da 10-12 più una BO da 15.
- Conservato il supporto per `DROP`, `RP`, `BO`, piramidali e layout multicolonna.
- Aggiunte tabelle compatte a tre colonne: esercizio, serie e ripetizioni.

## OCR e privacy

- Inclusi localmente Tesseract.js, il motore WebAssembly e i dati lingua italiana/inglese.
- Nessun documento viene inviato a un servizio remoto per l’analisi.
- Le risorse OCR vengono caricate soltanto quando servono e possono essere riutilizzate dalla cache del browser.

## Interfaccia e compatibilità

- Nuovo pannello di scelta origine: file, fotocamera o testo incollato.
- Messaggi di avanzamento differenziati per documenti, pagine e OCR.
- Errori più chiari per file protetti, danneggiati, troppo grandi o in formati Office obsoleti.
- Anteprima modificabile mantenuta per ogni origine.
- Cache PWA aggiornata a `vanta-v11-universal-import`.
