# FASERIP Roll Resolution System

## Overview

The FASERIP roll resolution system uses a **percentile (d100) roll** compared against a **Universal Table** to determine the outcome. Every roll produces a **color result** (White, Green, Yellow, Red) that determines the level of success or failure.

## Core Concepts

### Ranks

Every attribute, power, and ability in FASERIP has a **Rank** that represents its power level. Each rank has two key properties:

1. **Numerical Value**: Used for calculations and comparisons
2. **Universal Table Entry**: Defines the thresholds for color results

| Rank       | Value | Short Code | Description          |
| ---------- | ----- | ---------- | -------------------- |
| Shift 0    | 0     | s0         | Zero ability         |
| Feeble     | 2     | fe         | Very weak            |
| Poor       | 4     | pr         | Below average        |
| Typical    | 6     | ty         | Average human        |
| Good       | 10    | gd         | Above average        |
| Excellent  | 20    | ex         | Peak human           |
| Remarkable | 30    | rm         | Low superhuman       |
| Incredible | 40    | in         | Mid superhuman       |
| Amazing    | 50    | am         | High superhuman      |
| Monstrous  | 75    | mn         | Very high superhuman |
| Unearthly  | 100   | un         | Cosmic level         |
| Shift X    | 150   | x          | Cosmic+              |
| Shift Y    | 250   | y          | Cosmic++             |
| Shift Z    | 500   | z          | Cosmic+++            |
| Class 1000 | 1000  | 1000       | God-tier             |
| Class 3000 | 3000  | 3000       | God-tier+            |
| Class 5000 | 5000  | 5000       | God-tier++           |
| Beyond     | 10000 | b          | Omnipotent           |

### Color Results (Tiers)

Every d100 roll produces one of four **color results**, also called **tiers**:

| Color        | Tier | Meaning            | Common Use Cases                              |
| ------------ | ---- | ------------------ | --------------------------------------------- |
| **White**    | 0    | Failure/Miss       | Attack misses, power fails, skill check fails |
| **Green**    | 1    | Partial Success    | Half damage, limited effect                   |
| **Yellow**   | 2    | Success            | Full damage, standard effect                  |
| **Red**      | 3    | Critical Success   | Bonus damage, superior effect                 |
| **Ultimate** | 4    | Perfect 100 Result | Maximum effect, always trumps (special rules) |

**Important**: The tier number is used when comparing attack vs defense results.

## The Universal Table

The Universal Table defines **threshold ranges** for each rank. When you roll d100, the result is compared to these thresholds to determine the color:

```
Format: [Green Start, Yellow Start, Red Start]

White:  1 to (Green Start - 1)
Green:  Green Start to (Yellow Start - 1)
Yellow: Yellow Start to (Red Start - 1)
Red:    Red Start to 100
```

### Complete Universal Table

| Rank       | Green Range | Yellow Range | Red Range | White Range |
| ---------- | ----------- | ------------ | --------- | ----------- |
| Shift 0    | 66-94       | 95-99        | 100       | 1-65        |
| Feeble     | 61-90       | 91-99        | 100       | 1-60        |
| Poor       | 56-85       | 86-99        | 100       | 1-55        |
| Typical    | 51-80       | 81-97        | 98-100    | 1-50        |
| Good       | 46-75       | 76-97        | 98-100    | 1-45        |
| Excellent  | 40-70       | 71-95        | 96-100    | 1-39        |
| Remarkable | 36-65       | 66-94        | 95-100    | 1-35        |
| Incredible | 31-60       | 61-90        | 91-100    | 1-30        |
| Amazing    | 26-55       | 56-90        | 91-100    | 1-25        |
| Monstrous  | 21-50       | 51-85        | 86-100    | 1-20        |
| Unearthly  | 16-45       | 46-85        | 86-100    | 1-15        |
| Shift X    | 11-40       | 41-80        | 81-100    | 1-10        |
| Shift Y    | 7-40        | 41-80        | 81-100    | 1-6         |
| Shift Z    | 4-35        | 36-74        | 75-100    | 1-3         |
| Class 1000 | 2-35        | 36-74        | 75-100    | 1           |
| Class 3000 | 2-30        | 31-70        | 71-100    | 1           |
| Class 5000 | 2-25        | 26-65        | 66-100    | 1           |
| Beyond     | 2-20        | 21-60        | 61-100    | 1           |

