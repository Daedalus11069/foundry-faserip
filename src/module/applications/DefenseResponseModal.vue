<template>
  <div class="defense-modal">
    <div class="attack-info">
      <h3>{{ attackerName }} Attacks!</h3>
      <div class="attack-details">
        <div class="detail-row">
          <span class="label">Attack Type:</span>
          <span class="value">{{ attackTypeLabel }}</span>
        </div>
        <div class="detail-row">
          <span class="label">Attack Rank:</span>
          <span class="value rank-display">{{
            attackRank ? formatRankDisplay(attackRank) : "—"
          }}</span>
        </div>
        <div class="detail-row">
          <span class="label">Attack Roll: </span>
          <span class="value result-badge" :class="attackResultClass">{{
            attackRoll
          }}</span>
        </div>
        <div v-if="attackResult" class="detail-row">
          <span class="label">Result: </span>
          <span class="value result-badge" :class="attackResultClass">{{
            attackResult
          }}</span>
        </div>
        <div v-if="powerName" class="detail-row">
          <span class="label">Power Used:</span>
          <span class="value">{{ powerName }}</span>
        </div>
      </div>
    </div>

    <div class="defense-info">
      <h4>Your Defense Options</h4>
      <div class="defense-details">
        <div class="detail-row">
          <span class="label">Defend with:</span>
          <span class="value">{{ defenseAttribute }}</span>
        </div>
        <div class="detail-row">
          <span class="label">Your Rank:</span>
          <span class="value rank-display">{{ defenseRankDisplay }}</span>
        </div>
        <div v-if="talentNames && talentNames.length > 0" class="detail-row">
          <span class="label">Talents:</span>
          <span class="value text-orange-400">{{
            talentNames.join(", ")
          }}</span>
        </div>
      </div>
    </div>

    <div class="action-buttons">
      <button class="fsr-btn fsr-btn-danger grow" @click="handleTakeHit">
        <i class="fas fa-person-falling"></i>
        Take Hit
      </button>
      <button class="fsr-btn fsr-btn-primary" @click="handleDefend">
        <i class="fas fa-shield"></i>
        Defend (Roll {{ defenseAttribute }})
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRaw } from "vue";
import type { FaseripActor } from "../documents";
import { FaseripRoll } from "../rolling/FaseripRoll";
import { formatRankDisplay, type Rank, applyChartShift } from "../enums";
import { stringToRank } from "../utils";
import { showDefenseOptionsDialog } from "./dialog-utils";
import type { VueDialog } from "./vue-dialog";

interface Props {
  dialog: VueDialog;
  targetActor: FaseripActor;
  attackerName: string;
  attackRoll: number;
  attackType: "melee" | "ranged" | "psyche";
  attackAttribute: string;
  attackResult?: string;
  attackRank?: string;
  powerName?: string;
  defenseAttribute: string;
  defenseRank: string;
  defenseValue: number;
  talentNames?: string[];
  talentCS?: number;
}

const props = defineProps<Props>();

// Computed properties
const attackTypeLabel = computed(() => {
  switch (props.attackType) {
    case "melee":
      return "Melee";
    case "ranged":
      return "Ranged";
    case "psyche":
      return "Mental/Psionic";
    default:
      return props.attackType;
  }
});

const attackResultClass = computed(() => {
  // Get color based on roll result
  if (props.attackRoll === 1) return "ultimate-botch";
  if (props.attackRoll >= 2 && props.attackRoll <= 5) return "botch";
  if (props.attackRoll === 100) return "perfect";

  // Use attackResult text if provided
  if (props.attackResult) {
    const result = props.attackResult.toLowerCase();
    if (result.includes("ultimate botch")) return "ultimate-botch";
    if (result.includes("botch")) return "botch";
    if (result.includes("ultimate critical")) return "perfect";
    if (result.includes("critical")) return "red";
    if (result.includes("success") && !result.includes("half")) return "yellow";
    if (result.includes("half")) return "green";
    if (result.includes("failure")) return "white";
  }

  // Default to white/neutral
  return "white";
});

const defenseRankDisplay = computed(() => {
  const baseRank = formatRankDisplay(props.defenseRank);
  if (props.talentCS && props.talentCS > 0) {
    const rank = stringToRank(props.defenseRank) as Rank;
    const effectiveRank = applyChartShift(rank, props.talentCS);
    return `${baseRank} (+${props.talentCS} CS) → ${formatRankDisplay(effectiveRank)}`;
  }
  return baseRank;
});

