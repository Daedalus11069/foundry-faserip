<script setup lang="ts">
import { inject, computed, ref, watch } from "vue";
import { getCharmanService } from "../../charman-service";
import { getRankValue } from "../../utils";
import type { Form } from "../../types";

const reactiveActor = inject("reactiveActor") as any;
const actor = inject("actor") as Actor;

// Check if current user is a GM
// @ts-expect-error - TypeScript doesn't recognize game.user
const isGM = computed(() => game.user?.isGM ?? false);

// Update rank and sync value immediately
function updateRank(attrKey: string, newRank: string) {
  const currentForm = reactiveActor.system.forms?.find(
    (f: Form) => f.id === reactiveActor.system.currentFormId
  );

  if (currentForm?.attributes[attrKey]) {
    currentForm.attributes[attrKey].rank = newRank;
    currentForm.attributes[attrKey].value = getRankValue(newRank);
  }
}

const showImportDialog = ref(false);
const importUsername = ref("");
const importCharacterName = ref("");
const importing = ref(false);
const editingLink = ref(false);

// Local editing refs for manual link (not synced until Save Link is clicked)
const editUsername = ref("");
const editCallname = ref("");

const isLinked = computed(() => {
  return !!(
    reactiveActor.system.charman.username &&
    reactiveActor.system.charman.characterName
  );
});

const lastSyncDate = computed(() => {
  if (!reactiveActor.system.charman.lastSync) return null;
  return new Date(reactiveActor.system.charman.lastSync).toLocaleString();
});

// Initialize edit fields when not linked
watch(
  () => reactiveActor.system.charman.username,
  val => {
    if (!isLinked.value) {
      editUsername.value = val || "";
    }
  },
  { immediate: true }
);

watch(
  () => reactiveActor.system.charman.characterName,
  val => {
    if (!isLinked.value) {
      editCallname.value = val || "";
    }
  },
  { immediate: true }
);

// Pre-populate import dialog with existing values
watch(showImportDialog, show => {
  if (show && isLinked.value) {
    importUsername.value = reactiveActor.system.charman.username || "";
    importCharacterName.value =
      reactiveActor.system.charman.characterName || "";
  }
});

async function importFromCharman() {
  if (!importUsername.value || !importCharacterName.value) {
    ui.notifications?.error("Please enter both username and callname");
    return;
  }

  importing.value = true;

  try {
    const charmanService = getCharmanService();
    await charmanService.importCharacter(
      importUsername.value,
      importCharacterName.value,
      actor
    );

    // Base sheet's updateActor hook will automatically sync reactive actor
    showImportDialog.value = false;
    importUsername.value = "";
    importCharacterName.value = "";
  } catch (error) {
    console.error("Import failed:", error);
    ui.notifications?.error("Failed to import character from Charman");
  } finally {
    importing.value = false;
  }
}

async function resyncFromCharman() {
  if (
    !reactiveActor.system.charman.username ||
    !reactiveActor.system.charman.characterName
  ) {
    ui.notifications?.error("No linked character to re-sync");
    return;
  }

  importing.value = true;

  try {
    const charmanService = getCharmanService();
    await charmanService.importCharacter(
      reactiveActor.system.charman.username,
      reactiveActor.system.charman.characterName,
      actor
    );

    // Base sheet's updateActor hook will automatically sync reactive actor
    // @ts-expect-error - TypeScript doesn't recognize the update method on Actor
    ui.notifications?.success("Character re-synced from Charman");
  } catch (error) {
    console.error("Re-sync failed:", error);
    ui.notifications?.error("Failed to re-sync character from Charman");
  } finally {
    importing.value = false;
  }
}

async function unlinkCharacter() {
  if (
    confirm(
      "Unlink this character from Charman? This will not delete the character data."
    )
  ) {
    await actor.update({
      // @ts-expect-error - TypeScript doesn't recognize the update method on Actor
      "system.charman.username": "",
      "system.charman.characterName": "",
      "system.charman.characterId": null,
      "system.charman.lastSync": null
    });
    ui.notifications?.info("Character unlinked from Charman");
  }
}

async function saveCharmanLink() {
  await actor.update({
    // @ts-expect-error - TypeScript doesn't recognize the update method on Actor
    "system.charman.username": editUsername.value,
    "system.charman.characterName": editCallname.value
  });
  editingLink.value = false;
  // @ts-expect-error - TypeScript doesn't recognize the update method on Actor
  ui.notifications?.success("Charman link saved");
}