### Key Patterns

1. **Higher ranks get better odds**: At Remarkable (rm), you need 36+ for Green success. At Shift Z (z), you only need 4+.
2. **Red becomes more common**: At Typical, Red is 98-100 (3%). At Shift Z, Red is 75-100 (26%).
3. **Failure becomes rare**: At low ranks (Shift 0-Typical), White failure is common. At cosmic ranks, only rolling 1-6 fails.

## Roll Resolution Process

### Step-by-Step Resolution

When a character attempts an action using an attribute/power:

1. **Determine the Rank** being used (e.g., Fighting at Remarkable)
2. **Apply Chart Shifts** (from talents, situational modifiers, karma)
3. **Roll d100**
4. **Look up the (possibly shifted) Rank** in the Universal Table
5. **Compare roll to thresholds** to determine color result
6. **Apply the color result's effect**

### Example 1: Basic Skill Check

**Character**: Fighting rank = Remarkable (rm)  
**Action**: Punch an opponent  
**Roll**: 68

**Resolution**:

- Lookup Remarkable in Universal Table: Green 36-65, Yellow 66-94, Red 95-100
- Roll of 68 falls in Yellow range
- **Result**: Yellow (Tier 2) - Success, full damage

### Example 2: Low Rank Attempt

**Character**: Agility rank = Poor (pr)  
**Action**: Dodge an attack  
**Roll**: 44

**Resolution**:

- Lookup Poor in Universal Table: Green 56-85, Yellow 86-99, Red 100
- Roll of 44 is below Green (56)
- **Result**: White (Tier 0) - Failure, no dodge

### Example 3: High Rank Attempt

**Character**: Strength rank = Unearthly (un)  
**Action**: Lift a heavy object  
**Roll**: 35

**Resolution**:

- Lookup Unearthly in Universal Table: Green 16-45, Yellow 46-85, Red 86-100
- Roll of 35 falls in Green range
- **Result**: Green (Tier 1) - Partial success, lift with difficulty

## Chart Shifts (CS)

**Chart Shifts** modify the effective rank used for the Universal Table lookup **without changing the rank value for calculations**.

### How Chart Shifts Work

- **+1 CS**: Move up one rank on the table (e.g., Excellent → Remarkable)
- **-1 CS**: Move down one rank on the table (e.g., Excellent → Good)
- **Chart shifts stack**: +2 CS = two ranks up, -3 CS = three ranks down

### Sources of Chart Shifts

1. **Talents**: Grant +1 to +3 CS on related checks
2. **Situational Modifiers**: Cover, flanking, called shots
3. **Karma Spending**: Pre-roll karma can buy Column Shifts
4. **Powers/Equipment**: Special abilities may grant CS bonuses

### Chart Shift Example

**Character**: Agility rank = Good (gd)  
**Talent**: Marksman (+2 CS on ranged attacks)  
**Action**: Shoot target  
**Effective Rank**: Remarkable (gd + 2 CS)  
**Roll**: 72

**Resolution**:

- Base rank is Good (10 value)
- Apply +2 CS: Good → Excellent → Remarkable
- Lookup **Remarkable** in Universal Table: Green 36-65, Yellow 66-94, Red 95-100
- Roll of 72 falls in Yellow range
- **Result**: Yellow success (but damage calculated from **Good rank value**, not Remarkable!)

**Critical Point**: Chart shifts affect the **success chance** (Universal Table lookup) but **NOT** the rank value used for damage or other calculations.

## Special Roll Results

### Perfect 100 (Ultimate Critical)

Rolling exactly **100** is special:

- **Always succeeds** regardless of rank
- **Treated as Tier 4** (above Red)
- **Trumps Red defense** in combat
- **Maximum effect**: Often adds bonus dice or effects
- **Cannot be improved** by karma or modifiers

### Botch Rolls (1-5)

Rolling very low has special negative effects:

