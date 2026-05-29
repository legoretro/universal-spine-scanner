# Hosting Setup

Simple version:

1. Create a private GitHub repo for this folder only.
2. Deploy that repo as a Node web service.
3. Add environment variables in the hosting dashboard.
4. Open the hosted URL on your phone.
5. Add it to your phone home screen.

Use the same Supabase project:

1. Open Supabase.
2. Go to SQL Editor.
3. Run `supabase/schema.sql`.
4. In the hosting environment variables, add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_SCANS_TABLE=spine_scans`

Use eBay real-time lookup:

Add these hosting environment variables:

- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_MARKETPLACE_ID=EBAY_US`
- `EBAY_CURRENCY=USD`
- `ALLOWED_ORIGINS=https://legoretro.github.io`

Important:

- GitHub stores code only.
- Hosting stores secrets.
- Supabase stores scanned item rows.
- The phone browser never sees your private eBay or Supabase keys.

Using GitHub Pages plus a backend:

1. Deploy this repo as a Node web service.
2. Copy the backend URL, for example `https://your-app.onrender.com`.
3. Open the GitHub Pages scanner.
4. Paste that URL into `Live eBay backend URL`.
5. Tap `Save live data URL`.

Sold-listing data:

The scanner tries eBay sold lookup through the backend. If eBay does not allow the sold-data scope on your key yet, the scanner still opens the eBay sold-search page so you can check manually.