// Action handlers
async function handleDefend() {
  // CRITICAL: Use toRaw() to unwrap Vue proxy before passing to Foundry API
  // Vue reactive proxies cause issues with Foundry's internal property access
  const rawActor = toRaw(props.targetActor);

  // Roll defense using FASERIP roll system
  const defenseRank = stringToRank(props.defenseRank) as Rank;
  const system = (rawActor as any).system;
  const currentKarma = system?.resources?.karma?.value ?? 0;

  // Show defense options dialog for karma spending
  const defenseOptions = await showDefenseOptionsDialog(
    rawActor.name!,
    props.defenseAttribute,
    defenseRank,
    currentKarma,
    props.attackerName,
    props.attackRank ? formatRankDisplay(props.attackRank as Rank) : undefined,
    props.attackRoll,
    props.attackResult,
    props.powerName,
    props.talentCS
  );

  if (!defenseOptions) {
    // User cancelled - treat as taking the hit
    props.dialog.submit({
      defenseType: "takeHit"
    });
    return;
  }

  // Calculate total chart shift (manual only - karma shifts handled by rollAttribute)
  const totalChartShift = defenseOptions.manualChartShift;

  // Roll defense with applied chart shifts
  // Pass karma shifts to rollAttribute - it will handle deduction and application
  const defenseRoll = await FaseripRoll.rollAttribute(
    props.defenseAttribute,
    defenseRank,
    props.defenseValue,
    totalChartShift, // Manual chart shift only
    rawActor, // Use unwrapped actor to avoid Vue proxy issues with Foundry API
    undefined, // No talents
    {
      defenseRoll: true,
      attackerName: props.attackerName
    },
    defenseOptions.karmaColumnShifts, // Let rollAttribute handle column shifts
    defenseOptions.karmaResultShift // Let rollAttribute handle result shift
    // NOT skipping message - we want it to show immediately
  );

  const defenseTotal = defenseRoll.roll.total || 0;
  const defenseSuccess = defenseTotal >= props.attackRoll;

  // Check for botch results
  const isUltimateBotch = defenseTotal === 1;
  const isBotch = defenseTotal >= 2 && defenseTotal <= 5;

  // Submit the response
  props.dialog.submit({
    defenseType: "defend",
    defenseRoll: defenseTotal,
    defenseAttribute: props.defenseAttribute,
    defended: true,
    _rollJSON: defenseRoll.roll.toJSON(),
    _defenseSuccess: defenseSuccess,
    _resultText: defenseRoll.getResultText(),
    _resultClass: defenseRoll.getResultClass(),
    _isUltimateBotch: isUltimateBotch,
    _isBotch: isBotch
  });
}

function handleTakeHit() {
  props.dialog.submit({
    defenseType: "takeHit"
  });
}
</script>

<style scoped>
.defense-modal {
  padding: 1rem;
  min-width: 400px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  color: #fff;
}

.attack-info {
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: rgba(220, 38, 38, 0.1);
  border: 2px solid rgba(220, 38, 38, 0.3);
  border-radius: 8px;
}

.attack-info h3 {
  margin: 0 0 1rem 0;
  color: #ef4444;
  font-size: 1.25rem;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.defense-info {
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: rgba(59, 130, 246, 0.1);
  border: 2px solid rgba(59, 130, 246, 0.3);
  border-radius: 8px;
}

.defense-info h4 {
  margin: 0 0 1rem 0;
  color: #60a5fa;
  font-size: 1.1rem;
  text-align: center;
}

.attack-details,
.defense-details {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* Fallback for browsers without flexbox gap support (Waterfox) */
@supports not (gap: 0.5rem) {
  .attack-details > *:not(:last-child),
  .defense-details > *:not(:last-child) {
    margin-bottom: 0.5rem;
  }
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.detail-row .label {
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
}

.detail-row .value {
  font-weight: 700;
  color: #fff;
}

.result-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 4px;
  font-size: 1.1rem;
}

.result-badge.ultimate-botch {
  background: #450a0a;
  color: #fca5a5;
}

.result-badge.botch {
  background: #7c2d12;
  color: #fed7aa;
}

.result-badge.perfect {
  background: #064e3b;
  color: #6ee7b7;
}

.result-badge.white {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.result-badge.red {
  background: #7f1d1d;
  color: #fca5a5;
}

.result-badge.yellow {
  background: #78350f;
  color: #fcd34d;
}

.result-badge.green {
  background: #14532d;
  color: #86efac;
}

.rank-display {
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.05em;
}

.action-buttons {
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

/* Fallback for browsers without flexbox gap support (Waterfox) */
@supports not (gap: 0.75rem) {
  .action-buttons > *:not(:last-child) {
    margin-right: 0.75rem;
  }
}

.fsr-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  font-size: 0.95rem;
  font-weight: 600;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: fit-content;
}

/* Fallback for browsers without flexbox gap support (Waterfox) */
@supports not (gap: 0.5rem) {
  .fsr-btn > *:not(:last-child) {
    margin-right: 0.5rem;
  }
}

.fsr-btn i {
  font-size: 1.25rem;
}

.fsr-btn-primary {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
  box-shadow: 0 4px 6px rgba(59, 130, 246, 0.3);
}

.fsr-btn-primary:hover {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  box-shadow: 0 6px 8px rgba(59, 130, 246, 0.4);
  transform: translateY(-2px);
}

.fsr-btn-danger {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: white;
  box-shadow: 0 4px 6px rgba(239, 68, 68, 0.3);
}

.fsr-btn-danger:hover {
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
  box-shadow: 0 6px 8px rgba(239, 68, 68, 0.4);
  transform: translateY(-2px);
}
</style>
