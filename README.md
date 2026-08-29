# Installationsintyg-portal

En fristående webbapp (ingen build-process, inget Node.js krävs) för att fylla
i, spara, fota och skriva ut installationsintyg för avloppsanläggningar i
fält. Multi-tenant: flera installationsfirmor kan använda samma portal, men
ser bara sina egna intyg. Byggd för Supabase (databas + autentisering +
fillagring) och valfri statisk hosting (GitHub Pages, Netlify, Vercel).

Detta är ett **separat Supabase-projekt** från LTAR-portalen — de kan slås
ihop till en gemensam databas längre fram om ni vill (samma mönster med
`organizations`/RLS går att återanvända).

## Filer

```
index.html      – hela gränssnittet (auth / dashboard / editor)
style.css       – utseende (samma mörka tema som blanketten)
app.js          – all logik (auth, org, Supabase-anrop, foton, signatur)
config.js       – dina Supabase-uppgifter (fyll i, se nedan)
sql/schema.sql  – databastabeller, RLS-policyer och RPC-funktioner
```

## Hur behörigheter fungerar

- **Firma (organisation)** = en rad i `organizations`, identifierad av
  organisationsnummer + en autogenererad inbjudningskod.
- Den som skapar firman blir `owner`. Upp till **5 ytterligare användare**
  (6 totalt) kan gå med i samma firma via organisationsnummer +
  inbjudningskod.
- Alla i samma firma ser samma intyg (delad vy, inte personlig).
- Du (André) kan göras till **global admin** och ser då alla firmors intyg
  över hela portalen — se instruktion längst ner i `sql/schema.sql`.

## 1. Skapa Supabase-projekt

