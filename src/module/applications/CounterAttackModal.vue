<template>
  <div class="counter-attack-modal">
    <div class="defense-success">
      <h3>{{ getTitle() }}</h3>
      <div class="success-details">
        <div class="detail-row">
          <span class="label">Defender:</span>
          <span class="value">{{ props.defenderName }}</span>
        </div>
        <div class="detail-row">
          <span class="label">Defense Roll:</span>
          <span class="value">
            <span :class="['result-badge', getDefenseResultClass()]">
              {{ props.defenseRoll }}
            </span>
          </span>
        </div>
        <div class="detail-row">
          <span class="label">Attacker:</span>
          <span class="value">{{ props.attackerName }}</span>
        </div>
        <div class="detail-row">
          <span class="label">Attack Roll:</span>
          <span class="value">
            <span :class="['result-badge', getAttackResultClass()]">
              {{ props.attackRoll }}
            </span>
          </span>
        </div>
      </div>
      <p class="counter-message">{{ getMessage() }}</p>
    </div>

    <div class="action-buttons">
      <button class="fsr-btn fsr-btn-danger" @click="handleDecline">
        <i class="fa-solid fa-xmark"></i>
        Don't Counter
      </button>
      <button class="fsr-btn fsr-btn-primary" @click="handleCounter">
        <i class="fa-solid fa-hand-fist"></i>
        Counter-Attack!
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { VueDialog } from "./vue-dialog";

interface Props {
  defenderName: string;
  attackerName: string;
  defenseRoll: number;
  attackRoll: number;
  counterType: "ultimate-vs-ultimate" | "ultimate-vs-normal" | "red-vs-normal";
  dialog: VueDialog;
}

const props = defineProps<Props>();

function getTitle(): string {
  switch (props.counterType) {
    case "ultimate-vs-ultimate":
      return "⚡ Ultimate Defense!";
    case "ultimate-vs-normal":
      return "⚡ Ultimate Defense!";
    case "red-vs-normal":
      return "💥 Critical Defense!";
    default:
      return "Defense Success!";
  }
}

function getMessage(): string {
  switch (props.counterType) {
    case "ultimate-vs-ultimate":
      return "Both rolled Ultimate! Complete defense achieved. Counter-attack the attacker?";
    case "ultimate-vs-normal":
      return "Ultimate defense achieved! Counter-attack the attacker?";
    case "red-vs-normal":
      return "Critical defense achieved! Counter-attack the attacker?";
    default:
      return "Complete defense! Counter-attack the attacker?";
  }
}

function getDefenseResultClass(): string {
  if (props.defenseRoll === 100) return "perfect";
  if (props.defenseRoll >= 96) return "red";
  if (props.defenseRoll >= 76) return "yellow";
  if (props.defenseRoll >= 51) return "green";
  return "white";
}

function getAttackResultClass(): string {
  if (props.attackRoll === 100) return "perfect";
  if (props.attackRoll >= 96) return "red";
  if (props.attackRoll >= 76) return "yellow";
  if (props.attackRoll >= 51) return "green";
  return "white";
}

function handleCounter() {
  props.dialog.submit({ counterAttack: true });
}

function handleDecline() {
  props.dialog.submit({ counterAttack: false });
}
</script>

<style scoped>
.counter-attack-modal {
  padding: 1rem;
  min-width: 400px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  color: #fff;
}

.defense-success {
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: rgba(34, 197, 94, 0.1);
  border: 2px solid rgba(34, 197, 94, 0.3);
  border-radius: 8px;
}

.defense-success h3 {
  margin: 0 0 1rem 0;
  color: #4ade80;
  font-size: 1.25rem;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.success-details {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

/* Fallback for browsers without flexbox gap support (Waterfox) */
@supports not (gap: 0.5rem) {
  .success-details > *:not(:last-child) {
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

.counter-message {
  margin: 0;
  text-align: center;
  font-size: 1rem;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.5;
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
