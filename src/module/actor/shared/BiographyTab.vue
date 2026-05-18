<script setup lang="ts">
import { inject } from "vue";

const reactiveActor = inject("reactiveActor") as any;
</script>

<template>
  <div>
    <div class="fsr-form-group">
      <label class="fsr-form-label">Biography</label>
      <textarea
        v-model="reactiveActor.system.biography"
        class="fsr-input h-48"
        placeholder="Character biography..."
      ></textarea>
    </div>

    <div class="fsr-form-group">
      <label class="fsr-form-label">Notes</label>
      <textarea
        v-model="reactiveActor.system.notes"
        class="fsr-input h-32"
        placeholder="Character notes..."
      ></textarea>
    </div>

    <div class="fsr-form-group">
      <label class="fsr-form-label">GM Notes (hidden from players)</label>
      <textarea
        v-model="reactiveActor.system.gmNotes"
        class="fsr-input h-32"
        placeholder="GM-only notes..."
      ></textarea>
    </div>
  </div>
</template>
