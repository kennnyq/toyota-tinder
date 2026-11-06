## ToyotaTinder

AI ranked Toyota matchmaker with swipe style discovery for Hackathon 2025.

ToyotaTinder lets shoppers enter budget and lifestyle preferences, then uses a Toyota inventory CSV plus Google Gemini 2.5 Flash to surface best fit cars for swiping, saving, and revisiting.

**[Live site](https://www.toyotatinder.us)** · **[Demo video](https://www.youtube.com/watch?v=6Khe4kaXSIQ)** · **[Devpost](https://devpost.com/software/toyotatinder)**

| Landing | Preferences |
| --- | --- |
| ![Landing page with Start Matching call to action](docs/screenshots/home.png) | ![Preference form with price range and free-text notes](docs/screenshots/find.png) |
| **Swipe deck** | **Compare** |
| ![Swipe card for a 2025 Highlander Hybrid with Skip and Like buttons](docs/screenshots/swipe.png) | ![Side-by-side comparison of two liked Toyotas](docs/screenshots/compare.png) |

---

### Features

* **Preference intake (`/find`)**
  Simple form for budget, mileage, fuel type, use case, and notes.

* **AI ranking (`/api/analyze`)**
  Sends up to 75 filtered rows from `CarData.csv` to Gemini 2.5 Flash and expects JSON with selected IDs and reasoning.
  If Gemini fails or no API key is set, falls back to a local scoring function or random but clearly labeled matches.

* **Swipe deck (`/swipe`)**
  Stacked, draggable card deck built with Framer Motion plus click buttons for like or skip.

* **Persistent likes and results**
  Matches, AI notes, and liked cars are stored in `localStorage` so refreshes and navigation do not lose progress.

* **Lightweight auth**
  `/signup` and `/login` store accounts and a simple session token in `localStorage`. `AuthGate` protects swipe and liked routes.
  This is for demo only and not secure for production.

* **Liked garage (`/liked`)**
  Shows all liked cars and gives a clear path to restart matching or clear saved likes.

---

### Architecture

| Layer | Details                                                                                                                                      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| UI    | Next.js App Router with React 19, Tailwind CSS utilities in `src/app/globals.css`, Framer Motion animations, simple page transition wrapper. |
| Data  | `src/data/CarData.csv` loaded on the server and converted into typed `Car` objects.                                                          |
| AI    | `@google/genai` client calls Gemini 2.5 Flash with strict JSON output, with local scoring fallback.                                          |
| State | `likes.ts` wraps `localStorage` for likes and results, `AuthGate` checks a `tt-auth` token.                                                  |



### Matching Flow

1. User fills in preferences on `/find`.
2. Server filters the CSV by budget, fuel type, mileage, and optional location.
3. Up to 75 rows are sent to Gemini 2.5 Flash with `responseMimeType: application/json`.
4. Gemini returns car IDs plus short reasoning.
5. IDs map back to `Car` objects and are saved for the client.
6. `/swipe` shows the deck and records likes into a saved list used by `/liked`.
7. If Gemini response is missing or invalid, the app logs a warning and uses local scoring or random selection so the demo still works.



### Setup

Requirements: Node.js 20 or higher, npm 10 or higher, optional Gemini API key.

```bash
npm install
npm run dev       # http://localhost:3000
```

Environment variables in `.env.local`:

```bash
GEMINI_API_KEY=your-google-genai-key
```

Without a key, matching still runs using the local heuristic or random fallback with a visible warning.

Useful scripts:

* `npm run dev`  local development
* `npm run build`  production build
* `npm run start`  run built app
* `npm run lint`  run ESLint

---