1. Gå till [supabase.com](https://supabase.com) → New project.
2. Vänta tills projektet är klart (tar ~2 min).
3. Gå till **Settings → API**. Kopiera:
   - **Project URL**
   - **anon public** key

## 2. Fyll i `config.js`

```js
const SUPABASE_URL = "https://ditt-projekt.supabase.co";
const SUPABASE_ANON_KEY = "din-anon-nyckel";
```

## 3. Kör databasschemat

1. Dashboard → **SQL Editor** → **New query**.
2. Klistra in hela innehållet från `sql/schema.sql` och tryck **Run**.
   - Skapar tabellerna `organizations`, `profiles`, `certificates`,
     `certificate_photos`, RLS-policyer, samt RPC-funktionerna
     `create_organization` och `join_organization` som används av auth-flödet.
3. Kör därefter `sql/002_offline_and_gps.sql` (New query igen).
   - Lägger till GPS-kolumner samt `client_id`-kolumner som gör att
     offline-synken kan köras om säkert utan att skapa dubbletter.

## 4. Skapa lagringsutrymme för bilder

1. Dashboard → **Storage** → **New bucket**.
2. Namn: `certificate-photos`. Välj **Private** (inte public).
3. Gå tillbaka till SQL Editor och kör om storage-policyerna längst ner i
   `sql/schema.sql` om du inte redan gjorde det i steg 3 (de kräver att
   bucketen finns för att kunna skapas).

> Obs: `app.js` använder `getPublicUrl` för att visa miniatyrbilder, vilket
> förutsätter att policyerna i schemat (SELECT för egen org) är på plats. Om
> ni vill vara extra strikta går det att byta till
> `createSignedUrl(path, 3600)` istället — det kräver bara att `photoPublicUrl`
> görs async.

## 5. (Valfritt) Slå av e-postbekräftelse för snabbare testning

Dashboard → **Authentication → Providers → Email** → stäng av
"Confirm email" under testning. Slå på det igen innan skarp drift.

## 6. Gör dig själv till global admin

1. Registrera ett konto som vanligt i appen och skapa en firma (t.ex. din
   egen konsultfirma).
2. I Supabase Dashboard → **Authentication → Users**, kopiera ditt user-id.
3. Kör i SQL Editor:
   ```sql
   update public.profiles set is_global_admin = true
   where id = '<ditt-user-id>';
   ```
4. Logga ut och in igen — nu visas ett firmafilter högst upp på dashboarden
   och du ser alla firmors intyg.

## 7. Lägg upp på GitHub

```bash
cd installationsintyg-saas
git init
git add .
git commit -m "Initial commit: Installationsintyg-portal"
git branch -M main
git remote add origin https://github.com/DITT-ANVANDARNAMN/installationsintyg-portal.git
git push -u origin main
```

## 8. Driftsätt (rekommenderas för kamera/mobil)

- **GitHub Pages**: Repo → Settings → Pages → Deploy from branch → `main` → `/ (root)`.
- **Netlify**: New site from Git → välj repot → Build command: (tomt) → Publish directory: `/`.
- **Vercel**: Import repot → Framework preset: Other → inga ändringar behövs.

Kameraupptagning (`capture="environment"` på fotofälten) fungerar bäst över
**https** på en riktig domän, vilket alla ovanstående ger automatiskt.

## Offline-läge

Appen fungerar utan uppkoppling ute i fält:

- **Appskalet** (HTML/CSS/JS) cachas av en service worker
  (`service-worker.js`) så appen går att öppna även utan täckning, efter
  första besöket. Kräver https (se driftsättning nedan) — fungerar även på
  `localhost` vid lokal testning.
- **Foton** som tas offline (eller om en uppladdning misslyckas) sparas
  lokalt i webbläsarens IndexedDB istället för att gå förlorade. De visas
  med ett ⏳-märke i formuläret tills de synkats.
- **Intygsdata** som sparas offline läggs i samma lokala kö och dyker upp i
  dashboarden med statusen "Väntar på synk".
- **Synk** sker automatiskt när enheten får uppkoppling igen (lyssnar på
  webbläsarens online/offline-event), var 60:e sekund i bakgrunden när
  online, samt manuellt via "Synka nu"-knappen högst upp. En liten prick i
  headern visar om enheten är online (turkos) eller offline (röd), plus en
  räknare för hur mycket som väntar på synk.
- Tekniskt: varje intyg och foto får ett `client_id` som genereras direkt i
  appen (oberoende av server). Synken använder `upsert(...,{onConflict:
  "client_id"})`, vilket gör att samma data aldrig skapar dubbletter även om
  synken avbryts och körs om.

## GPS-position

- Hämtas automatiskt (om enheten tillåter platsåtkomst) när ett **nytt**
  intyg öppnas — sparar installationsplatsens koordinater direkt.
- Knappen **"Hämta position nu"** går att använda när som helst, även på ett
  redan sparat intyg, för att uppdatera eller komplettera i efterhand.
- Koordinatfälten går även att fylla i eller rätta för hand, t.ex. om GPS
  inte var tillgängligt i fält.
- En **"Visa på karta"**-länk dyker upp så fort koordinater finns, och
  öppnar platsen i Google Maps.

## Hur datan är strukturerad

- `certificates` – en rad per intyg, kopplad till `org_id`. Merparten av
  blankettens ~80 fält sparas samlat i kolumnen `form_data` (jsonb) så att
  själva blanketten kan ändras i `index.html`/`app.js` utan databasmigrering.
  Ett fåtal fält (fastighetsbeteckning, kommun, datum) är egna kolumner för
  snabb sökning/listning i dashboarden.
- `certificate_photos` – en rad per uppladdat foto, med `category_key` som
  pekar på vilken av de ~25 fotokategorierna (se `PHOTO_CATEGORIES` i
  `app.js`) bilden hör till. Själva filerna ligger i Storage under
  `{org_id}/{certificate_id}/{category_key}_{tidsstämpel}.jpg`, komprimerade
  till max 1600 px och JPEG-kvalitet 0,75 innan uppladdning — samma mönster
  som LTAR-portalen.
- Signaturen sparas som base64 PNG direkt i `certificates.signature_data`.

## Nästa steg att fundera på

- **Riktig PDF-generering** istället för `window.print()` — en Supabase Edge
  Function som renderar HTML/data till PDF server-side ger ett mer
  konsekvent utskriftsresultat, särskilt värdefullt här eftersom intyget ska
  kunna bifogas tillsynsmyndighetens dokumentation.
- **Slå ihop med LTAR-portalen** till ett gemensamt Supabase-projekt med
  delad `organizations`-tabell, så att en firma har både LTAR-protokoll och
  installationsintyg under samma inloggning.
- **E-postnotis till fastighetsägaren** när ett intyg markeras klart, t.ex.
  via en Supabase Edge Function som triggas på `status = 'klar'`.
- **Kartvy** över alla installationer — nu när GPS-koordinater sparas som
  egna kolumner (`gps_lat`/`gps_lng`) går det enkelt att rita ut alla
  firmans intyg på en karta.
- **App-ikoner för "Lägg till på hemskärmen"** — `manifest.json` saknar
  ikoner idag; lägg till 192px/512px PNG:er för en fullvärdig
  installationsupplevelse på mobil.