| Roll | Result          | Effect                                       |
| ---- | --------------- | -------------------------------------------- |
| 1    | Ultimate Botch  | Critical failure, worst possible outcome     |
| 2-5  | Botch           | Serious failure, may cause additional harm   |
| 6+   | Normal (varies) | Resolved normally via Universal Table lookup |

**Note**: Botches occur **before** Universal Table lookup. Even at cosmic ranks, rolling 1 is an Ultimate Botch.

## Comparing Results (Same Tier Resolution)

When two rolls need to be compared (e.g., attack vs defense), the system uses **tiers first, then roll totals**.

### Tier Comparison Rules

1. **Higher tier wins**: Red (3) beats Yellow (2) beats Green (1) beats White (0)
2. **If tiers are equal**: Compare the actual d100 roll results
3. **Ties go to defender**: If same tier AND same roll, defender wins

### Same-Tier Resolution Examples

#### Example 1: Different Tiers

**Attacker**: Fighting Remarkable, rolls 70 → **Yellow (Tier 2)**  
**Defender**: Agility Good, rolls 48 → **Green (Tier 1)**  
**Resolution**: Attacker tier (2) > Defender tier (1) → **Attack hits**

#### Example 2: Same Tier, Different Rolls

**Attacker**: Fighting Excellent, rolls 72 → **Yellow (Tier 2)**  
**Defender**: Agility Excellent, rolls 85 → **Yellow (Tier 2)**  
**Resolution**: Same tier (2), but 85 > 72 → **Defense succeeds**

#### Example 3: Exact Tie

**Attacker**: Fighting Good, rolls 68 → **Yellow (Tier 2)**  
**Defender**: Agility Typical, rolls 68 → **Yellow (Tier 2)** (via different table ranges)  
**Resolution**: Same tier, same roll → **Defense wins (ties go to defender)**

#### Example 4: 100 vs Red Defense

**Attacker**: Psyche Amazing, rolls **100** → **Ultimate (Tier 4)**  
**Defender**: Psyche Unearthly, rolls 92 → **Red (Tier 3)**  
**Resolution**: Ultimate (4) > Red (3) → **Attack hits** (Red defense does NOT stop 100)

#### Example 5: Red Defense vs Non-100 Attack

**Attacker**: Fighting Monstrous, rolls 84 → **Yellow (Tier 2)**  
**Defender**: Agility Incredible, rolls 95 → **Red (Tier 3)**  
**Resolution**: Red defense (3) > Yellow attack (2) → **Attack completely fails** (Red defense stops all non-100 attacks)

### Combat-Specific Rules

In combat, additional special rules apply:

1. **Red Defense Auto-Blocks**: Red defense stops ANY non-100 attack, regardless of attacker's tier
2. **100 vs 100**: If both roll 100, defense wins + counter-attack opportunity
3. **Counter-Attacks**: Red defense may grant a counter-attack at GM's discretion

## Karma Mechanics

**Karma** is a resource that can modify rolls:

### Karma Spending Options

1. **Column Shifts (Pre-Roll)**: Spend karma to increase effective rank for Universal Table lookup
   - Cost: Based on rank difference (minimum 10 karma)
   - Effect: Apply +1 to +3 CS to the roll
2. **Result Shifts (Post-Roll)**: Spend karma to add a flat bonus to d100 result
   - Cost: Varies by house rules (often 10 karma per +10 to roll)
   - Effect: Can change color result (White → Green, Green → Yellow, etc.)

### Karma Example

**Character**: Agility Good (10), has 30 karma  
**Action**: Dodge attack  
**Karma Choice**: Spend 10 karma for +1 Column Shift (Good → Excellent)  
**Roll**: 53  
**Resolution**:

- Without karma: Lookup Good, 53 > 46 (Green start) → Green
- With +1 CS: Lookup Excellent, 53 > 40 (Green start) → Yellow
- **Effect**: Karma improved result from Tier 1 to Tier 2

## Application: Combat Damage

The color result determines damage effects:

| Attack Result | Damage Formula | Description               |
| ------------- | -------------- | ------------------------- |
| White         | 0 (miss)       | Attack completely misses  |
| Green         | Base ÷ 2       | Half damage               |
| Yellow        | Base (full)    | Standard damage           |
| Red           | Base + 3d6     | Critical hit bonus damage |
| Ultimate 100  | Base + 5d10    | Maximum critical damage   |

