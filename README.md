# Universal Spine Scanner

This is the phone scanner app only. It is separate from the local eBay listing/publishing studio.

GitHub Pages practice URL after Pages is enabled from the `/docs` folder:
- `https://legoretro.github.io/universal-spine-scanner/`

Practice mode can scan photos, run OCR, save on the phone, export CSV, and open eBay/Google/Amazon search links.
Exact eBay value math and Supabase syncing need backend hosting later because private keys cannot go inside GitHub Pages.

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
