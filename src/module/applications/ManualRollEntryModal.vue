<template>
  <div class="manual-roll-entry">
    <div class="roll-info-section">
      <h3>{{ rollTitle }}</h3>
      <div class="formula-display"><strong>Formula:</strong> {{ formula }}</div>
      <div class="dice-summary">{{ diceSummary }}</div>
    </div>

    <div class="entry-section">
      <div class="dice-row">
        <div class="dice-label mb-2">Total Rolled</div>
        <div class="flex items-end gap-3">
          <div class="flex flex-col gap-1" style="width: 140px">
            <label for="total-input" class="field-label">
              Total ({{ totalMin }}-{{ totalMax }})
            </label>
            <input
              type="number"
              id="total-input"
              v-model.number="totalInput"
              :placeholder="`${totalMin}-${totalMax}`"
              :min="totalMin"
              :max="totalMax"
              :step="1"
              class="fsr-input"
              @input="updateExpression"
              @keyup.enter="submit"
              ref="totalInputEl"
            />
          </div>
          <div
            v-if="dieResults !== null"
            class="flex flex-col items-center gap-1 px-3 py-2 rounded"
            style="
              min-height: 42px;
              background: rgba(59, 130, 246, 0.1);
              border: 1px solid #1e40af;
            "
          >
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold" style="color: #9ca3af"
                >Total:</span
              >
              <span class="text-xl font-bold" style="color: #60a5fa">{{
                totalInput
              }}</span>
            </div>
          </div>
        </div>

        <div v-if="dieResults !== null" class="die-breakdown">
          <span class="field-label">Implied dice: </span>
          <span
            v-for="(r, i) in dieResults"
            :key="i"
            class="die-chip"
          >
            d{{ diceFields[i].faces }} = {{ r }}
          </span>
        </div>
      </div>

      <div v-if="validationError" class="parse-error">
        <i class="fas fa-exclamation-triangle"></i>
        {{ validationError }}
      </div>
    </div>

    <div class="button-group">
      <button class="fsr-btn fsr-btn-secondary" @click="cancel">Cancel</button>
      <button
        class="fsr-btn fsr-btn-primary"
        @click="submit"
        :disabled="!isValid"
      >
        Submit Roll
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, nextTick } from "vue";
import type { VueDialog } from "@src/module/applications/vue-dialog";

interface Props {
  formula: string;
  rollTitle: string;
  diceType?: "d100" | "d6" | "d10" | string;
  rollData?: Record<string, any>;
  dialog: VueDialog;
}

const props = withDefaults(defineProps<Props>(), {
  diceType: "d100",
  rollData: () => ({})
});

interface DiceField {
  faces: number;
}

const diceFields = ref<DiceField[]>([]);
const totalInput = ref<number | null>(null);
const validationError = ref<string | null>(null);
const totalInputEl = ref<any>(null);

// Parse the formula into individual dice (faces only - count/order matters for range math)
function initializeDiceFields() {
  const fields: DiceField[] = [];
  const formula = props.formula;

  const diceMatches = [...formula.matchAll(/(\d+)?d(\d+)/gi)];

  if (diceMatches.length === 0) {
    fields.push({ faces: 100 });
  } else {
    diceMatches.forEach(match => {
      const count = parseInt(match[1] || "1");
      const faces = parseInt(match[2] || "100");
      for (let i = 0; i < count; i++) {
        fields.push({ faces });
      }
    });
  }

  diceFields.value = fields;
}

const diceSummary = computed<string>(() => {
  if (diceFields.value.length === 0) return "";
  const counts = new Map<number, number>();
  for (const d of diceFields.value) {
    counts.set(d.faces, (counts.get(d.faces) || 0) + 1);
  }
  return (
    "Enter the sum of: " +
    [...counts.entries()].map(([faces, count]) => `${count}d${faces}`).join(" + ")
  );
});

const totalMin = computed<number>(() => diceFields.value.length);
const totalMax = computed<number>(() =>
  diceFields.value.reduce((sum, d) => sum + d.faces, 0)
);

