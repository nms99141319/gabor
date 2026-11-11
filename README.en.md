# Gabor Patch Vision Training

[繁體中文](README.md) | English

A purely front-end (HTML + CSS + JavaScript, no backend, no database) vision
training web tool. On ordinary LCD/OLED screens it briefly flashes Gabor
patches (stripe patterns with a Gaussian envelope) to help practice
astigmatism (orientation discrimination) and contrast sensitivity
(myopia-like training). The interface uses high contrast and text + symbol
feedback, making it friendly to users with color vision deficiency.

> This tool is only a vision-training aid. It does not replace an eye exam or
> medical diagnosis. Please wear suitable corrective glasses while training
> (astigmatism training requires glasses that include the astigmatism
> correction).

## What this project does

- **Astigmatism orientation discrimination**: a "reference orientation" is
  flashed briefly, followed by a stripe pattern rotated slightly; the user
  judges whether it was rotated clockwise or counterclockwise.
- **Contrast sensitivity training**: a low-contrast pattern is flashed briefly
  on the left or right side of the screen; the user judges which side it
  appeared on.
- **Eye modes**: right eye / left eye / both eyes / alternating both eyes
  (during training, the app prompts you to cover an eye and switches
  automatically at the halfway point).
- **Difficulty modes**:
  - Manual difficulty (fixed angle difference / contrast, with preset levels).
  - Automatic difficulty (staircase method: orientation discrimination uses
    2-down-1-up, converging to about 70.7% accuracy; contrast sensitivity uses
    3-down-1-up, converging to about 79.4% accuracy).
- **Countdown-timed training, arrow-key answering, daily training tracking,
  and history records (individual entries can be deleted)**.

## How data is stored

The whole app has **no server and no account system**. All data lives only in
the user's own browser `localStorage`, stored as JSON under these three keys:

| localStorage key       | Content                                                          | When written                                            |
|------------------------|------------------------------------------------------------------|---------------------------------------------------------|
| `gaborTrainingHistory` | Record of each session (time, eye mode, mode, accuracy, etc.)    | One entry added when a session ends (completed or aborted) |
| `gaborThresholds`      | Full convergence state of each automatic-difficulty staircase (see below) | Updated only for sessions that finish normally |
| `gaborAxisSettings`    | Astigmatism axis values for left/right eye (default 0 if unset)  | Saved immediately whenever an axis input is changed     |

Because data is stored only in the local browser, **switching browsers or
devices, or clearing browser data, will make the records disappear**, and
devices do not share data by default. To continue across devices, see
"Cross-device sync" below.

## Using previous training results to adjust difficulty

When "automatic difficulty" is enabled, the app remembers the full current
state of every staircase (split by "eye mode × training type", up to 6:
orientation / contrast sensitivity for each of left and right eye, plus
orientation / contrast sensitivity for both-eyes mode) — including the current
angle difference / contrast, consecutive-correct count, reversal history, and
the last adjustment direction — rather than just the last value.

- **The next session continues from the previous difficulty** instead of
  warming up from the defaults (15° / 50% contrast) every time. This matters
  especially for short (3–5 minute) sessions, because a single staircase often
  cannot collect enough reversals in one session and needs to accumulate across
  sessions to approach the true threshold.
- **Only sessions that run to normal completion write back the difficulty
  state.** If you stop early with the "End training" button, the data is
  treated as unreliable and **does not overwrite the saved difficulty**,
  preventing interruptions or accidental clicks from polluting long-term
  convergence.
- Each staircase converges independently (e.g. right-eye orientation and
  left-eye contrast sensitivity accumulate their own reversals) and does not
  affect the others.
- There is currently no built-in "reset difficulty" button. To start over from
  the defaults, run `localStorage.removeItem('gaborThresholds')` in the
  browser developer tools.

## Cross-device sync (text code, unencrypted)

The "Cross-device sync (text code)" section at the bottom of the page packs
`gaborAxisSettings` and `gaborThresholds` (axis settings + difficulty
convergence state, **excluding history**, to keep the code short) into a piece
of JSON text:

1. On the source device, click "Generate sync code" → "Copy".
2. Paste the text into the import field on the other device and click "Import
   sync code" to apply it (you are asked to confirm before current settings are
   overwritten).

> This code is **not encrypted**. It is plain JSON containing only axis and
> difficulty numbers, with no personal information. If you pass it through
> third-party channels such as chat apps or cloud drives, evaluate the leakage
> risk of that channel yourself.

## Usage

A purely static web page. Open `index.html` with any local server or static
hosting (e.g. GitHub Pages):

```bash
python -m http.server 8000
# Open http://localhost:8000/index.html in your browser
```

## File structure

- `index.html` — page structure (settings / eye cover / training / summary /
  history / cross-device sync)
- `app.js` — all logic (state machine, Gabor patch rendering, staircase
  algorithm, localStorage read/write, cross-device sync)
- `style.css` — styling (high contrast, color-blind friendly, training screen
  fills the viewport on a single page)
