# Martial Poise Trainer

A web-based mechanics trainer for Kalista from League of Legends. This tool helps players practice attack-moving, rhythm, and kiting mechanics in a controlled environment.

## Project Structure

The project has been refactored into a modular structure:

```text
Martial Poise Trainer/
├── index.html          # Main entry point
├── style.css           # Application styles
└── js/
    ├── app.js          # Main game loop and UI logic
    └── kalista-model.js # Reusable Kalista stats and physics model
```

## Running the Project

Since this project uses ES6 Modules (`import`/`export`), you must serve it over HTTP/HTTPS. It will not work if you open `index.html` directly from the file system.

**Using Python:**
```bash
python -m http.server 8000
```
Then open `http://localhost:8000` in your browser.

## Kalista Model API

The core logic for Kalista's stats has been extracted to `js/kalista-model.js` for reusability.

### Importing
```javascript
import { KalistaModel, KALISTA_CONSTANTS } from './js/kalista-model.js';
```

### `KalistaModel` Class

#### `calculateWindup(currentAS)`
Calculates the windup time (time before dash/attack launch) based on Attack Speed.
*   **currentAS**: `number` - The current Attack Speed.
*   **Returns**: `number` - Windup time in seconds.

#### `calculateMoveSpeed(bootsTier)`
Calculates movement speed based on boots tier.
*   **bootsTier**: `number` (0, 1, or 2)
*   **Returns**: `number` - Movement speed in pixels/sec (scaled).

#### `getDashRanges(bootsTier)`
Returns the dash distances for backward and forward jumps.
*   **bootsTier**: `number` (0, 1, or 2)
*   **Returns**: `{ back: number, fwd: number }`

#### `calculateDamage()`
Calculates raw attack damage.
*   **Returns**: `number`

#### `calculateDamageTaken(rawDamage)`
Calculates damage taken by the player after armor mitigation.
*   **rawDamage**: `number`
*   **Returns**: `number`

### Constants
You can also access raw constants via `KALISTA_CONSTANTS`.

<p align="center">
  <img src="KalistaInfoGraphy.png" alt="Kalista Infography" />
</p>
