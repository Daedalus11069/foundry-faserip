# FASERIP Combat Defense Flow System

## Overview

The FASERIP system now includes a complete combat defense flow where defenders are prompted to respond to attacks, similar to the Rifts system. This provides interactive, tactical combat where defenders can choose to defend or take hits.

## How It Works

### Attack Flow

1. Attacker uses a power with `attackType: melee/ranged/psyche` (contested attack)
2. System rolls attack (hidden from chat initially)
3. System sends defense prompt to target's owner
4. Defender sees modal and chooses response
5. Attack roll shown to chat
6. Defense roll shown (if defended)
7. Results compared and hit/miss determined
8. If `effectType: damage`, damage is calculated and applied
9. If `effectType: none`, success/failure message shown (no damage)

**Note:** FASERIP uses the attack result color (Red/Yellow/Green/White) combined with the power's rank to determine damage. A Red result means maximum effect, Yellow is normal, Green is reduced, and White is failure.

### Defense Mechanics

**FASERIP uses attribute-based defenses:**

- **Melee attacks** (attackType: "melee") → Defender rolls **Fighting**
- **Ranged attacks** (attackType: "ranged") → Defender rolls **Agility**
- **Mental/Psionic powers** (attackType: "psyche") → Defender rolls **Psyche**

**Defense succeeds if:** Defense Roll ≥ Attack Roll

## Setup Requirements

### Power Configuration

For a power to use the combat flow (contested attack), set `attackType` to `"melee"`, `"ranged"`, or `"psyche"`:

**Damaging Attack:**

```yaml
effectType: damage
attackType: melee # or ranged or psyche
damageType: fire # optional - fire, cold, electricity, etc.
```

**Non-Damaging Contested Attack:**

```yaml
effectType: none
attackType: psyche # requires defense roll but doesn't deal damage
```

### Example Powers

**Fire Blast (Damaging Ranged Attack):**

```json
{
  "name": "Fire Blast",
  "rank": "remarkable",
  "value": 30,
  "effectType": "damage",
  "attackType": "ranged",
  "damageType": "fire",
  "mpCost": 5
}
```

**Mind Control (Non-Damaging Psyche Attack):**

```json
{
  "name": "Mind Control",
  "rank": "remarkable",
  "value": 30,
  "effectType": "none",
  "attackType": "psyche",
  "mpCost": 8
}
```

## Using Powers in Combat

1. **Target Selection:** Use Foundry's targeting system (T key) to select target tokens
2. **Activate Power:** Click "🎲 Use Power" button on the power
3. **Defense Prompt:** Target's owner sees modal with options:
   - **Defend (Roll {Attribute})** - Roll defense to try to avoid the attack
   - **Take Hit** - Accept the hit without defending
4. **Resolution:** System shows attack, defense rolls, and determines outcome
5. **Effect:**
   - **Damaging attacks** (`effectType: "damage"`): Damage is calculated and applied to health
   - **Non-damaging attacks** (`effectType: "none"`): Success/failure message shown, no damage

## Multiplayer Support

The socket system handles:

- **Multiple GMs:** First GM to respond wins (race condition handling)
- **Player-owned tokens:** Prompts sent to token owner
- **Unowned tokens:** GMs can respond
- **Disconnected players:** Default to "Take Hit" after timeout

## Components

### Socket System

**File:** `src/module/socket/faserip-socket.ts`

Manages multiplayer communication for defense prompts.

**Key Functions:**

- `initializeSocket()` - Initialize on system ready
- `requestDefenseResponse(data)` - Send defense prompt to target owner
- `handleDefensePrompt(data)` - Show modal and return response

### Defense Modal

**File:** `src/module/applications/DefenseResponseModal.vue`

Vue component showing attack details and defense options.

**Features:**

- Shows attacker name, attack roll, attack type
- Displays defender's attribute rank
- Color-coded result badges (botch, normal, critical, perfect)
- Styled buttons for Defend vs Take Hit

### Combat Flow

**File:** `src/module/combat/combat-flow.ts`

Orchestrates the full attack/defend/damage sequence.

**Key Functions:**

- `executeCombatAttack(attackData)` - Main combat flow orchestrator
- `rollDamage(attacker, target, formula, type)` - Roll and display damage
- `quickAttack(actor, attribute)` - Shortcut for attribute-based attacks

## Integration Points

### PowersTab.vue

**File:** `src/module/actor/shared/PowersTab.vue`

Modified `rollPower()` function to detect attack-type powers and route through combat flow:

