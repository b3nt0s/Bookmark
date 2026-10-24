# OCR test results

Model: `gemma-4-26b-a4b-it`. Scores are automatic and only a first pass: 'possible' hallucinations are words that are not in the ground truth, so they include misreads and anything the ground truth left out. Check them against the real flyer.

| Flyer | Key facts exact (of 4) | Possible hallucinated words | Text similarity | Difficulty |
|---|---|---|---|---|
| flyer-01 | 4/4 | 5 possible | 92.5% | Stylized handwriting-style font on lined-paper background; photo taken through glass with reflections and tape; QR codes and decorative graphics (star, worm, globe); small print in the 'You Belong Here' badge and logo (not included in full_text, see notes); 'accomodations' is misspelled on the flyer and must stay as printed. |
| flyer-02 | 4/4 | 0 possible | 100.0% | Title is white text on a dark blue block beside photos; light gray small caption text with low contrast; five portrait photos; neighboring flyer edges visible (top-left 'AIKIDO OF SANTA CRU...' belongs to another flyer and must not appear); staples cover part of 'students!'. |
| flyer-03 | 4/4 | 2 possible | 95.2% | Black-and-white photocopy style with distressed, stencil-like display fonts; the band name 'SKALDIK' is highly stylized and hard to read; text over busy collage images; two bands side by side in the middle (reading order is ambiguous); tiny labels under band names; background collage contains stray fragments like 'NOV 27' that are not part of the event; no AM/PM on times. |

## flyer-01

### Key facts (automatic check)
- **title**: exact (expected: `The People of Color Sustainability Collective Professional Development Symposium`)
- **date**: exact (expected: `October 28th 2026`)
- **time**: exact (expected: `5:00pm to 7:30pm`)
- **location**: exact (expected: `the University Center, in the Alumni Room`)

### Words in the output that are not in the expected text
this, opportunity, is, open, all.

### Output
```
PoCSC Presents:
The People of Color
Sustainability Collective
Professional
Development Symposium

People of Color
Sustainability
COLLECTIVE

Date October 28th 2026

RSVP HERE

Time and 5:00pm to 7:30pm at
Place the University Center, in
the Alumni Room

Do you want a career in environmental work?

Join us at the PoCSC Symposium for a
light dinner and networking opportunities
within environmental professions. Learn how
these BIPOC owned businesses and local
organizations can be stepping stones in your
early career.

For questions and
accomodations email
pocsc@ucsc.edu

This opportunity is open to all.
YOU
BELONG
HERE
```

## flyer-02

### Key facts (automatic check)
- **title**: exact (expected: `ONE NIGHT ONLY: A FACULTY RECITAL`)
- **date**: exact (expected: `OCTOBER 24, 2026`)
- **time**: exact (expected: `Concert starts at 7:30 PM`)
- **location**: exact (expected: `Music Center Recital Hall UC Santa Cruz`)

### Words in the output that are not in the expected text
none

### Output
```
ONE
NIGHT
ONLY: A
FACULTY
RECITAL

(left to right) Michael McGushin, Luke Shepherd, Emily Sinclair, Greg Fritsch, and
Sheila Willey perform art songs, arias, and selections from musical theater.

OCTOBER 24, 2026
Music Center Recital Hall
UC Santa Cruz
Concert starts at 7:30 PM

Tickets & Info

Proceeds go
to support
UCSC Opera!

FREE for
UCSC students!

UC SANTA CRUZ | Arts Music
```

## flyer-03

### Key facts (automatic check)
- **title**: exact (expected: `SKA AT THE SHACK`)
- **date**: exact (expected: `11/4/26`)
- **time**: exact (expected: `DOORS AT 6:30 / MUSIC AT 7:30`)
- **location**: exact (expected: `SHANTY SHACK BREWING 138 FERN ST SANTA CRUZ CA 95050`)

### Words in the output that are not in the expected text
nov, 27

### Output
```
LAST LOCALS PRESENTS
★SKA AT THE SHACK★
SKALDIK
SKAPUNKLORIK ORCHESTRA FROM CHILE
NOV 27
THE HELLAS ROCK SHED
BAY AREA SKA PUNK RANGERS
OUTLAW SKA FROM SANTA CRUZ
$10
11/4/26
DOORS AT 6:30 / MUSIC AT 7:30
ALL AGES
SHANTY SHACK BREWING
138 FERN ST SANTA CRUZ CA 95050
```
