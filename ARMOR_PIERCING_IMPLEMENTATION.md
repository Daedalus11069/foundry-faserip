# Armor Piercing Implementation Progress

## Implementation Plan: Option D (Hybrid System)

- Flat reduction: (piercing rank value - armor rank value)
- Percentage bypass: 10% per rank step, max 50%

---

## ✅ Completed Steps

### 1. Data Model Updates

- ✅ Added `armorPiercing?: string` field to `PowerDataModel`
- ✅ Added `armorPiercing?: string` field to `WeaponDataModel`
- ✅ Updated `template.json` with `armorPiercing: ""` for both power and weapon

### 2. Core Utility Created

- ✅ Created `src/module/utils/armor-piercing.ts`
  - ✅ `calculateArmorPiercing()` function with full hybrid logic
  - ✅ `describeArmorPiercing()` helper for chat messages
  - ✅ `ArmorPiercingResult` interface exported

### 3. Damage Application Integration

- ✅ Updated `src/module/utils/damage-application.ts`
  - ✅ Imported armor-piercing utility
  - ✅ Added `armorPiercing?: string` to `DamageApplicationData`
  - ✅ Added `armorRank?: string` to `DamageApplicationData`
  - ✅ Added `piercingResult?: ArmorPiercingResult` to `DamageApplicationResult`
  - ✅ Applied armor piercing calculation before armor soak
  - ✅ Uses `effectiveArmor` instead of `totalArmor` for soak

### 4. UI Updates (Weapon Sheet)

- ✅ Updated `src/module/item/sheets/WeaponSheet.vue`
  - ✅ Added armor piercing dropdown with all rank options
  - ✅ Added shield-slash icon and tooltip
  - ✅ Added helpful hint text explaining the mechanic

### 5. UI Updates (Character Sheet)

- ✅ Updated `src/module/actor/shared/StatsTab.vue`
  - ✅ Added `armorPiercing` to `Weapon` interface
  - ✅ Included armor piercing in weapon data conversion from items
  - ✅ Display shield-slash icon next to weapons with armor piercing
  - ✅ Added armor piercing info to weapon tooltip

### 6. Combat Flow Integration

- ✅ Updated `src/module/combat/combat-flow.ts`
  - ✅ Added `armorPiercing?: string` to `AttackData` interface
  - ✅ Get target's armor rank from equipped armor or Body Armor power
  - ✅ Pass armor piercing and armor rank to `requestDamageApplication()`

### 7. Socket System Integration

- ✅ Updated `src/module/socket/faserip-socket.ts`
  - ✅ Added `armorPiercing` and `armorRank` to `ApplyDamageData` interface
  - ✅ Updated `requestDamageApplication()` signature to accept piercing params
  - ✅ Pass piercing data through all socket execution paths
  - ✅ Pass piercing data to `applyDamageToActor()` in `handleApplyDamage()`

### 8. Weapon Attack Integration

- ✅ Updated weapon attack flow in `StatsTab.vue`
  - ✅ Pass `armorPiercing` to `executeCombatAttack()` for both single and combo attacks

---

## 🔨 Remaining Steps

### 9. UI Updates (Power Editor)

- ⏳ **Need to add armor piercing field to power editing UI**
  - Powers are embedded in actor sheet (not separate item sheets)
  - Check `PowersTab.vue` for power editing interface
  - Add armor piercing dropdown similar to weapon sheet

### 10. Power Attack Integration

- ⏳ **Pass armor piercing from powers in combat flow**
  - Powers with armor piercing should pass it through `executeCombatAttack()`
  - Similar pattern to weapon attacks

### 11. Chat Message Enhancement

- ⏳ **Show armor piercing breakdown in combat chat cards**
  - Display original armor value
  - Show flat reduction amount
  - Show percentage bypass
  - Show effective armor after piercing
  - Example format:
    ```
    Armor: 30 (Good)
    - Flat Reduction: 10 (Excellent AP)
    - Remaining: 20
    - Percentage Bypass: 20% (2 CS)
    = Effective Armor: 16
    ```

### 12. Testing & Validation

- ⏳ **Manual testing scenarios:**
  - [ ] Weapon with no piercing (works as before)
  - [ ] Weapon with piercing vs no armor (damage direct to health)
  - [ ] Weapon with piercing vs low armor (mostly bypassed)
  - [ ] Weapon with piercing vs high armor (reduced but still effective)
  - [ ] Power with piercing
  - [ ] Multiple equipped armors
  - [ ] Body Armor power + equipped armor
  - [ ] Armor degradation modes (none/full/per-hit) with piercing
  - [ ] Multiplayer: GM attacking player with piercing weapon
  - [ ] Multiplayer: Player attacking player with piercing weapon

---

## 📊 Implementation Status

**Core Functionality:** ~85% Complete

- ✅ Data models and schema
- ✅ Calculation logic
- ✅ Weapon integration (complete flow)
- ✅ Socket/multiplayer support
- ✅ UI display for weapons
- ⏳ Power integration
- ⏳ Chat message display
- ⏳ Testing and validation

**Next Priority:** Power editing UI, then chat message enhancement, then thorough testing.

---

## 🎯 Quick Start Guide

### For Players: Using Armor Piercing Weapons

1. **Create or Edit a Weapon Item**
   - Open the weapon sheet
   - Find the "Armor Piercing" dropdown (below Damage Rank)
   - Select a rank (e.g., "Excellent", "Remarkable")
   - Save the weapon

2. **Attack with Piercing Weapon**
   - Equip the weapon on your character sheet
   - The weapon will show a red shield-slash icon (🛡️⚔️)
   - Attack normally - piercing is applied automatically

3. **How It Works**
   - **Flat Reduction**: Piercing rank value - target armor rank value is subtracted from armor
   - **Percentage Bypass**: 10% per rank step higher (max 50%) of remaining armor
   - Example: Excellent (20) piercing vs Good (10) armor with 30 total
     - Flat: 20 - 10 = 10 subtracted → 20 armor remains
     - Bypass: 2 rank steps × 10% = 20% bypass
     - Effective: 20 × 0.8 = 16 armor applies

### For GMs: Balance Guidelines

- **Low Piercing (Feeble-Good)**: Minor advantage against light armor
- **Medium Piercing (Excellent-Amazing)**: Significant advantage, but heavy armor still helps
- **High Piercing (Monstrous+)**: Devastating against most armor, but never 100% bypass
- **Maximum Bypass**: 50% ensures armor always provides some protection

---

## 📝 Summary

The armor-piercing system is **85% complete** with full weapon support. Weapons can now be assigned an armor-piercing rank that reduces target armor effectiveness using a hybrid system (flat reduction + percentage bypass). The system is fully integrated with multiplayer combat via sockets.

**Remaining work:** Power UI integration, chat message enhancements, and comprehensive testing.

## Technical Notes

### Armor Rank Source

- Equipped armor items have a `rank` field (e.g., "typical", "excellent")
- Body Armor power also has a `rank` field
- Need to determine which armor's rank to use when both are present
- **Recommendation:** Use equipped armor rank first, fall back to Body Armor rank

### Socket Integration

The damage application uses `requestDamageApplication()` socket function which needs to pass:

- `armorPiercing: string` from attacker's weapon/power
- `armorRank: string` from defender's armor

### Chat Template Location

Combat chat cards are rendered in `combat-flow.ts` and may use templates from:

- `templates/chat/` directory
- Inline template strings in the code
