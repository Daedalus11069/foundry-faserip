# Token Configuration for Foundry VTT Integration

## Overview

Characters and forms can now specify custom token images, dimensions, and scale for Foundry VTT. This allows characters to have different token appearances for different forms (e.g., human form vs. powered form, different vehicle modes, etc.).

## Features Added

### 1. TypeScript Interfaces (foundry-faserip)

- Updated `CharmanCharacter` interface with token fields:
  - `tokenImage?: string` - Token image path for base form
  - `tokenWidth?: number` - Token width in grid squares (default: 1)
  - `tokenHeight?: number` - Token height in grid squares (default: 1)
  - `tokenScale?: number` - Token scale multiplier (default: 1.0)

- Updated `CharmanForm` interface with token fields:
  - `tokenImage?: string` - Token image path for this form
  - `tokenWidth?: number` - Token width in grid squares (default: 1)
  - `tokenHeight?: number` - Token height in grid squares (default: 1)
  - `tokenScale?: number` - Token scale multiplier (default: 1.0)

### 2. Foundry Integration (foundry-faserip)

- When importing/syncing characters, the primary form's token settings are applied to the actor's prototypeToken
- Token settings include:
  - `texture.src` - Token image
  - `texture.scaleX/scaleY` - Image scale
  - `width/height` - Grid dimensions

### 3. Backend Support (charman)

- Added database fields to `characters` table:
  - `tokenImage` (varchar 255) - Token image for base form
  - `tokenWidth` (integer) - Default 1
  - `tokenHeight` (integer) - Default 1
  - `tokenScale` (decimal) - Default 1.0

- Updated `FoundryController` to include token settings in API responses
- Forms stored as JSON now support object format with token settings:
  ```json
  {
    "name": "Spider-Man",
    "tokenImage": "tokens/heroes/spiderman.webp",
    "tokenWidth": 1,
    "tokenHeight": 1,
    "tokenScale": 1.2
  }
  ```

### 4. API Documentation

Updated `CHARMAN_API.md` with:

- Token field descriptions for `CharmanCharacter` and `CharmanForm`
- Usage notes explaining how token settings work
- Complete examples showing both root-level and form-level token configuration

## Usage

### For Characters Without Forms

Add token fields at the root level of the character data:

```json
{
  "id": 456,
  "name": "The Hulk",
  "callname": "Hulk",
  "image": "https://example.com/hulk-portrait.jpg",
  "tokenImage": "tokens/heroes/hulk.webp",
  "tokenWidth": 2,
  "tokenHeight": 2,
  "tokenScale": 1.5,
  "fighting": "unearthly",
  ...
}
```

### For Characters With Multiple Forms

Add token fields to each form object:

```json
{
  "id": 42,
  "name": "Peter Parker",
  "callname": "Spider-Man",
  "forms": [
    {
      "name": "Peter-Parker",
      "isPrimary": true,
      "tokenImage": "",
      "tokenWidth": 1,
      "tokenHeight": 1,
      "tokenScale": 1.0,
      "fighting": "typical",
      ...
    },
    {
      "name": "Spider-Man",
      "isPrimary": false,
      "tokenImage": "tokens/heroes/spiderman.webp",
      "tokenWidth": 1,
      "tokenHeight": 1,
      "tokenScale": 1.2,
      "fighting": "remarkable",
      ...
    }
  ]
}
```

## Token Setting Details

### tokenImage

- **Type:** String (file path)
- **Default:** Empty string (uses character portrait)
- **Format:** Relative path from Foundry's data directory or absolute URL
- **Example:** `"tokens/heroes/spiderman.webp"`

### tokenWidth / tokenHeight

- **Type:** Integer
- **Default:** 1
- **Unit:** Grid squares
- **Purpose:** Defines how many grid squares the token occupies
- **Example:** 2 = token occupies 2×2 grid squares (for large creatures)

### tokenScale

- **Type:** Float
- **Default:** 1.0
- **Range:** 0.1 to 10.0
- **Purpose:** Visual scale multiplier for the token image
- **Example:**
  - 1.0 = normal size
  - 2.0 = double size (image appears twice as large)
  - 0.5 = half size (image appears half as large)

## Behavior

### Primary Form Token Settings

When a character has multiple forms, the **primary form's** token settings are used for the actor's default prototype token. This determines how newly-placed tokens appear on the canvas.

### Form Switching (Future)

Future enhancements will allow switching between forms dynamically, which will update active tokens to use the target form's token settings.

### Backward Compatibility

- Characters without token fields default to standard values (1×1 grid, 1.0 scale)
- Existing characters are not affected; token settings are optional
- Form entries can remain as simple strings (form names) if no token configuration is needed

## Database Migration

To apply the migration:

1. Navigate to the ACP (Admin Control Panel)
2. Go to the Extensions section
3. Find "Charman" extension
4. Click "Enable" or "Refresh" to run migrations

The migration adds four new columns to the `characters` table:

- `tokenImage` (varchar 255, default '')
- `tokenWidth` (integer, default 1)
- `tokenHeight` (integer, default 1)
- `tokenScale` (decimal 3,2, default 1.0)

## Files Modified

### foundry-faserip

- `src/module/charman-service.ts` - Interface updates, conversion logic
- `CHARMAN_API.md` - Documentation with examples

### charman

- `controllers/Api/FoundryController.php` - API response formatting
- `Models/Character.php` - Type casting for token fields
- `migrations/v10x/m4_character_token_settings.php` - Database schema update

## Testing

1. **Create a test character** with token settings in charman
2. **Sync to Foundry** using the sync button in the character sheet
3. **Verify** that:
   - The correct token image is used
   - Token dimensions match specified width/height
   - Token scale is applied correctly
4. **Test multi-form characters** to ensure primary form's token settings are used

## Future Enhancements

- UI in charman for editing token settings (currently requires manual JSON editing)
- Form-switching functionality in Foundry to dynamically change token appearance
- Token animation settings (rotation, tint, effects)
- Per-form token bar configurations
