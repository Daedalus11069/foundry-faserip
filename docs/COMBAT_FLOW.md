# FASERIP Combat Flow System

## Overview

The FASERIP combat system uses the Universal Table with color-coded results (White, Green, Yellow, Red, Ultimate) to determine attack and defense outcomes. Combat is resolved through a structured flow that emphasizes strategic decision-making and dramatic results.

## Combat Flow Phases

### Phase 1: Attack Declaration

1. **Attacker selects targets** using Foundry's targeting system
2. **Attack options dialog appears:**
   - Karma spending options (Column Shifts and/or Result Shift)
   - Manual chart shifts (situational modifiers, called shots, etc.)
   - Talent bonuses are automatically included
3. **Attack roll is made** using the appropriate attribute:
   - **Fighting**: Melee attacks (punches, kicks, melee weapons)
   - **Agility**: Ranged attacks (projectiles, thrown objects)
   - **Psyche**: Psychic/mental attacks

### Phase 2: Attack Roll Display

- Attack roll is shown to all players in chat
- Includes the result color (White/Green/Yellow/Red/Ultimate)
- Shows any applied modifiers (karma, talents, situational)
- Dice animation plays (if Dice So Nice is enabled)

### Phase 3: Defense Response

For each targeted defender:

1. **Defense prompt appears** on the defender's client
2. **Defender chooses:**
   - **Defend**: Roll appropriate defense (dodge/evade/block based on attribute)
   - **Take Hit**: Accept the attack without defending
3. **Defense roll is made** (if defending)
   - Uses Agility (dodge/evade) or Strength (block/parry)
   - Defender can spend karma on their defense
4. **Defense roll displayed** in chat (if defending)

### Phase 4: Resolution

The system compares attack and defense to determine if the attack hits:

#### Ultimate (100) Always Trumps (SPECIAL)

**100 results are supreme:**

- **Ultimate (100) attack** beats Red defense (but NOT another 100 defense)
- **Ultimate (100) defense** beats Red attack (and all other attacks)
- **100 vs 100**: Defense wins + counter-attack opportunity

#### Red Defense Rule (SPECIAL)

**If defense is Red (tier 3) and attack is NOT 100:**

- Attack AUTOMATICALLY FAILS
- Complete defense achieved
- Defender offered counter-attack opportunity
- If counter accepted: New combat flow begins with defender as attacker
- No damage calculated from original attack

**Important:** Red defense does NOT stop Ultimate (100) attacks

#### Normal Defense Resolution

**For Green/Yellow defenses (tiers 1-2):**

1. **Compare Tiers First:**
   - **Attack tier > Defense tier**: Attack hits
   - **Defense tier > Attack tier**: Defense succeeds
   - **Same tier**: Compare roll totals

2. **If Same Tier (tie-breaker):**
   - Defense succeeds if defense roll ≥ attack roll
   - Attack hits if attack roll > defense roll

3. **If No Defense:**
   - Attack automatically hits
   - No damage reduction applied

## Damage Calculation

### Tier System

Results are assigned numeric tiers for comparison:

- **Ultimate (100)**: Tier 4
- **Red**: Tier 3
- **Yellow**: Tier 2
- **Green**: Tier 1
- **White**: Tier 0 (failure)

### Rank Reduction (Defense Mitigation)

When a defender successfully defends (Green or Yellow):

**Formula:** `Rank Reduction = 1 + max(0, defenseTier - attackTier)`

- **Base Reduction**: 1 CS (Column Shift) for any successful defense
- **Additional Reduction**: Extra CS based on how much better the defense was

**Examples:**

