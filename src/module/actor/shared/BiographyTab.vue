<script setup lang="ts">
import { inject } from "vue";
import { useActorField } from "./use-actor-field";

const reactiveActor = inject("reactiveActor") as any;
const { fields } = useActorField(() => reactiveActor);
</script>

<template>
  <div>
    <div class="fsr-form-group">
      <label class="fsr-form-label">Notes</label>
      <textarea
        v-model="fields['system.notes']"
        class="fsr-input h-32"
        placeholder="Character notes..."
      ></textarea>
    </div>

    <div class="fsr-form-group">
      <label class="fsr-form-label">GM Notes (hidden from players)</label>
      <textarea
        v-model="fields['system.gmNotes']"
        class="fsr-input h-32"
        placeholder="GM-only notes..."
      ></textarea>
    </div>
  </div>
</template>
