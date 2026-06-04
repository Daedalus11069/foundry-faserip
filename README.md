# Foundry VTT - FASERIP System

A Foundry VTT game system for Marvel Super Heroes RPG (FASERIP) with integrated character import from the Charman API.

## Features

- **Full FASERIP Implementation**: All seven attributes (Fighting, Agility, Strength, Endurance, Reasoning, Intuition, Psyche)
- **Rank-Based System**: Complete rank progression from Feeble to Beyond
- **d100 Rolling**: Universal Table implementation with White/Green/Yellow/Red results
- **Initiative System**: Rank-based initiative rolls (e.g., 1d10 for Good rank)
- **Multiple Forms**: Support for characters with alternate identities/forms
- **Powers & Talents**: Manage character abilities and talents
- **Charman Integration**: Import characters directly from your Charman API
- **House Rules**: Configurable health calculation, Mental Points system, armor system
- **Vue 3 Interface**: Modern, reactive character sheets built with Vue 3 + TypeScript

## Installation

### First-Time Setup

1. **Install System**:

https://github.com/Daedalus11069/foundry-faserip/releases/latest/download/system.json

2. **Configure Charman API** (optional):

- Go to **Game Settings → System Settings → Charman API URL**
- Enter your Charman API base URL (e.g., `https://yoursite.com/charman`)
- Required only if you want to import characters from Charman

### Development

# Start dev server (recommended)

npm run dev

# Or for remote access

npm run dev-remote

# Smart build (checks if dev server is running)

npm run auto-build

# Force production build

npm run build

# Type checking

npm run typecheck

```

## Architecture

Based on the Dimensional War system architecture:

```

src/
├── faserip.ts # System entry point
├── faserip.css # Global styles (fsr-\* prefix)
└── module/
├── enums.ts # ActorType, Rank, Attribute enums
├── utils.ts # Utility functions
├── documents.ts # FaseripActor class
├── charman-service.ts # Charman API integration
├── data-models/
│ ├── ActorDataModels.ts # PcDataModel, NpcDataModel
│ └── index.ts
├── actor/
│ ├── FsrBaseSheet.ts # Base sheet (Vue mounting)
│ ├── ActorSheets.ts # PcSheet, NpcSheet
│ └── shared/
│ ├── ActorSheet.vue # Root component
│ ├── StatsTab.vue # Stats & rolling
│ ├── PowersTab.vue # Powers management
│ ├── TalentsTab.vue # Talents management
│ └── BiographyTab.vue # Biography & Charman import
└── rolling/
├── FaseripRoll.ts # d100 rolling system
└── index.ts

```

## FASERIP Mechanics

### Attributes

- **Fighting**: Combat ability
- **Agility**: Dodging and reflexes
- **Strength**: Physical power
- **Endurance**: Durability and health
- **Reasoning**: Logic and problem-solving
- **Intuition**: Awareness and initiative
- **Psyche**: Mental fortitude and willpower

### Rank System

| Rank        | Value | Description          |
| ----------- | ----- | -------------------- |
| Feeble      | 2     | Very weak            |
| Poor        | 4     | Below average        |
| Typical     | 6     | Average human        |
| Good        | 10    | Above average        |
| Excellent   | 20    | Peak human           |
| Remarkable  | 30    | Low superhuman       |
| Incredible  | 40    | Mid superhuman       |
| Amazing     | 50    | High superhuman      |
| Monstrous   | 75    | Very high superhuman |
| Unearthly   | 100   | Cosmic level         |
| Shift X     | 150   | Cosmic+              |
| Shift Y     | 200   | Cosmic++             |
| Shift Z     | 500   | Cosmic+++            |
| Class 1000+ | 1000+ | God-tier             |

### Rolling System

**Standard Checks (d100)**:

- Roll 1d100
- Compare to attribute value + bonus
- Results:
  - **White**: Miss (roll > target)
  - **Green**: Typical Success (20-49% of target)
  - **Yellow**: Good Success (50-94% of target)
  - **Red**: Amazing Success (95-100% of target)

**Initiative**:

- Roll 1d{rank value} based on Intuition
- Example: Intuition at Good (10) = roll 1d10

### Resources

- **Health**: Based on house rule setting (default: F+A+S+E sum, optional: Endurance × 2)
- **Karma**: Accumulated points (default max: 100)

## Charman Integration

### API Structure

The system expects a Charman API with the following endpoints:

```

GET /api/characters/{username}/{characterName}
GET /api/characters/{username}

````

### Character Import

1. Open a character sheet
2. Go to the "Biography" tab
3. Click "Import from Charman"
4. Enter username and character callname
5. Click "Import"

The system will:

- Import all seven FASERIP attributes
- Create forms for multiple identities
- Import powers, talents, equipment, and contacts
- Calculate initial health from Endurance
- Store sync metadata for future updates

### Data Mapping

