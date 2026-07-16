# Report verifiche — VANTA 11.0

Data verifica: 16 luglio 2026.

## Matrice dei formati verificati

Sono stati creati file di prova equivalenti contenenti giorni, esercizi, serie normali, back-off, drop set e piramidali.

| Origine | Esito |
|---|---|
| TXT / testo incollato | PASS |
| Markdown | PASS |
| CSV e TSV | PASS |
| RTF | PASS |
| HTML | PASS |
| DOCX, paragrafi e tabelle | PASS |
| XLSX, più fogli e tabelle compatte | PASS |
| PPTX | PASS |
| ODT e ODS | PASS |
| Foto/OCR, flusso completo con risposta OCR controllata | PASS |
| Pages con anteprima grafica e fallback OCR controllato | PASS |
| Anteprima UI e salvataggio della scheda | PASS |

## Casi specifici verificati

### Prescrizione verticale

```text
LAT MACHINE
2x8-10 + 1 drop set
```

Risultato:

```text
Esercizio: LAT MACHINE
Serie: 1 | 2 | DROP
Target: 8-10 | 8-10 | 8-10
```

### Back-off con target proprio

```text
Croci manubri 2x10-12 + 1 BO 15
```

Risultato:

```text
Serie 1: 10-12
Serie 2: 10-12
Serie BO: 15
```

### Tabella compatta

```text
Leg Press | 3 + BO | 8-10 + 12-15
```

Risultato: tre serie da 8-10 più una BO da 12-15.

### Piramidale

```text
PULLEY 12/10/8/6
```

Risultato: quattro serie con target 12, 10, 8 e 6.

## Verifiche dell’interfaccia

- Apertura del pannello **Da dove arriva la scheda?**.
- Selettore file multiplo.
- Comando fotocamera dedicato.
- Area per testo copiato da Note.
- Messaggi di avanzamento.
- Anteprima con modifica ed esclusione degli esercizi.
- Importazione finale nella sezione Schede.
- Nessun errore JavaScript rilevato nei flussi automatici eseguiti.

## Verifiche tecniche

- `app.js`: sintassi valida.
- `pdf-import.js`: sintassi valida.
- `universal-import.js`: sintassi valida.
- `sw.js`: sintassi valida.
- Versione interna: `11`.
- Cache PWA: `vanta-v11-universal-import`.
- Catalogo esercizi invariato: 121 identificatori.
- Componenti OCR, worker, core WebAssembly e lingue ITA/ENG presenti localmente nel pacchetto.

## Nota sui test OCR reali

Il flusso browser è stato verificato con un worker OCR controllato che restituisce dati nello stesso formato TSV atteso dall’app; sono stati testati preparazione dell’immagine, ricostruzione delle righe, associazione nome/prescrizione, parsing e anteprima. L’ambiente automatico usato durante lo sviluppo blocca l’avvio di Web Worker tramite navigazioni locali, quindi l’esecuzione end-to-end del motore WebAssembly reale va confermata dopo la pubblicazione HTTPS. Tutti i file necessari sono comunque inclusi nel pacchetto e i percorsi sono relativi al dominio dell’app.

## Limiti dichiarati

Non è possibile garantire il riconoscimento perfetto di ogni file e impaginazione esistente. In particolare, scrittura a mano, foto sfocate, tabelle con elementi sovrapposti, password, file danneggiati o formati proprietari senza anteprima possono richiedere una conversione o una correzione manuale. Per questo l’anteprima modificabile rimane obbligatoria prima del salvataggio.
