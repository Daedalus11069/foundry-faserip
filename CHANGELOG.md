# Changelog

All notable changes to the FASERIP system will be documented in this file.

## [1.3.0-1.4.0]

### Added

#### Armor Piercing System

- **Hybrid armor piercing mechanic** with flat reduction + percentage bypass
  - **Step 1:** Flat reduction = max(0, piercingRankValue - armorRankValue)
  - **Step 2:** Percentage bypass based on rank difference (10% per rank step, max 50%)
  - **Step 3:** Effective armor = remainingAfterFlat × (1 - percentageBypass/100)
  - Applied to powers, weapons, and combat attacks
  - Full integration with damage calculation system
- **Armor piercing UI in PowersTab**
  - Rank dropdown with "None" option (nullable)
  - Shows rank names with numeric values (e.g., "Typical (6)")
  - Armor piercing saves properly in character data
- **Armor piercing UI in WeaponsTab**
  - 3-column grid layout: Damage | Piercing | Material
  - Rank values displayed alongside names
  - Default value: empty string ("None")
- **Charman armor piercing integration**
  - Database columns: `armor_piercing` for powers, `piercing` for weapons
  - Validation layer with rank normalization (SHIFT_0 → Shift0)
  - API normalization (Shift0 → SHIFT_0) for frontend consistency
  - Full serialization/unserialization support
  - UI dropdowns with rank values in power/weapon editors

#### Two-Stage Resistance System

- **Stage 1: Flat damage reduction** equal to resistance rank value
  - Example: Class 1000 resistance reduces damage by 1000 first
- **Stage 2: Percentage reduction on overflow** via Universal Table roll
  - If damage exceeds resistance value, roll d100 on Universal Table
  - White = 0% additional reduction (full overflow damage)
  - Green = 25% reduction on overflow
  - Yellow = 50% reduction on overflow
  - Red = 75% reduction on overflow
- **Resistance display in StatsTab** with both stages explained
  - Clear tooltips explaining two-stage mechanics
  - Visual indicators for different resistance types

#### Combo Attack Enhancements

- **Combo attack exhaustion system**
  - Combos cannot go below Feeble rank (exhaustion floor)
  - Maximum combo count dynamically calculated based on effective rank
  - Exhaustion warning appears in dialogs when combo reaches Poor rank or below
  - Chat notification when character becomes exhausted: "Cannot dodge for rest of round"
  - Applied to all combo attack paths (fighting, weapons, powers, attributes)
- **Combo botch breaking system**
  - Combos immediately stop when roll result is 1-5 (botch)
  - Implemented in all four combo code paths:
    - StatsTab fighting combo loop
    - StatsTab weapon combo loop
    - StatsTab attribute combo loop
    - combat-flow multi-target handling
  - Chat notification shows which attack botched and how many were cancelled
  - Multi-target attacks respect combo breaking (no further targets after botch)

#### Configuration & UI

- **Configurable vulnerability damage increase** setting
  - New game setting `vulnerabilityDamageIncrease` (default: 25%)
  - Range slider from 0% to 100% (5% increments)
  - Accessible via Game Settings → FASERIP Settings
  - Allows GMs to customize vulnerability house rule severity
- **Mental Points conditional visibility**
  - New game setting to show/hide Mental Points resource
  - Config-based conditional display in character sheets
  - Backwards compatible with existing characters

### Changed

- **Vulnerability display now shows configured percentage** in StatsTab
  - Dynamic percentage display (e.g., "+30% damage from fire" instead of hardcoded "+25%")
  - Tooltip includes reference to configurable setting
- **Damage calculation uses dynamic vulnerability percentage**
  - Updated `damage-application.ts` to read from game settings
  - Vulnerability now applies configured percentage instead of hardcoded 25%
- **Rank displays show numeric values** alongside rank names
  - Format: "Rank Name (value)" (e.g., "Remarkable (30)")
  - Applied to armor piercing dropdowns, power ranks, and stat displays
  - Improves clarity for players understanding mechanical values
- **PowersTab armor piercing dropdown** with rank values
  - Shows "None" option for powers without armor piercing
  - Displays integer values in parentheses
  - Proper null handling in rank-select component

### Fixed

- **Combo attack rank penalty calculation**
  - Fixed bug where combo penalties hit rank floor prematurely
  - Now combines all chart shifts (penalty + bonuses) in single operation
  - Previously: Applied penalty first (hit Shift0 floor), then added bonuses
  - Now: Calculates net shift before applying (e.g., -7 penalty + 4 talent = -3 net)
  - Affects `AttackOptionsDialog.vue`, `ComboDialog.vue`, and karma cost calculations
  - Resolves issue where high-count combos showed same rank for multiple attacks
- **Form-specific power ranks display**
  - Fixed `unserializePowers()` losing form-specific power rank overrides
  - Changed from `flatMap()` to `mapWithKeys()->toArray()` to preserve structure
  - `appForms` property now properly initialized as object instead of array
  - Form-specific power ranks now display correctly in character sheets
- **Armor piercing null handling**
  - Added nullable prop support in rank-select component
  - Fixed crashes when armor piercing value is null/undefined
  - "None" option properly saves as empty string
- **StringField validation for armor piercing**
  - Added `blank: true` to allow empty string values
  - Prevents validation errors when armor piercing is not set
- **TypeScript compilation errors in socket system**
  - Fixed 26 TypeScript errors in `faserip-socket.ts`
  - Proper type guards for Foundry Game API properties
  - Replaced invalid `Collection.get()` calls with `find()` method
  - Removed unused variable declarations
  - Fixed VueDialog instantiation pattern
  - Added null safety checks for canvas and token properties

### Technical Details

**Major System Changes:**