| Charman Field | FASERIP Field                  |
| ------------- | ------------------------------ |
| `fighting`    | `forms[].attributes.fighting`  |
| `agility`     | `forms[].attributes.agility`   |
| `strength`    | `forms[].attributes.strength`  |
| `endurance`   | `forms[].attributes.endurance` |
| `reasoning`   | `forms[].attributes.reasoning` |
| `intuition`   | `forms[].attributes.intuition` |
| `psyche`      | `forms[].attributes.psyche`    |
| `powers[]`    | `system.powers[]`              |
| `talents[]`   | `system.talents[]`             |
| `forms[]`     | `system.forms[]`               |

## Vue Component Usage

### Injections Available

All Vue components have access to:

```typescript
const reactiveActor = inject("reactiveActor"); // Reactive clone
const actor = inject("actor"); // Real Actor document
const sheet = inject("sheet"); // Sheet instance
````

### Data Flow Pattern

```typescript
// 1. Mutate reactiveActor for immediate UI reactivity
reactiveActor.system.resources.health.value = newValue;

// 2. Persist happens automatically via watcher
// Or manually:
await actor.update({ "system.resources.health.value": newValue });

// Or use sheet helper:
await sheet.saveSystem({ "resources.health.value": newValue });
```

### Saving Arrays

Always serialize arrays before saving:

```typescript
// ✅ CORRECT
await actor.update({
  "system.powers": JSON.parse(JSON.stringify(reactiveActor.system.powers))
});

// ❌ WRONG
await actor.update({ "system.powers": reactiveActor.system.powers });
```

## Customization

### House Rules Configuration

The system includes several configurable house rules accessible via **Game Settings → System Settings**:

#### Health Calculation Method

Choose how character health is calculated:

- **FASE Sum** (default): Health = Fighting + Agility + Strength + Endurance
- **Endurance × 2**: Health = Endurance value × 2 (classic rule)

Changing this setting will automatically recalculate health for all characters.

#### Mental Points (MP) System

Optional resource system where:

- MP = Reasoning + Intuition + Psyche
- Powers can have MP costs
- MP is tracked alongside Health and Karma

#### Armor / Equipment System

House rule for physical damage reduction:

- Adds an Armor tab to character sheets
- Armor has a rank value that absorbs incoming damage
- Equipped armor reduces damage before it affects Health

#### Lock Player Stat Editing

Prevents players from editing character attributes (Fighting, Agility, etc.) on their sheets:

- Players can still edit Health, Karma, Powers, and Equipment
- GMs retain full editing access
- Players can still import/sync from Charman

### Adding New Tabs

1. Create a new Vue component in `src/module/actor/shared/`
2. Import it in `ActorSheet.vue`
3. Add to the tabs array
4. Add the tab content in the template

### Modifying Ranks

Edit `src/module/enums.ts`:

- Add new ranks to the `Rank` enum
- Update `RANK_VALUES` with numerical values

### Custom Roll Types

Extend `src/module/rolling/FaseripRoll.ts` with new roll methods.

## CSS Conventions

All CSS classes use the `fsr-` prefix:

- `.fsr-sheet` - Main sheet container
- `.fsr-header` - Header section
- `.fsr-tabs` - Tab navigation
- `.fsr-tab` - Individual tab
- `.fsr-content` - Tab content area
- `.fsr-stat` - Stat block
- `.fsr-resource` - Resource display
- `.fsr-btn` - Button
- `.fsr-input` - Input field
- `.fsr-list` - List container
- `.fsr-list-item` - List item

## Hooks Pattern

Uses direct `Hooks.on/off` (no HookManager):

```typescript
const myCallback = (actor: any) => {
  /* ... */
};

onMounted(() => {
  Hooks.on("updateActor", myCallback);
});

onUnmounted(() => {
  Hooks.off("updateActor", myCallback); // Same function reference
});
```

## Roll Creation

Always use `Roll.create()` (async factory):

```typescript
// ✅ CORRECT
const roll = await Roll.create("1d100");
await roll.evaluate();

// ❌ WRONG
const roll = new Roll("1d100");
```

## Troubleshooting

### Dev server not detected

- Ensure `npm run dev` is running on port 5173 or 30001
- Use `npm run auto-build` instead of `npm run build`

### Symlink not working

- Run `linkDevEnv.bat` as Administrator
- Check Foundry data path in `vite.config.ts`

### Character not importing

- Verify Charman API URL in `src/faserip.ts`
- Check browser console for API errors
- Ensure username and character name are correct

### Vue reactivity issues

- Always mutate `reactiveActor.system` for UI updates
- Use real `actor` for Foundry methods
- Serialize arrays before saving

## License

This system is unofficial and not affiliated with Marvel or TSR.

## Credits

- Based on Marvel Super Heroes RPG (FASERIP system)
- Architecture inspired by Dimensional War system
- Built with Vue 3, TypeScript, and Tailwind CSS