- Attack Yellow (T2) vs Defense Yellow (T2): 1 CS reduction
- Attack Yellow (T2) vs Defense Green (T1): 1 CS reduction (defender didn't exceed attack tier)
- Attack Green (T1) vs Defense Yellow (T2): 2 CS reduction (base 1 + 1 tier better)
- Attack Yellow (T2) vs Defense Red (T3): Complete defense + counter (see Red Defense Rule)
- Attack Ultimate (100) vs Defense Red (T3): Attack HITS (100 trumps Red)
- Attack Red (T3) vs Defense Ultimate (100): Complete defense + counter (100 trumps Red)
- Attack Ultimate (100) vs Defense Ultimate (100): Complete defense + counter (defender wins)

### Ultimate Botch Penalty

**If defender rolls a 1 (Ultimate Botch):**

- Catastrophic defensive failure
- Attack gains **+2 CS bonus** to damage
- Treated as worse than taking the hit

### Damage Formula by Attack Tier

After rank reduction is applied, damage is calculated based on the **attack result tier**:

| Attack Result      | Formula     | Description                           |
| ------------------ | ----------- | ------------------------------------- |
| **White (T0)**     | Base ÷ 4    | Glancing blow (quarter damage)        |
| **Green (T1)**     | Base ÷ 2    | Half success (half damage)            |
| **Yellow (T2)**    | Base        | Success (full damage)                 |
| **Red (T3)**       | Base + 3d6  | Critical hit (base + bonus)           |
| **Ultimate (100)** | Base + 5d10 | Ultimate critical (base + huge bonus) |

**"Base"** = The power rank value after reduction from defense

### Complete Damage Example

**Scenario:** Attacker uses Remarkable (30) Strength punch

1. **Attack Roll**: Yellow (tier 2)
2. **Defense Roll**: Yellow (tier 2)
3. **Rank Reduction**: 1 CS (base, same tier)
4. **Reduced Rank**: Excellent (20) [Remarkable down 1 CS]
5. **Damage Formula**: 20 (Yellow result = full base)
6. **Final Damage**: 20 points

**If attack was Red instead:**

1. Same reduction: Excellent (20)
2. **Damage Formula**: 20 + 3d6
3. **Bonus Roll**: 3d6 = 12
4. **Final Damage**: 32 points

## Special Combat Rules

### Counter-Attacks (Red/Ultimate Defense)

- Available when defender rolls Red or Ultimate on defense
- **Only available against melee attacks** (cannot counter ranged/psychic attacks)
- Prompt appears asking if defender wants to counter
- Counter uses defender's Fighting attribute
- Counter initiates a new full combat flow
- Original attacker becomes the target

### Equipment Restrictions

- **Only equipped weapons** can be used for attacks
- Unequipped weapons appear disabled in the UI
- Attempting to use unequipped weapon shows error notification

### Healing Powers

- Healing powers use the combat roll system
- Amount healed scales by result color:
  - **White**: 0 healing
  - **Green**: Half power rank value
  - **Yellow**: Full power rank value
  - **Red**: Full + 3d6 bonus
  - **Ultimate**: Full + 5d10 bonus

### Multi-Target Attacks

- Each target gets individual defense prompt
- Each resolution calculated separately
- Brief delays between targets for readability

## Damage Application

Damage is applied in priority order:

1. **Equipped Armor** (soaks first)
2. **Body Armor Power** (soaks remainder)
3. **Health** (takes overflow)

### Armor Damage

- Armor reduces by damage amount
- When armor reaches 0, overflow goes to health
- Armor damage shown in yellow/gold chat message

### Health Damage

- Health reduces by overflow damage
- Health damage shown in red chat message
- Health can go negative (unconscious/dying states)

## Chat Message Display

Combat results show:

- **Attack vs Defense comparison** (roll totals and tiers)
- **Tier difference notes** (who had higher tier)
- **Rank reduction summary** (how much defense reduced damage)
- **Damage formula** (showing all calculations)
- **Final damage number** (highlighted in red)
- **Damage application** (armor/health breakdown)
- **Result description** (narrative text)

## Technical Implementation

### Key Functions

- `executeCombatAttack()`: Main combat flow orchestrator
- `calculateDamage()`: Damage calculation with tier-based reduction
- `applyDamageToActor()`: Damage application to armor/health
- `getResultTier()`: Converts roll result to numeric tier
- `requestDefenseResponse()`: Socket-based defense prompts

### Multiplayer Support

- Defense prompts appear on defender's client via `socketlib`
- Roll results synchronized across all clients
- Chat messages visible to all players
- Dice animations synchronized (Dice So Nice integration)

## Design Principles

1. **Defenders Choose First**: Defenders must commit to their defense action BEFORE seeing the final attack roll result
2. **100 Always Trumps**: Ultimate (100) results override tier-based resolution, except against another 100
3. **Tier Matters Most**: Higher tier results generally beat lower tier results (when no 100s involved)
4. **Red Defenses Are Exceptional**: Red defenses succeed and offer counters (except vs 100 attacks)
5. **Graduated Damage**: Better attack results deal more damage, better defenses reduce more
6. **Catastrophic Failures**: Ultimate botches (rolling 1) have severe consequences
7. **Strategic Karma Use**: Players decide when to spend karma for advantage
8. **Clear Visual Feedback**: Color-coded results and detailed breakdowns in chat
