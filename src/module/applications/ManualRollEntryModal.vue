<template>
  <div class="manual-roll-entry">
    <div class="roll-info-section">
      <h3>{{ rollTitle }}</h3>
      <div class="formula-display"><strong>Formula:</strong> {{ formula }}</div>
    </div>

    <div class="entry-section">
      <div v-for="(die, index) in diceFields" :key="index" class="dice-row">
        <div class="dice-label mb-2">
          {{ die.label }}
        </div>
        <div class="flex items-end gap-3">
          <div class="flex flex-col gap-1" style="width: 140px">
            <label :for="`natural-${index}`" class="field-label">
              Natural Roll
            </label>
            <input
              type="number"
              :id="`natural-${index}`"
              v-model.number="die.naturalRoll"
              :placeholder="`${die.min}-${die.max}`"
              :min="die.min"
              :max="die.max"
              :step="1"
              class="fsr-input"
              @input="
                () => {
                  if (die.naturalRoll !== null) {
                    if (die.naturalRoll < die.min) die.naturalRoll = die.min;
                    else if (die.naturalRoll > die.max)
                      die.naturalRoll = die.max;
                  }
                  updateExpression();
                }
              "
              @keyup.enter="submit"
              :ref="
                el => {
                  if (el) naturalRollInputs[index] = el;
                }
              "
            />
          </div>
          <div
            v-if="previewTotal !== null && !validationError"
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
                previewTotal
              }}</span>
            </div>
          </div>
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
  label: string;
  naturalRoll: number | null;
  min: number;
  max: number;
  faces: number;
}

const diceFields = ref<DiceField[]>([]);
const validationError = ref<string | null>(null);
const naturalRollInputs = ref<any[]>([]);

// Initialize dice fields from formula
function initializeDiceFields() {
  const fields: DiceField[] = [];
  const formula = props.formula;

  const diceMatches = [...formula.matchAll(/(\d+)?d(\d+)/gi)];

  if (diceMatches.length === 0) {
    // Default to single d100
    fields.push({
      label: "d100",
      naturalRoll: null,
      min: 1,
      max: 100,
      faces: 100
    });
  } else {
    diceMatches.forEach(match => {
      const count = parseInt(match[1] || "1");
      const faces = parseInt(match[2] || "100");

      // Create a field for each individual die
      for (let i = 0; i < count; i++) {
        fields.push({
          label: count > 1 ? `d${faces} #${i + 1}` : `d${faces}`,
          naturalRoll: null,
          min: 1,
          max: faces,
          faces: faces
        });
      }
    });
  }

  diceFields.value = fields;
}

// Generate expression from dice fields
const currentExpression = computed<string>(() => {
  const rolls = diceFields.value
    .map(d => d.naturalRoll)
    .filter(r => r !== null) as number[];

  if (rolls.length === 0) return "";

  // Simple sum of all rolls
  return rolls.join("+");
});

// Preview total
const previewTotal = computed<number | null>(() => {
  if (!currentExpression.value) return null;

  const rolls = diceFields.value
    .map(d => d.naturalRoll)
    .filter(r => r !== null);

  if (rolls.length !== diceFields.value.length) return null;

  return rolls.reduce((sum, roll) => sum + (roll || 0), 0);
});

// Validation
const isValid = computed<boolean>(() => {
  // All fields must have values
  const allFilled = diceFields.value.every(
    d =>
      d.naturalRoll !== null && d.naturalRoll >= d.min && d.naturalRoll <= d.max
  );

  return allFilled && !validationError.value;
});

function updateExpression() {
  validationError.value = null;
}

function submit() {
  if (!isValid.value) {
    validationError.value = "Please fill in all dice rolls with valid values";
    return;
  }

  const result = {
    expression: currentExpression.value,
    naturalRoll: diceFields.value[0]?.naturalRoll || null
  };

  props.dialog.submit(result);
}

function cancel() {
  props.dialog.submit(null);
}

onMounted(async () => {
  initializeDiceFields();

  await nextTick();

  // Focus first input
  if (naturalRollInputs.value[0]) {
    const firstInput = naturalRollInputs.value[0];
    if (firstInput) {
      firstInput.focus();
      firstInput.select();
    }
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
