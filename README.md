# Warázsló

Saját 3D CAD modellező webapp iPadre (és iPhone-ra), a Shapr3D mintájára – Apple Pencil támogatással,
előfizetés nélkül. Böngészőben fut, telepíthető a főképernyőre, és az első betöltés után offline is működik.

**Megnyitás:** https://m00nsc0rched.github.io/warazslo/

> iPaden Safariban: **Megosztás → Főképernyőhöz adás** – így teljes képernyős alkalmazásként indul.

## Mit tud

- **Vázlat** (csak Apple Pencillel): vonal(lánc), téglalap, középpontos téglalap, kör, 3 pontos és érintő ív,
  spline, sokszög, hosszlyuk, ellipszis, pont; vágás, sarok-lekerekítés, görbe-eltolás.
  - **Görbék mozgatása / forgatása / másolása** a vázlat síkjában, ismétléssel (lineáris és körkörös vázlat-kiosztás,
    a kijelölt pont körül), **tükrözés** a kijelölt vonalra; a belső kényszerek megmaradnak.
  - **Szöveg:** 5 betűtípus (Roboto családból, ékezetekkel), betűmagasság, betűköz, igazítás, elforgatás;
    a kijelölt szöveg egy lépésben kihúzható (dombornyomás / bemélyítés), dupla koppintással szerkeszthető.
  - **Szabadkézi rajz alakfelismeréssel:** a Pencillel húzott vonalból egyenes, ív, kör, téglalap, sokszög,
    ellipszis vagy spline lesz. **Firkálás egy görbén = törlés.**
  - Illesztés végpontokra, középpontokra, felezőpontokra, görbékre, test-csúcsokra, vízszintes/függőleges igazítás, rács.
  - Méretbuborékok: koppints a számra és írd be a pontos értéket (kifejezések is: `20+5`, `1/2in`, `3*4mm`).
  - Az egymást metsző görbékből automatikusan kijelölhető zárt régiók (lyukakkal) keletkeznek.
- **Modellezés** (OpenCascade CAD kernel): kihúzás (egy-/kétoldalú, szimmetrikus, automatikus egyesítés/kivágás),
  lap tolása/húzása, forgatás tengely körül, söprés, átmenet (loft), lekerekítés, élletörés, héjazás,
  lap eltolása (hengeres lapnál is – pl. furat átmérő), boole-műveletek, tükrözés, lineáris/kör menti kiosztás,
  szétvágás, méretezés, mozgatás/forgatás gizmóval, másolás.
- **Extrák, amik a Shapr3D-ből hiányoznak:** furat-varázsló (M2–M12, kúpos/hengeres süllyesztés), evolvens
  fogaskerék-generátor, csavar/anya generátor, alaptestek, tömeg- és térfogatszámítás anyagsűrűséggel,
  2D műszaki rajz (európai vetítés, rejtett élek, méretek, SVG/PDF/DXF), AR nézet (USDZ).
- **Nézet mód:** csak megtekintés – szabványos nézetek, körbeforgatás, metszet, mérés, izolálás.
- **Import/export:** STEP, STL (import és export), DXF (import vázlatba; export vázlatból, sík lap körvonalából és
  műszaki rajzból), 3MF, OBJ, GLB, USDZ, HTML nézet, PNG, saját `.warazslo` projektfájl.
- Visszavonás/újra, előzmények (bármely lépésre visszaugrás), automatikus mentés az eszközre.

## Kezelés

| Mozdulat | Hatás |
|---|---|
| 1 ujj húzás | a test(ek) forgatása a megfogott pont körül |
| 2 ujj húzás | nézőpont mozgatása |
| csípés | nagyítás a csípés közepe felé |
| 2 ujj csavarása | körkörös forgatás a nézési tengely körül |
| koppintás | kijelölés (több elem is), üres helyen: kijelölés törlése |
| dupla koppintás | teljes test kijelölése |
| 2 ujjas koppintás | visszavonás |
| 3 ujjas koppintás | újra |
| Apple Pencil húzás | szabadkézi rajz / vázlatpont mozgatása |

Billentyűzettel (Magic Keyboard): `E` kihúzás, `F` lekerekítés, `M` mozgatás, `H` héjazás, `O` lap eltolás,
`B` boole, `D` mérés, `X` metszet, `L/R/C/A/S/P` vázlateszközök, `T` vágás, `V` nézet mód, `1/3/7/0` nézetek,
`Z` mindent mutat, `⌘Z / ⇧⌘Z` visszavonás/újra, `⌘S` mentés.

## Adatok

A projektek a böngésző tárhelyén (IndexedDB) vannak ezen az eszközön – a repóba semmi nem kerül fel.
Fontos munkákról készíts mentést: projekt menü → *Projektfájl mentése (.warazslo)*.

## Fejlesztés

Build lépés nincs: sima ES modulok, a könyvtárak a `vendor/` mappában
(three.js 0.186, replicad 1.1, replicad-opencascadejs 1.1).

```
powershell -ExecutionPolicy Bypass -File tools/serve.ps1      # helyi szerver: http://localhost:8123
powershell -ExecutionPolicy Bypass -File tools/deploy.ps1 "üzenet"   # kiadás GitHub Pages-re
```

Tesztek a böngészőben: `tools/kernel-test.html`, `tools/regions-test.html`, valamint az alkalmazásban a
konzolból: `await (await import('/tools/app-test.js')).run()`.

Licencek: three.js (MIT), replicad (MIT), OpenCascade / replicad-opencascadejs (LGPL-2.1), opentype.js (MIT),
Roboto betűtípusok (Apache-2.0) – lásd `vendor/*/LICENSE`.