```typescript
// Route ALL attack powers (damage or contested) through combat flow
if (power.attackType && power.attackType !== "none") {
  let attackAttribute: "fighting" | "agility" | "psyche";
  let attackType: "melee" | "ranged" | "psyche";

  if (power.attackType === "melee") {
    attackAttribute = "fighting";
    attackType = "melee";
  } else if (power.attackType === "psyche") {
    attackAttribute = "psyche";
    attackType = "psyche";
  } else {
    attackAttribute = "agility";
    attackType = "ranged";
  }

  await executeCombatAttack({
    attacker: actor,
    attackAttribute,
    attackType,
    effectType: power.effectType || "none",
    powerName: power.name,
    powerRank: rank,
    damageType: power.damageType !== "none" ? power.damageType : undefined
  });
  return;
}
```

### System Initialization

**File:** `src/faserip.ts`

Socket system initialized in ready hook:

```typescript
Hooks.once("ready", () => {
  initializeSocket();
});
```

## API Reference

### executeCombatAttack(attackData)

Execute a complete attack flow with defense prompts.

```typescript
interface AttackData {
  attacker: FaseripActor;
  attackerToken?: Token;
  attackAttribute: "fighting" | "agility" | "psyche";
  attackType: "melee" | "ranged" | "psyche";
  effectType?: "none" | "damage" | "heal-health" | "heal-armor";
  powerName?: string;
  powerRank?: Rank;
  damageType?: string;
}

await executeCombatAttack(attackData);
```

### requestDefenseResponse(data)

Request a defense choice from target's owner (low-level socket function).

```typescript
interface DefensePromptData {
  targetActorId: string;
  targetTokenId?: string;
  attackerName: string;
  attackRoll: number;
  attackType: "melee" | "ranged" | "psyche";
  attackAttribute: string;
  powerName?: string;
  promptId?: string;
}

const response = await requestDefenseResponse(data);
// Returns: { defenseType, defenseRoll, defenseAttribute, ... }
```

## Troubleshooting

### Defense prompt doesn't appear

- Check that target token has an owner (actor permissions)
- Verify socket system initialized (check console: "FASERIP Socket | Socket system initialized")
- Confirm target is actually targeted (yellow target ring)

### Attack doesn't route through combat flow

- Verify power has `attackType` set to "melee", "ranged", or "psyche" (not "none")
- Check that targets are selected before activating power
- Confirm power is not set to skip combat flow

### Damage not rolling

- Ensure `damageRoll` is provided in attackData (e.g., "1d100")
- Check that attack hit (defender's roll < attacker's roll)

## Future Enhancements

Potential improvements to consider:

- [ ] Damage application to resources (Health)
- [ ] Armor/resistance calculations
- [ ] Multiple attack support (combo attacks)
- [ ] Talent/karma integration in combat flow
- [ ] Area-effect attacks (multiple targets, no defense)
- [ ] Cover/situational modifiers
- [ ] Combat log/history

## Testing

### Quick Test Scenario

**Damaging Attack Test:**

1. Create two PCs in Foundry
2. Give PC1 a power: Fire Blast (effectType: damage, attackType: ranged)
3. Place both tokens on scene
4. Target PC2 with PC1
5. Open PC1's sheet, click "Use Power" on Fire Blast
6. PC2's owner sees defense modal
7. Choose "Defend" or "Take Hit"
8. Observe chat messages showing attack, defense, damage result

**Non-Damaging Contested Attack Test:**

1. Create two PCs in Foundry
2. Give PC1 a power: Mind Control (effectType: none, attackType: psyche)
3. Place both tokens on scene
4. Target PC2 with PC1
5. Open PC1's sheet, click "Use Power" on Mind Control
6. PC2's owner sees defense modal (prompts Psyche defense)
7. Choose "Defend" or "Take Hit"
8. Observe chat messages showing attack, defense, success/failure (no damage)

### Console Debugging

Enable debug logging by checking console for:

```
FASERIP Socket | Socket system initialized
FASERIP Combat | Starting attack: ...
FASERIP Socket | Requesting defense from: ...
FASERIP Defense | Rolling defense with Fighting/Agility
FASERIP Combat | Combat flow complete
```

## Differences from Rifts System

**Simplified Defense:**

- FASERIP: Single "Defend" option using appropriate attribute
- Rifts: Multiple options (Parry, Dodge, Auto-Parry, Auto-Dodge, Roll with Impact)

**Attribute-Based:**

- FASERIP: Fighting vs Fighting, Agility vs Agility, Psyche vs Psyche
- Rifts: Strike vs Parry/Dodge bonuses (different mechanics)

**Streamlined:**

- FASERIP: No action point system, no separate dodge/parry bonuses
- Rifts: Complex action tracking, multiple attack types, pull punch mechanics

## Related Files

- `src/module/socket/faserip-socket.ts` - Socket system
- `src/module/applications/DefenseResponseModal.vue` - Defense UI
- `src/module/combat/combat-flow.ts` - Combat orchestration
- `src/module/actor/shared/PowersTab.vue` - Power activation integration
- `src/faserip.ts` - System initialization
