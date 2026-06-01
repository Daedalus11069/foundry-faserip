# Changelog

All notable changes to the FASERIP system will be documented in this file.

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
