# Kat's Date Game! (Date_Game)

This is a simple PWA quiz app designed to run on GitHub Pages (like your vocab/kanji game).

## What it includes
- Study setup screen (category, question mode, answer type, display mode, questions per quiz, focus mode)
- Quiz screen (multiple choice OR typing)
- Offline support (service worker)
- Data file you can edit: `date_game_data.json`

## Deploy to GitHub Pages (quick)
1. Create a new GitHub repo (ex: `Date_Game`).
2. Upload *all* files from this folder to the repo root.
3. In GitHub: Settings → Pages
   - Source: Deploy from a branch
   - Branch: `main` / root
4. Wait for Pages to publish, then open the site.

## Customize data
Open `date_game_data.json` and edit/add items.
Each item has:
- category: day_of_month | months | weekdays | dates | full_date
- en: the English prompt/answer
- jp_kana: kana answer
- jp_kanji: kanji answer
- irregular: true/false (used by Focus mode → Irregular only)

Enjoy!