**Base** = The attacker's power rank value (after any defense reductions)

## Application: Resistance Rolls

When a character has **resistance** to a damage type (fire, cold, energy, etc.), they roll on the Universal Table using their resistance rank:

1. **Flat Reduction**: Subtract resistance rank value from incoming damage
2. **Roll for Overflow**: If damage remains, roll d100 vs resistance rank
3. **Apply Color Result**:
   - **White**: 0% reduction (full overflow damage)
   - **Green**: 25% reduction (take 75% of overflow)
   - **Yellow**: 50% reduction (take 50% of overflow)
   - **Red**: 75% reduction (take 25% of overflow)

### Resistance Example

**Incoming Damage**: 60 fire damage  
**Resistance Rank**: Remarkable (30 value)  
**Flat Reduction**: 60 - 30 = 30 overflow damage  
**Roll**: 72 on d100  
**Resolution**:

- Lookup Remarkable: Green 36-65, Yellow 66-94
- Roll 72 → Yellow result
- Yellow = 50% reduction of overflow
- Final damage: 30 × 50% = 15 fire damage taken

## Quick Reference

### When to Roll

- **Attacks**: Roll Fighting/Agility/Psyche vs target's defense
- **Defense**: Roll Agility/Strength to avoid attacks
- **Skill Checks**: Roll appropriate attribute for task
- **Power Use**: Roll attribute tied to power (if contested)
- **Resistance**: Roll resistance rank against damage overflow

### Roll Evaluation Flowchart

```
1. Determine Base Rank
   ↓
2. Apply Chart Shifts (talents, situational, karma)
   ↓
3. Roll 1d100
   ↓
4. Check for Special Results (1 = Ultimate Botch, 100 = Ultimate Critical)
   ↓
5. Lookup Shifted Rank in Universal Table
   ↓
6. Compare roll to thresholds [Green, Yellow, Red]
   ↓
7. Determine Color Result (White/Green/Yellow/Red)
   ↓
8. Apply Effect (damage, success level, etc.)
```

### Color Result Summary

- **White (T0)**: Failure, miss, no effect
- **Green (T1)**: Partial success, half effect
- **Yellow (T2)**: Success, full effect
- **Red (T3)**: Critical success, bonus effect
- **Ultimate (T4)**: Perfect roll (100 only), maximum effect

### Tier Comparison Priority

1. **Ultimate (100)** beats everything except another 100
2. **Red (T3)** beats Yellow/Green/White (but loses to 100)
3. **Yellow (T2)** beats Green/White
4. **Green (T1)** beats White
5. **White (T0)** loses to everything
6. **Same Tier**: Compare d100 roll totals (higher wins, ties go to defender)

## Advanced Topics

### Rank Value vs Universal Table Rank

**Critical Distinction**:

- **Rank Value**: Used for damage, calculations, comparisons (e.g., Good = 10)
- **Universal Table Rank**: Used for determining success (e.g., Good = 46-75-98)

Chart Shifts affect **ONLY** the Universal Table rank, **NOT** the rank value.

### Multiple Talents Stacking

When multiple talents apply, their Chart Shifts stack:

**Example**:

- Base Agility: Good
- Talent: Marksman (+2 CS on ranged)
- Talent: Combat Sense (+1 CS on all combat)
- Effective Rank: Incredible (Good +3 CS)

### House Rules Variations

Some groups use modified resolution:

- **Auto-Success Threshold**: Ranks 10+ above difficulty auto-succeed
- **Karma Pools**: Shared team karma instead of individual
- **Extended Botch Range**: Botch on 1-10 instead of 1-5
- **No Red Auto-Block**: Red defense works like Yellow (uses tier comparison)

## See Also

- `COMBAT_FLOW.md` - Full combat system with attack/defense mechanics
- `ARMOR_PIERCING_IMPLEMENTATION.md` - Armor penetration and damage reduction
- Source Code: `src/module/rolling/FaseripRoll.ts` - Roll evaluation implementation
- Source Code: `src/module/enums.ts` - Universal Table constants and rank definitions
