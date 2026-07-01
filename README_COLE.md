# Bucket List Restaurants modular app

Open `index.html` for the modular source version. It uses local JS/CSS files and `data/restaurants.js` so it works from a normal file browser.

Data source of truth: `data/restaurants.json`.

Run `python3 validate_data.py` to audit the restaurant JSON.
Run `python3 build.py` to rebuild the standalone HTML, asset-split HTML, and ZIP package in `dist/`.

For the smallest editable version, use the modular files. For a single portable file, use the generated standalone HTML in `dist/`.
