# VANTA 11 — Diario di allenamento

VANTA è una PWA installabile su iPhone, Android e computer. Permette di creare schede, registrare ogni serie, confrontarsi con il Fantasma dell’allenamento precedente, consultare il catalogo tecnico degli esercizi e analizzare i progressi.

## Importazione universale

Da **Schede → Importa scheda** puoi scegliere tre modalità:

1. **Scegli un file** dal telefono o dal computer.
2. **Scatta una foto** a una scheda cartacea.
3. **Incolla testo o Note** copiati da Note, WhatsApp, email, Word o una pagina web.

### Formati letti direttamente

- PDF con testo, PDF tabellari e PDF a più colonne.
- PDF scansionati tramite OCR.
- Foto e screenshot: JPG, JPEG, PNG, WEBP, BMP e i formati immagine decodificabili dal dispositivo.
- Word: DOCX.
- Excel: XLSX e XLSM.
- PowerPoint: PPTX.
- OpenDocument: ODT e ODS.
- Apple iWork: Pages, Numbers e Keynote quando il documento contiene un’anteprima PDF o grafica leggibile.
- Testo: TXT, Markdown, CSV, TSV, RTF, HTML, XML, LOG ed email testuali.

I vecchi formati binari `.doc`, `.xls` e `.ppt` devono essere prima salvati come DOCX, XLSX, PPTX oppure PDF.

## Riconoscimento della scheda

Il motore ricostruisce:

- giorni di allenamento;
- gruppi muscolari;
- nomi degli esercizi anche su più righe;
- serie e ripetizioni, sulla stessa riga o su righe separate;
- layout verticali, orizzontali, tabellari e multicolonna;
- target diversi per singola serie;
- serie numeriche e sigle come `BO`, `DROP` e `RP`;
- prescrizioni come `2x8-10 + 1 DROP`, `2x10-12 + 1 BO 15` e `12/10/8/6`;
- note come TUT, RIR, RPE, superserie e recuperi.

Se un file Word, PowerPoint, Excel o OpenDocument contiene la scheda soltanto come immagine, VANTA prova automaticamente a leggere le immagini incorporate tramite OCR.

Prima del salvataggio viene sempre mostrata un’anteprima modificabile. Puoi correggere nome, giorno, serie, etichette, ripetizioni, recuperi, gruppo muscolare e note oppure escludere le righe errate.

## Privacy e funzionamento

L’analisi avviene nel browser. I documenti non vengono caricati su un server. Il motore OCR italiano e inglese è incluso nei file dell’app; la prima lettura di una foto può richiedere più tempo perché il browser deve caricarne i componenti dal sito pubblicato.

Schede, storico, foto profilo e preferenze restano nella memoria locale del dispositivo. Prima di aggiornare, disinstallare o cancellare i dati del browser usa **Profilo → Esporta backup**.

## Limiti inevitabili

Non esiste un riconoscimento automatico capace di interpretare senza errori ogni documento possibile. Foto sfocate, grafica sovrapposta, scrittura a mano, abbreviazioni ambigue o file proprietari senza anteprima possono richiedere una correzione nell’anteprima. L’app evita di salvare direttamente un’importazione senza mostrare prima i dati riconosciuti.

## Altre funzioni principali

- Serie con etichette libere: `1`, `2`, `BO`, `DROP`, `RP`, `W1` e altre sigle.
- Fantasma dell’allenamento precedente, serie per serie.
- Registrazione di peso, ripetizioni, completamento, recupero e note.
- Storico, volume, record e grafici dei progressi.
- Catalogo paginato con 121 esercizi, tecnica, muscoli, errori comuni, alternative e accesso a YouTube.
- Associazione automatica o manuale degli esercizi al catalogo.
- Nome, obiettivo, unità di misura e foto profilo personalizzabili.
- Backup JSON, condivisione delle schede e modalità PWA.