// Split a total into a uniformly random valid combination of per-die values
// within [1, faces] for each die, respecting the fixed dice order.
function splitTotalRandomly(
  total: number,
  fields: DiceField[]
): number[] | null {
  const n = fields.length;
  if (n === 0) return null;

  // Suffix min/max sums, used to bound feasible values for each die as we go.
  const suffixMin: number[] = new Array(n + 1).fill(0);
  const suffixMax: number[] = new Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    suffixMin[i] = suffixMin[i + 1] + 1;
    suffixMax[i] = suffixMax[i + 1] + fields[i].faces;
  }

  if (total < suffixMin[0] || total > suffixMax[0]) return null;

  const results: number[] = [];
  let remaining = total;

  for (let i = 0; i < n; i++) {
    const faces = fields[i].faces;
    // Value for this die must leave a feasible remainder for the rest.
    const lo = Math.max(1, remaining - suffixMax[i + 1]);
    const hi = Math.min(faces, remaining - suffixMin[i + 1]);
    if (lo > hi) return null;
    const value = lo + Math.floor(Math.random() * (hi - lo + 1));
    results.push(value);
    remaining -= value;
  }

  return results;
}

const dieResults = computed<number[] | null>(() => {
  if (totalInput.value === null || diceFields.value.length === 0) return null;
  return splitTotalRandomly(totalInput.value, diceFields.value);
});

const currentExpression = computed<string>(() => {
  if (!dieResults.value) return "";
  return dieResults.value.join("+");
});

const isValid = computed<boolean>(() => {
  return (
    totalInput.value !== null &&
    totalInput.value >= totalMin.value &&
    totalInput.value <= totalMax.value &&
    dieResults.value !== null &&
    !validationError.value
  );
});

function updateExpression() {
  validationError.value = null;
  if (totalInput.value !== null) {
    if (totalInput.value < totalMin.value) totalInput.value = totalMin.value;
    else if (totalInput.value > totalMax.value)
      totalInput.value = totalMax.value;
  }
  if (totalInput.value !== null && dieResults.value === null) {
    validationError.value = `Total must be achievable with ${diceFields.value.length} die(s): ${totalMin.value}-${totalMax.value}`;
  }
}

function submit() {
  if (!isValid.value) {
    validationError.value = "Please enter a valid total";
    return;
  }

  const result = {
    expression: currentExpression.value,
    naturalRoll: dieResults.value?.[0] ?? null
  };

  props.dialog.submit(result);
}

function cancel() {
  props.dialog.submit(null);
}

onMounted(async () => {
  initializeDiceFields();

  await nextTick();

  if (totalInputEl.value) {
    totalInputEl.value.focus();
    totalInputEl.value.select();
  }
});
</script>

<style scoped>
.manual-roll-entry {
  padding: 1rem;
  min-width: 500px;
}

.roll-info-section {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #374151;
}

.roll-info-section h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #fbbf24;
}

.formula-display {
  font-family: "Courier New", monospace;
  background: rgba(30, 58, 138, 0.3);
  padding: 0.5rem;
  border-radius: 4px;
  font-size: 0.95rem;
  color: #93c5fd;
  border: 1px solid #1e3a8a;
}

.dice-summary {
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: #9ca3af;
}

.entry-section {
  margin-bottom: 1.5rem;
}

.dice-row {
  margin-bottom: 1rem;
  padding: 1rem;
  background: #1f2937;
  border-radius: 8px;
  border: 1px solid #4b5563;
}

.dice-label {
  font-weight: 600;
  font-size: 1rem;
  color: #fbbf24;
}

.field-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #9ca3af;
}

.fsr-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: #111827;
  border: 1px solid #4b5563;
  border-radius: 4px;
  color: #e5e7eb;
  font-size: 0.95rem;
}

.fsr-input:focus {
  outline: none;
  border-color: #60a5fa;
  box-shadow: 0 0 0 1px #60a5fa;
}

.fsr-input::placeholder {
  color: #6b7280;
}

.die-breakdown {
  margin-top: 0.75rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.die-chip {
  font-family: "Courier New", monospace;
  font-size: 0.85rem;
  color: #93c5fd;
  background: rgba(30, 58, 138, 0.3);
  border: 1px solid #1e3a8a;
  border-radius: 4px;
  padding: 0.15rem 0.5rem;
}

.parse-error {
  margin-top: 1rem;
  padding: 0.75rem;
  background: rgba(127, 29, 29, 0.3);
  border: 1px solid #991b1b;
  border-radius: 4px;
  color: #fca5a5;
  font-size: 0.9rem;
}

.parse-error i {
  margin-right: 0.5rem;
}

.button-group {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  padding-top: 1rem;
  border-top: 1px solid #374151;
}
</style>
