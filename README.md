<p align="center">
  <img src="frontend/logo.png" alt="Bookmark logo" width="120">
</p>

<h1 align="center">Bookmark</h1>

<p align="center">Take a photo of a flyer, get a Google Calendar event.</p>

---

You see a poster for an event, snap a picture, and Bookmark pulls out the title, date, time and place. You check the details, fix anything it got wrong, and add it to your Google Calendar.

## How it works

1. Sign in with Google.
2. Upload a photo of a flyer (or take one on your phone).
3. Gemma reads the flyer and fills in the event. If there's more than one event on it, you get one tab per event.
4. Review, edit, and add it to your calendar. You can also download an `.ics` file.

Events you've added show up under Recent Events.

## Built with

- **Frontend:** HTML designed in Google Stitch, Tailwind CSS, plain JavaScript
- **Backend:** Python, FastAPI
- **AI:** Gemma through the Gemini API
- **Google:** Sign-in (OAuth) and the Calendar API

## Running it locally
**DISCLAIMER**: Only accessable currently with developers accounts given access in Google Cloud

You'll need Python 3.10+ and Node 20+.

```bash
git clone git@github.com:b3nt0s/Bookmark.git
cd Bookmark
npm install
npm run setup
```

Then copy `backend/.env.example` to `backend/.env` and fill it in. The Gemini key and Google sign-in values are in the team Discord.

```bash
npm run dev
```

Open http://localhost:8000. Use `localhost` and not `127.0.0.1`, or Google sign-in won't work.

## Project layout

```
frontend/       pages, app.js, theme and logo
backend/        FastAPI server, flyer reading, Google sign-in and Calendar
test-flyers/    sample flyers and expected results
legacy-node/    old Node version of the flyer reader (not used)
```

To check how well the flyer reading does on the samples, run `.venv/bin/python eval_flyers.py` from the `backend` folder (needs the Gemini key).