function startEditingLink() {
  editUsername.value = reactiveActor.system.charman.username || "";
  editCallname.value = reactiveActor.system.charman.characterName || "";
  editingLink.value = true;
}

function cancelEditingLink() {
  editingLink.value = false;
}

const currentForm = computed(() => {
  const forms = reactiveActor.system.forms || [];
  return (
    forms.find((f: any) => f.id === reactiveActor.system.currentFormId) ||
    forms[0]
  );
});

const faseAttributes = [
  { key: "fighting", label: "Fighting", icon: "⚔️" },
  { key: "agility", label: "Agility", icon: "🏃" },
  { key: "strength", label: "Strength", icon: "💪" },
  { key: "endurance", label: "Endurance", icon: "🛡️" }
];

const ripAttributes = [
  { key: "reasoning", label: "Reasoning", icon: "🧠" },
  { key: "intuition", label: "Intuition", icon: "👁️" },
  { key: "psyche", label: "Psyche", icon: "✨" }
];
</script>

<template>
  <div>
    <!-- Charman Link Section -->
    <div class="mb-4 p-3 bg-gray-800 rounded-lg border border-gray-700">
      <h3 class="text-sm font-bold text-blue-400 mb-2">Charman Integration</h3>

      <div v-if="isLinked && !editingLink" class="space-y-2">
        <!-- Display linked character info -->
        <div class="text-sm">
          <span class="text-gray-400">Linked to:</span>
          <span class="text-white ml-2"
            >{{ reactiveActor.system.charman.username }} /
            {{ reactiveActor.system.charman.characterName }}</span
          >
        </div>
        <div v-if="lastSyncDate" class="text-xs text-gray-500">
          Last synced: {{ lastSyncDate }}
        </div>

        <!-- Action buttons -->
        <div class="flex gap-2 mt-2">
          <button
            @click="resyncFromCharman"
            class="fsr-btn fsr-btn-primary text-sm"
            :disabled="importing"
          >
            🔄 {{ importing ? "Re-syncing..." : "Re-sync from Charman" }}
          </button>
          <button
            @click="startEditingLink"
            class="fsr-btn bg-blue-600 hover:bg-blue-700 text-white text-sm"
          >
            ✏️ Edit Link
          </button>
          <button
            @click="unlinkCharacter"
            class="fsr-btn bg-red-600 hover:bg-red-700 text-white text-sm"
          >
            🔗 Unlink
          </button>
        </div>
      </div>

      <div v-else class="space-y-2">
        <!-- Manual link or import -->
        <div class="fsr-form-group mb-2">
          <label class="fsr-form-label text-xs">Charman Username</label>
          <input
            v-model="editUsername"
            type="text"
            class="fsr-input text-sm"
            placeholder="Enter username"
          />
        </div>
        <div class="fsr-form-group mb-2">
          <label class="fsr-form-label text-xs">Callname</label>
          <input
            v-model="editCallname"
            type="text"
            class="fsr-input text-sm"
            placeholder="Enter character callname"
          />
        </div>
        <div class="flex gap-2">
          <button
            @click="showImportDialog = true"
            class="fsr-btn fsr-btn-secondary text-sm"
          >
            📥 Import from Charman
          </button>
          <button
            @click="saveCharmanLink"
            class="fsr-btn fsr-btn-primary text-sm"
            :disabled="!editUsername || !editCallname"
          >
            💾 Save Link
          </button>
          <button
            v-if="editingLink"
            @click="cancelEditingLink"
            class="fsr-btn bg-gray-600 hover:bg-gray-700 text-white text-sm"
          >
            ✖ Cancel
          </button>
        </div>
      </div>
    </div>

    <!-- Import Dialog -->
    <div v-if="showImportDialog" class="fsr-dialog mb-6">
      <div class="fsr-dialog-header">
        {{ isLinked ? "Re-sync Character" : "Import from Charman" }}
      </div>
      <div class="fsr-dialog-body">
        <div class="fsr-form-group">
          <label class="fsr-form-label">Username</label>
          <input
            v-model="importUsername"
            type="text"
            class="fsr-input"
            placeholder="Charman username"
            :disabled="importing"
          />
        </div>
        <div class="fsr-form-group">
          <label class="fsr-form-label">Callname</label>
          <input
            v-model="importCharacterName"
            type="text"
            class="fsr-input"
            placeholder="Character callname"
            :disabled="importing"
          />
        </div>
      </div>
      <div class="fsr-dialog-footer">
        <button
          @click="showImportDialog = false"
          class="fsr-btn bg-gray-600 hover:bg-gray-700 text-white"
          :disabled="importing"
        >
          Cancel
        </button>
        <button
          @click="importFromCharman"
          class="fsr-btn fsr-btn-primary"
          :disabled="importing"
        >
          {{ importing ? "Importing..." : isLinked ? "Re-sync" : "Import" }}
        </button>
      </div>
    </div>

    <div v-if="currentForm">
      <!-- PHYSICAL Group -->
      <div class="mb-3">
        <h3
          class="text-sm font-bold text-red-400 mb-2 uppercase tracking-wider"
        >
          PHYSICAL
        </h3>
        <div class="fsr-grid fsr-grid-2">
          <div v-for="attr in faseAttributes" :key="attr.key" class="fsr-stat">
            <div class="fsr-stat-name mb-2">
              {{ attr.icon }} {{ attr.label }}
            </div>

            <div class="fsr-form-group">
              <label class="text-xs text-gray-400">Rank</label>
              <select
                :value="currentForm.attributes[attr.key].rank"
                @change="
                  e =>
                    updateRank(attr.key, (e.target as HTMLSelectElement).value)
                "
                class="fsr-select w-full text-sm"
              >
                <option value="shift_0">Shift 0</option>
                <option value="feeble">Feeble</option>
                <option value="poor">Poor</option>
                <option value="typical">Typical</option>
                <option value="good">Good</option>
                <option value="excellent">Excellent</option>
                <option value="remarkable">Remarkable</option>
                <option value="incredible">Incredible</option>
                <option value="amazing">Amazing</option>
                <option value="monstrous">Monstrous</option>
                <option value="unearthly">Unearthly</option>
                <option value="shift_x">Shift X</option>
                <option value="shift_y">Shift Y</option>
                <option value="shift_z">Shift Z</option>
                <option value="class_1000">Class 1000</option>
                <option value="class_3000">Class 3000</option>
                <option value="class_5000">Class 5000</option>
                <option value="beyond">Beyond</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- MENTAL Group -->
      <div class="mb-3">
        <h3
          class="text-sm font-bold text-blue-400 mb-2 uppercase tracking-wider"
        >
          MENTAL
        </h3>
        <div class="fsr-grid fsr-grid-3">
          <div v-for="attr in ripAttributes" :key="attr.key" class="fsr-stat">
            <div class="fsr-stat-name mb-2">
              {{ attr.icon }} {{ attr.label }}
            </div>

            <div class="fsr-form-group">
              <label class="text-xs text-gray-400">Rank</label>
              <select
                :value="currentForm.attributes[attr.key].rank"
                @change="
                  e =>
                    updateRank(attr.key, (e.target as HTMLSelectElement).value)
                "
                class="fsr-select w-full text-sm"
              >
                <option value="shift_0">Shift 0</option>
                <option value="feeble">Feeble</option>
                <option value="poor">Poor</option>
                <option value="typical">Typical</option>
                <option value="good">Good</option>
                <option value="excellent">Excellent</option>
                <option value="remarkable">Remarkable</option>
                <option value="incredible">Incredible</option>
                <option value="amazing">Amazing</option>
                <option value="monstrous">Monstrous</option>
                <option value="unearthly">Unearthly</option>
                <option value="shift_x">Shift X</option>
                <option value="shift_y">Shift Y</option>
                <option value="shift_z">Shift Z</option>
                <option value="class_1000">Class 1000</option>
                <option value="class_3000">Class 3000</option>
                <option value="class_5000">Class 5000</option>
                <option value="beyond">Beyond</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Resources Edit -->
      <div class="mt-3 fsr-grid fsr-grid-2">
        <div class="fsr-form-group">
          <label class="fsr-form-label">Health</label>
          <div class="flex gap-1">
            <input
              v-model.number="reactiveActor.system.resources.health.value"
              type="number"
              class="fsr-input basis-1/2"
              min="0"
              :max="reactiveActor.system.resources.health.max"
            />
            <input
              v-model.number="reactiveActor.system.resources.health.max"
              type="number"
              class="fsr-input basis-1/2"
              min="1"
              placeholder="Max"
            />
          </div>
        </div>

        <div class="fsr-form-group">
          <label class="fsr-form-label">Karma</label>
          <input
            v-model.number="reactiveActor.system.resources.karma.value"
            type="number"
            class="fsr-input"
            min="0"
            :disabled="!isGM"
          />
        </div>
      </div>
    </div>
  </div>
</template>
