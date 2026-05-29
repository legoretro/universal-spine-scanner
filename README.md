# Universal Spine Scanner

This is the phone scanner app only. It is separate from the local eBay listing/publishing studio.

GitHub Pages practice URL after Pages is enabled from the `/docs` folder:
- `https://legoretro.github.io/universal-spine-scanner/`

Practice mode can scan photos, run OCR, save on the phone, export CSV, and open eBay/Google/Amazon search links.
Exact eBay value math and Supabase syncing need backend hosting later because private keys cannot go inside GitHub Pages.
After a backend is hosted, paste its URL into `Live eBay backend URL` in the scanner. Then the cards can load eBay active/sold samples, median price, STR, and score color directly inside the page.

Live stack mode:
- Upload one photo with many visible spines.
- Tap "Scan stack now."
- It OCRs each row and shows eBay value cards inside the page when the backend is connected.
- Type the item count for best multi-item splitting.
- Add sold count, active count, and price to calculate STR/color in practice mode.

Score colors:
- Red: below 10% STR or below $10.
- Yellow: above 10% STR and above $10.
- Green: above 50% STR and above $20.
- Gold: above 70% STR and above $50.

What stays private:
- eBay keys stay in `.env` locally or hosting environment variables.
- Supabase service role key stays in `.env` locally or hosting environment variables.
- No API keys are placed in frontend code.

Main phone URL after hosting:
- `/scanner.html`
- `/` also opens the scanner.

Backend routes:
- `/api/lookup-ebay`
- `/api/lookup-books`
- `/api/save-scan`
- `/api/get-scans`

Supabase:
- Use the same Supabase project.
- Run `supabase/schema.sql` once in Supabase SQL editor.
