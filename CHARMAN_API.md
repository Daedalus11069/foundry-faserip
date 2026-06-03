# Charman API Integration

This document describes the data format the FASERIP system expects from the Charman character-management service.

---

## Endpoint

```
GET {baseUrl}/charman/api/foundry/character?username={username}&callname={callname}
```

Optional `Authorization: Bearer {apiKey}` header when an API key is configured.

### Response

A single JSON object matching the [CharmanCharacter](#charmancharacter) schema below.

---

## Data Schemas

### CharmanCharacter

The root object returned by the API.

| Field         | Type                 | Required | Notes                                                                                         |
| ------------- | -------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `id`          | `number`             | ✅       | Unique character ID                                                                           |
| `owner_id`    | `number`             | ✅       | User ID of the owner                                                                          |
| `name`        | `string`             | ✅       | Real / public name — used as the Foundry actor name                                           |
| `callname`    | `string`             | ✅       | Hero/alias name — used in `/cr` chat commands                                                 |
| `image`       | `string`             | —        | Absolute URL to character portrait; uploaded into Foundry on import                           |
| `tokenImage`  | `string`             | —        | Token image path for base form (used when `forms` is absent)                                  |
| `tokenWidth`  | `number`             | —        | Token width in grid squares for base form (defaults to `1`)                                   |
| `tokenHeight` | `number`             | —        | Token height in grid squares for base form (defaults to `1`)                                  |
| `tokenScale`  | `number`             | —        | Token scale multiplier for base form (defaults to `1.0`; `2.0` = double size)                 |
| `forms`       | `CharmanForm[]`      | —        | Alternate forms/identities. If omitted or empty, stats are read directly from the root object |
| `fighting`    | `CharmanAttribute`   | —        | Base form Fighting (used when `forms` is absent)                                              |
| `agility`     | `CharmanAttribute`   | —        | Base form Agility                                                                             |
| `strength`    | `CharmanAttribute`   | —        | Base form Strength                                                                            |
| `endurance`   | `CharmanAttribute`   | —        | Base form Endurance                                                                           |
| `reasoning`   | `CharmanAttribute`   | —        | Base form Reasoning                                                                           |
| `intuition`   | `CharmanAttribute`   | —        | Base form Intuition                                                                           |
| `psyche`      | `CharmanAttribute`   | —        | Base form Psyche                                                                              |
| `powers`      | `CharmanPower[]`     | —        | List of super powers                                                                          |
| `talents`     | `CharmanTalent[]`    | —        | List of talents                                                                               |
| `equipment`   | `CharmanEquipment[]` | —        | Equipment items (imported but not rendered in sheets yet)                                     |
| `contacts`    | `CharmanContact[]`   | —        | NPC contacts                                                                                  |
| `biography`   | `string`             | —        | In-world biography text                                                                       |
| `notes`       | `string`             | —        | Player-visible notes                                                                          |
| `karma`       | `number`             | —        | Starting karma value (defaults to `0`)                                                        |

---

### CharmanAttribute

A stat value. Accepted formats:

| Format                  | Example                                 | Notes                                                 |
| ----------------------- | --------------------------------------- | ----------------------------------------------------- |
| Rank string             | `"remarkable"`                          | Any rank key from the [Rank Table](#rank-table) below |
| Rank display name       | `"Remarkable"`                          | Title-case is normalised automatically                |
| Abbreviation            | `"rm"`, `"ex"`, `"gd"`                  | Standard Marvel abbreviations                         |
| Numeric string          | `"30"`                                  | Converted to the nearest rank by value                |
| Number                  | `30`                                    | Same                                                  |
| Object with `rank` key  | `{ "rank": "remarkable", "value": 30 }` | Both fields used directly                             |
| Object with `value` key | `{ "value": 30 }`                       | Value converted to rank                               |

---

### CharmanForm

Represents one of a character's alternate forms (e.g. secret identity vs. powered form).

| Field         | Type               | Required | Notes                                                                           |
| ------------- | ------------------ | -------- | ------------------------------------------------------------------------------- |
| `id`          | `string`           | —        | Stable ID — generated on import if absent                                       |
| `name`        | `string`           | ✅       | Form display name; must not contain spaces (spaces become `-` in chat commands) |
| `isPrimary`   | `boolean`          | —        | Marks the default form; first form is primary if omitted                        |
| `tokenImage`  | `string`           | —        | Token image path for this form                                                  |
| `tokenWidth`  | `number`           | —        | Token width in grid squares (defaults to `1`)                                   |
| `tokenHeight` | `number`           | —        | Token height in grid squares (defaults to `1`)                                  |
| `tokenScale`  | `number`           | —        | Token scale multiplier (defaults to `1.0`; `2.0` = double size)                 |
| `fighting`    | `CharmanAttribute` | ✅       |                                                                                 |
| `agility`     | `CharmanAttribute` | ✅       |                                                                                 |
| `strength`    | `CharmanAttribute` | ✅       |                                                                                 |
| `endurance`   | `CharmanAttribute` | ✅       |                                                                                 |
| `reasoning`   | `CharmanAttribute` | ✅       |                                                                                 |
| `intuition`   | `CharmanAttribute` | ✅       |                                                                                 |
| `psyche`      | `CharmanAttribute` | ✅       |                                                                                 |

Stats may be nested under an `attributes` key or provided flat:

```json
// flat
{ "name": "Spider-Man", "agility": "incredible", ... }

// nested
{ "name": "Spider-Man", "attributes": { "agility": "incredible", ... } }
```

**Token Configuration:**

Token settings control how the character appears on the game canvas in Foundry VTT:

- **`tokenImage`**: Path to the token image file. If not specified, the character portrait (`image`) is used.
- **`tokenWidth` / `tokenHeight`**: Size in grid squares (e.g., `2` for a 2×2 grid creature). Defaults to `1`.
- **`tokenScale`**: Visual scale multiplier applied to the token image. `1.0` = normal size, `2.0` = double size, `0.5` = half size. Defaults to `1.0`.

When a character has **multiple forms**, the **primary form's** token settings are used for the actor's prototype token (the default appearance). If token settings are omitted from a form, defaults are used (`1` for width/height, `1.0` for scale).

When a character has **no forms** (stats at root level), use the root-level token fields (`tokenImage`, `tokenWidth`, `tokenHeight`, `tokenScale`) to configure the base token.

---

### CharmanPower

| Field               | Type                                      | Required | Notes                                                                                                                           |
| ------------------- | ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `name`              | `string`                                  | ✅       | Power name; referenced in `/cr` as a kebab-case slug                                                                            |
| `rank`              | `string \| number \| Record<string, any>` | ✅       | Rank key, display name, abbreviation, numeric value, or object with form-specific ranks (e.g. `{"Dragon": "50", "Human": "0"}`) |
| `category`          | `string`                                  | —        | Descriptive category (e.g. `"Movement"`) — defaults to `"general"`                                                              |
| `description`       | `string`                                  | —        | Flavour text                                                                                                                    |
| `mpCost`            | `string \| number`                        | —        | Mental Points cost (if MP houserule is enabled)                                                                                 |
| `effectType`        | `string`                                  | —        | Effect type: `"none"`, `"damage"`, `"heal-health"`, or `"heal-armor"` — defaults to `"none"`                                    |
| `attackType`        | `string`                                  | —        | Defense attribute: `"none"`, `"melee"` (vs Fighting), `"ranged"` (vs Agility), or `"psyche"` (vs Psyche) — defaults to `"none"` |
| `damageType`        | `string`                                  | —        | Damage type for resistance/vulnerability: `"fire"`, `"cold"`, `"energy"`, etc. — defaults to `"none"`                           |
| `resistanceType`    | `string`                                  | —        | If set, this power grants resistance to the specified damage type                                                               |
| `vulnerabilityType` | `string`                                  | —        | If set, this power represents a vulnerability/weakness to the specified damage type                                             |

**Form-Specific Ranks:**  
When `rank` is an object like `{"Dragon": "50"}`, the power will only be available in the specified forms. The system uses the highest rank value for display and automatically associates the power with the matching forms.

**Combat Integration:**

- Powers with `effectType: "damage"` deal damage using the power's rank
- Powers with `attackType` set to `"melee"`, `"ranged"`, or `"psyche"` trigger defense prompts where the defender rolls the appropriate attribute (Fighting, Agility, or Psyche)
- Non-damaging contested powers (`effectType: "none"`, `attackType: "psyche"`) are supported for Mind Control, Telepathy, and similar effects that require a contested roll but don't deal health damage

---

### CharmanTalent

| Field         | Type     | Required | Notes                                                            |
| ------------- | -------- | -------- | ---------------------------------------------------------------- |
| `name`        | `string` | ✅       | Talent name; referenced in `/cr` as `stat+talent-name`           |
| `bonus`       | `number` | ✅       | Chart-shift bonus applied when the talent is used (`+1` = +1 CS) |
| `description` | `string` | —        | Flavour text                                                     |

---

### CharmanEquipment

| Field         | Type     | Required | Notes |
| ------------- | -------- | -------- | ----- |
| `name`        | `string` | ✅       |       |
| `description` | `string` | —        |       |
| `quantity`    | `number` | —        |       |

---

### CharmanContact

| Field          | Type     | Required | Notes |
| -------------- | -------- | -------- | ----- |
| `name`         | `string` | ✅       |       |
| `relationship` | `string` | —        |       |
| `description`  | `string` | —        |       |

---

## Rank Table

| Rank key     | Display name | Value |
| ------------ | ------------ | ----- |
| `shift_0`    | Shift 0      | 0     |
| `feeble`     | Feeble       | 2     |
| `poor`       | Poor         | 4     |
| `typical`    | Typical      | 6     |
| `good`       | Good         | 10    |
| `excellent`  | Excellent    | 20    |
| `remarkable` | Remarkable   | 30    |
| `incredible` | Incredible   | 40    |
| `amazing`    | Amazing      | 50    |
| `monstrous`  | Monstrous    | 75    |
| `unearthly`  | Unearthly    | 100   |
| `shift_x`    | Shift X      | 150   |
| `shift_y`    | Shift Y      | 200   |
| `shift_z`    | Shift Z      | 500   |
| `class_1000` | Class 1000   | 1000  |
| `class_3000` | Class 3000   | 3000  |
| `class_5000` | Class 5000   | 5000  |
| `beyond`     | Beyond       | 10000 |

Common abbreviations (case-insensitive) are also accepted: `s0`, `fe`, `pr`, `ty`, `gd`, `ex`, `rm`, `in`, `am`, `mn`, `un`, `sx`, `sy`, `sz`.

---

## Full Example Response

```json
{
  "id": 42,
  "owner_id": 7,
  "name": "Peter Parker",
  "callname": "Spider-Man",
  "image": "https://example.com/images/spiderman.png",
  "karma": 75,
  "biography": "Bitten by a radioactive spider...",
  "notes": "",
  "forms": [
    {
      "id": "form-base",
      "name": "Peter-Parker",
      "isPrimary": true,
      "tokenImage": "",
      "tokenWidth": 1,
      "tokenHeight": 1,
      "tokenScale": 1.0,
      "fighting": "typical",
      "agility": "typical",
      "strength": "typical",
      "endurance": "typical",
      "reasoning": "good",
      "intuition": "good",
      "psyche": "typical"
    },
    {
      "id": "form-spiderman",
      "name": "Spider-Man",
      "isPrimary": false,
      "tokenImage": "tokens/heroes/spiderman.webp",
      "tokenWidth": 1,
      "tokenHeight": 1,
      "tokenScale": 1.2,
      "fighting": "remarkable",
      "agility": "incredible",
      "strength": "incredible",
      "endurance": "remarkable",
      "reasoning": "good",
      "intuition": "remarkable",
      "psyche": "good"
    }
  ],
  "powers": [
    {
      "name": "Wall-Crawling",
      "rank": "amazing",
      "category": "Movement"
    },
    {
      "name": "Spider-Sense",
      "rank": "incredible",
      "category": "Detection",
      "description": "Danger-sense that shifts Intuition for defensive rolls"
    }
  ],
  "talents": [
    { "name": "Acrobatics", "bonus": 1 },
    { "name": "Science", "bonus": 1, "description": "Physics and chemistry" }
  ],
  "equipment": [{ "name": "Web-Shooters", "quantity": 1 }],
  "contacts": [{ "name": "Mary Jane Watson", "relationship": "Partner" }]
}
```

**Example 2: Character Without Forms (Base Stats + Token Config at Root)**

```json
{
  "id": 456,
  "owner_id": 101,
  "name": "The Hulk",
  "callname": "Hulk",
  "image": "https://example.com/hulk-portrait.jpg",
  "tokenImage": "tokens/heroes/hulk.webp",
  "tokenWidth": 2,
  "tokenHeight": 2,
  "tokenScale": 1.5,
  "fighting": "unearthly",
  "agility": "good",
  "strength": "unearthly",
  "endurance": "unearthly",
  "reasoning": "typical",
  "intuition": "good",
  "psyche": "excellent",
  "powers": [
    {
      "name": "Body-Resistance",
      "rank": "class-1000",
      "category": "Defensive"
    },
    {
      "name": "Leaping",
      "rank": "shift-x",
      "category": "Movement"
    }
  ],
  "talents": [{ "name": "Martial-Arts-B", "bonus": 1 }],
  "biography": "Bruce Banner transforms into the unstoppable Hulk.",
  "karma": 50
}
```

---

## Write Endpoints

These are called automatically by the system during play to push resource changes back to Charman. No user action is needed; they fire in the background whenever karma or Mental Points change on a linked character.

---

### Update Karma

```
POST {baseUrl}/charman/api/foundry/character/karma
```

**Request body (JSON):**

| Field      | Type     | Notes                                                        |
| ---------- | -------- | ------------------------------------------------------------ |
| `username` | `string` | Charman account username                                     |
| `callname` | `string` | Character call name (matches `system.charman.characterName`) |
| `karma`    | `number` | New absolute karma value                                     |

```json
{
  "username": "tobey",
  "callname": "Spider-Man",
  "karma": 62
}
```

**Response:**

```json
{ "success": true }
```

Errors are silently swallowed on the client — a failed karma sync will not interrupt play.

---

### Update Mental Points

```
POST {baseUrl}/charman/api/foundry/character/mentalpoints
```

**Request body (JSON):**

| Field          | Type     | Notes                            |
| -------------- | -------- | -------------------------------- |
| `username`     | `string` | Charman account username         |
| `callname`     | `string` | Character call name              |
| `mentalpoints` | `number` | New absolute Mental Points value |

```json
{
  "username": "tobey",
  "callname": "Spider-Man",
  "mentalpoints": 18
}
```

**Response:**

```json
{ "success": true }
```

---

## Chat Command Reference

### `/r` — Quick rank roll

```
/r <rank> [rank2 ...] [# global reason]
```

| Syntax             | Effect                                              |
| ------------------ | --------------------------------------------------- |
| `/r remarkable`    | Roll d100 vs Remarkable column                      |
| `/r rm+2`          | Roll with +2 Chart Shifts                           |
| `/r ex-1`          | Roll with -1 Chart Shift                            |
| `/r gd+2k`         | Spend karma for +2 CS                               |
| `/r in@20`         | Post-roll: spend up to 20 karma to shift die result |
| `/r ex[dodge]`     | Label the roll "dodge"                              |
| `/r gd in # brawl` | Two rolls with shared heading "brawl"               |

### `/cr` / `/croll` — Character stat roll

```
/cr <callname>[/formname] <expression> [expression2 ...]
```

`callname` matches (case-insensitive, in priority order):

1. `system.charman.characterName`
2. `system.callname` (standalone call name set in the Edit tab)
3. Actor name

| Expression           | Effect                                         |
| -------------------- | ---------------------------------------------- |
| `fighting` / `f`     | Roll Fighting                                  |
| `agility+2` / `a+2`  | Roll Agility with +2 CS                        |
| `s-1`                | Roll Strength with -1 CS                       |
| `f+2k`               | Roll Fighting, spending karma for +2 CS        |
| `i@20`               | Roll Intuition, post-roll up to 20 karma shift |
| `agility+acrobatics` | Roll Agility + Acrobatics talent bonus         |
| `wall-crawling`      | Roll the Wall-Crawling power                   |
| `spider-sense`       | Roll the Spider-Sense power                    |

**Form targeting:**

```
/cr Spider-Man/Spider-Man fighting agility
/cr Spider-Man/Peter-Parker reasoning
```

Omitting `/formname` uses the character's currently active form.