- Armor piercing calculation integrated into `damage-application.ts`
- Two-stage resistance system in `damage-application.ts`
- Combo botch detection in 4 separate code paths
- Enhanced rank display utilities in `enums.ts` with `formatRankDisplay()`

**Database Schema (Charman):**

- Added `armor_piercing` column to powers table
- Added `piercing` column to weapons table
- Rank validation and normalization in Models layer
- API transformation layer for frontend compatibility

**UI Components Updated:**

- `PowersTab.vue` - Armor piercing dropdown with rank values
- `WeaponsTab.vue` - 3-column grid with piercing column
- `StatsTab.vue` - Resistance display, combo botch handling
- `AttackOptionsDialog.vue` - Combined chart shift calculation
- `ComboDialog.vue` - Combined chart shift calculation
- `rank-select.vue` - Nullable prop support, rank values display

---

## [1.2.0] - 2026-05-31

### Added

#### Combat System Overhaul

- **Complete combat flow implementation** with attack/defense/damage resolution
  - New combat flow system in `combat/combat-flow.ts` (1000+ lines)
  - Defense response modal for choosing parry/dodge/auto-dodge
  - Counter-attack modal for responding to successful defenses
  - Socket-based multiplayer combat support via `faserip-socket.ts`
  - Attack options dialog with called shots, pull punch, and situational modifiers
  - Defense options dialog with dodge/parry selection and karma spending

#### Armor & Health Management

- **Degrading armor system** with damage tracking and repair functionality
  - Armor now takes damage before health
  - Each armor piece tracks current/max durability
  - Armor repair UI in ArmorTab
  - Armor rank and absorption details shown in tooltips
- **Enhanced health management UI** moved to actor sheet header
  - Quick-access damage/healing controls
  - Compact armor display with comma-separated list
  - Armor tooltip shows rank + remaining absorption

#### Powers & Weapons

- **Target healing and armor repair** for healing/repair powers
  - Healing powers can now heal other characters by selecting target tokens
  - Armor repair powers can repair **any equipped armor** or Body Armor power
  - **Armor selection dialog** appears when multiple armor options are available (equipped armor + Body Armor power)
  - Automatically selects armor if only one option exists
  - Falls back to self-healing/repair when no targets selected
  - Chat messages show individual results for each target
  - Supports multiple targets simultaneously
- **Resistance powers** now separated from regular powers in UI
  - Special resistance display section in StatsTab
  - Visual indicators for resistance types (poison, disease, etc.)
- **Weapon system** with equipment states and quick-roll interface
  - New WeaponsTab component
  - Equip/unequip functionality
  - Melee weapons use Strength + CS for damage
  - Ranged weapons use fixed damage rank
  - Quick-roll buttons in StatsTab

#### Documentation

- `docs/COMBAT_FLOW.md` - Complete combat system documentation
- `docs/COMBAT_DEFENSE_FLOW.md` - Defense mechanics documentation

### Changed

#### Type Safety & Architecture

- **Complete TypeScript type system overhaul**
  - Implemented Lancer-style generic typing for `FaseripActor<SubType>`
  - Added type guards: `is_pc()`, `is_npc()`
  - Created `ReactiveActorData` interface for Vue reactive proxies
  - Updated all actor/item type definitions
  - Eliminated all `any` types in actor sheet files
- **Reactive data flow improvements**
  - Removed unnecessary `actor.update()` calls in favor of reactive sync
  - `watchIgnorable` in FsrBaseSheet handles automatic persistence
  - Cleaner component code with direct reactive mutations

#### UI/UX Improvements

- **Powers now rolled from StatsTab** (PowersTab is for management only)
- **Enhanced roll result display** with combined chat cards for healing/repair
- **Improved damage/healing notifications** with before/after values
- **Ultimate botch (roll 1) and regular botch (roll 2-5)** detection added
- **Better form management** with visual indicators for primary forms

#### Chat & Messaging

- **Enhanced combat chat messages** with structured flags:
  - `combatMessageType`: "strike" | "defense" | "damage" | "counterAttack"
  - Attack/defense metadata for combat tracking
  - Strike roll concealment until after defense chosen

### Fixed

- **No target warning** - Clear notification when using damage powers/weapons without selecting a target
- **Armor repair clamping** - Armor repair now properly capped at maximum value to prevent over-repair
- **Mental Points (MP) deduction** now properly tracked in StatsTab only
- **Actor/token name sync** via hooks to keep names consistent
- **Charman integration** updates for all resource changes (health, karma, MP)
- **Form-specific power filtering** working correctly
- **TypeScript strict mode compliance** across all files

### Technical Details

**Files Added:**

- `src/module/combat/combat-flow.ts` - Core combat system (~1044 lines)
- `src/module/socket/faserip-socket.ts` - Multiplayer support (~1022 lines)
- `src/module/applications/DefenseResponseModal.vue` - Defense choice UI
- `src/module/applications/CounterAttackModal.vue` - Counter-attack UI
- `src/module/applications/dialogs/AttackOptionsDialog.vue` - Attack modifiers
- `src/module/applications/dialogs/DefenseOptionsDialog.vue` - Defense modifiers
- `src/module/actor/shared/WeaponsTab.vue` - Weapon management
- `src/module/types/actor-system.ts` - Complete type definitions

**Major Changes:**

- 32 files changed
- 6,981 additions, 401 deletions
- Zero TypeScript errors across entire codebase

**Breaking Changes:**

- Powers must now be rolled from StatsTab quick-roll interface
- Armor schema updated to include degradation tracking
- Actor system data structure enhanced with weapon support

---

## [1.1.6] - 2026-05-28

Previous stable release.

[1.2.0]: https://github.com/yourusername/foundry-faserip/compare/v1.1.6...v1.2.0
[1.1.6]: https://github.com/yourusername/foundry-faserip/releases/tag/v1.1.6
