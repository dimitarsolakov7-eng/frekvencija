# Synthetic demo audio (generated)

Everything in `music/` and `announcements/` is **synthetic test audio** for development and
acceptance testing:

- `music/`: generated tone loops. They are **not real music**.
- `announcements/`: computer speech (Windows SAPI) or chime placeholders. They are **not recordings of a real person**.

Do not edit these files by hand. `npm run demo:audio` regenerates them and `manifest.json`
deterministically. `npm run seed:dev` uploads them and refuses files that no longer match the
manifest. See `docs/SEEDING.md`.
