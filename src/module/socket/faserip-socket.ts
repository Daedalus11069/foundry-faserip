/**
 * FASERIP Socket System
 * Handles multiplayer combat interactions - defense prompts, damage application, etc.
 */

import type { FaseripActor } from "../documents";
import DefenseResponseModal from "../applications/DefenseResponseModal.vue";
import { VueDialog } from "../applications/vue-dialog";

/**
 * Socket module instance
 */
let socket: any = null;

/**
 * Data structure for defense prompt sent to defender
 */
interface DefensePromptData {
  targetActorId: string;
  targetTokenId?: string; // For unlinked tokens
  attackerName: string;
  attackRoll: number; // The attacker's roll result
  attackType: "melee" | "ranged" | "psyche"; // Determines which attribute defender uses
  attackAttribute: string; // Name of attacking attribute (Fighting, Agility, Psyche)
  attackResult?: string; // FASERIP result (Red, Yellow, Green, White, etc.)
  attackRank?: string; // Attacker's rank
  powerName?: string; // If attacking with a power
  promptId?: string; // Unique ID for tracking race conditions in multi-GM scenarios
}

/**
 * Response from defender after choosing defense
 */
interface DefenseResponse {
  defenseType: "defend" | "takeHit";
  defenseRoll?: number;
  defenseAttribute?: string; // Which attribute they defended with
  defended?: boolean;
  _rollJSON?: any; // Serialized roll data
  _defenseSuccess?: boolean;
  _resultText?: string; // Result text (e.g., "Success", "Critical")
  _resultClass?: string; // CSS class for result (e.g., "green", "red")
  _targetActorId?: string;
  _respondingUserId?: string;
  _isUltimateBotch?: boolean; // True if defense roll was 1 (catastrophic failure)
  _isBotch?: boolean; // True if defense roll was 2-5 (regular botch)
}

/**
 * Map to track active defense prompts (for cancellation in multi-GM scenarios)
 */
const activeDefensePrompts = new Map<
  string,
  { dialog: any; resolve: (value: DefenseResponse | null) => void }
>();

/**
 * Initialize the socket system
 */
export function initializeSocket(): void {
  if (!game.ready) {
    console.warn("FASERIP Socket | Game not ready, deferring initialization");
    Hooks.once("ready", initializeSocket);
    return;
  }

  if (!game.modules.get("socketlib")?.active) {
    console.warn(
      "FASERIP Socket | socketlib module is not active. Defense prompts may not work correctly in multiplayer."
    );
    return;
  }

  // @ts-expect-error - socketlib is a Foundry module
  socket = window.socketlib.registerSystem("faserip");

  // Register handler functions that can be called remotely
  socket.register("promptDefense", handleDefensePrompt);
  socket.register("cancelDefensePrompt", handleCancelDefensePrompt);
  socket.register("applyDamage", handleApplyDamage);

  console.log("FASERIP Socket | Socket system initialized with socketlib");
}

/**
 * Request a defense response from the target's owner
 * Called by the attacker's client
 */
export async function requestDefenseResponse(
  data: DefensePromptData
): Promise<DefenseResponse | null> {
  console.log("FASERIP Socket | Requesting defense response:", data);

  // Get the target actor
  let targetActor: FaseripActor | undefined;
  if (data.targetTokenId) {
    const token = canvas?.tokens?.get(data.targetTokenId);
    targetActor = token?.actor as FaseripActor | undefined;
  } else {
    targetActor = game.actors?.get(data.targetActorId) as
      | FaseripActor
      | undefined;
  }

  if (!targetActor) {
    console.error("FASERIP Socket | Target actor not found");
    return null;
  }

  if (!socket) {
    console.warn(
      "FASERIP Socket | Socket not initialized - falling back to local"
    );
    // Fallback: handle locally if user is GM or owns the target
    if (game.user?.isGM || targetActor.isOwner) {
      return await handleDefensePrompt(data);
    }
    console.error("FASERIP Socket | Cannot handle defense locally");
    return null;
  }

  // Generate unique prompt ID for tracking
  const promptId = foundry.utils.randomID();
  data.promptId = promptId;

  // Find users who could handle this defense
  const potentialControllers = findTokenControllers(targetActor);

  console.log(
    "FASERIP Socket | Potential controllers:",
    potentialControllers.map((u: any) => ({ id: u.id, name: u.name }))
  );

  if (potentialControllers.length === 0) {
    console.warn("FASERIP Socket | No controllers found - taking hit");
    return { defenseType: "takeHit" };
  }

  // If only one user, just send to them
  if (potentialControllers.length === 1) {
    const user = potentialControllers[0];
    console.log(
      "FASERIP Socket | Sending defense prompt to single user:",
      user.name
    );

    return await socket.executeAsUser("promptDefense", user.id, data);
  }

  // Multiple GMs - race condition handling (first to respond wins)
  console.log("FASERIP Socket | Multiple controllers - first to respond wins");

  let firstResponseReceived = false;
  let winningResponse: DefenseResponse | null = null;
  let resolveWinner: ((value: DefenseResponse | null) => void) | null = null;

  const winnerPromise = new Promise<DefenseResponse | null>(resolve => {
    resolveWinner = resolve;
  });

  const gmPromises = potentialControllers.map((user: any) =>
    socket.executeAsUser("promptDefense", user.id, data).then((result: any) => {
      // First valid response wins (including "takeHit")
      if (!firstResponseReceived && result !== null) {
        firstResponseReceived = true;
        winningResponse = result;

        // Cancel all other prompts (even if this user took the hit)
        potentialControllers.forEach((otherUser: any) => {
          if (otherUser.id !== user.id) {
            console.log(
              `FASERIP Socket | Canceling prompt for ${otherUser.name} (${user.name} responded first)`
            );
            socket.executeAsUser("cancelDefensePrompt", otherUser.id, {
              promptId,
              winnerUserId: user.id
            });
          }
        });

        resolveWinner?.(result);
      }
      return result;
    })
  );

  // Wait for first response or all timeouts
  const response = await Promise.race([
    winnerPromise,
    Promise.all(gmPromises).then(() => winningResponse)
  ]);

  if (!response) {
    console.warn("FASERIP Socket | No response - defaulting to takeHit");
    return { defenseType: "takeHit" };
  }

  // Reconstruct target actor on this client
  if (response._targetActorId) {
    (response as any)._targetActor = game.actors?.get(response._targetActorId);
  }

  // Reconstruct roll object from JSON
  if (response._rollJSON) {
    (response as any)._rollObject = Roll.fromData(response._rollJSON);
  }

  return response;
}

/**
 * Find users who can control this token (owner or GM)
 */
function findTokenControllers(actor: FaseripActor): any[] {
  const controllers: any[] = [];

  // Add all users who own the actor
  for (const user of (game.users as any).contents) {
    if (user.active && actor.testUserPermission(user, "OWNER")) {
      controllers.push(user);
    }
  }

  return controllers;
}

/**
 * Handle a defense prompt on the defender's client
 * Shows the defense modal and waits for user response
 * This function is called remotely via socketlib
 */
async function handleDefensePrompt(
  data: DefensePromptData
): Promise<DefenseResponse | null> {
  console.log("FASERIP Socket | Handle defense prompt:", {
    userId: game.user?.id,
    userName: game.user?.name,
    targetActorId: data.targetActorId
  });

  // Get the target actor
  let targetActor: FaseripActor | undefined;
  if (data.targetTokenId) {
    const token = canvas?.tokens?.get(data.targetTokenId);
    targetActor = token?.actor as FaseripActor | undefined;
  } else {
    targetActor = game.actors?.get(data.targetActorId) as
      | FaseripActor
      | undefined;
  }

  if (!targetActor) {
    console.error("FASERIP Socket | Target actor not found");
    return { defenseType: "takeHit" };
  }

  // Security check - verify this user owns the target
  if (!game.user?.isGM && !targetActor.isOwner) {
    console.warn(
      "FASERIP Socket | User doesn't own target - returning takeHit"
    );
    return { defenseType: "takeHit" };
  }

  // Determine which attribute the defender should use
  let defenseAttribute: string;
  switch (data.attackType) {
    case "melee":
      defenseAttribute = "Fighting";
      break;
    case "ranged":
      defenseAttribute = "Agility";
      break;
    case "psyche":
      defenseAttribute = "Psyche";
      break;
    default:
      defenseAttribute = "Fighting";
  }

  // Get defender's attribute value
  const system = targetActor.system as any;
  const currentForm =
    system.forms?.find((f: any) => f.id === system.currentFormId) ||
    system.forms?.[0];

  if (!currentForm) {
    console.error("FASERIP Socket | No form found for actor");
    return { defenseType: "takeHit" };
  }

  const defenseAttr = currentForm.attributes?.[defenseAttribute.toLowerCase()];
  if (!defenseAttr) {
    console.error("FASERIP Socket | Defense attribute not found");
    return { defenseType: "takeHit" };
  }

  const promptId = data.promptId || foundry.utils.randomID();

  // Find applicable defense talents
  const talents = system.talents || [];
  const defenseAttributeLower = defenseAttribute.toLowerCase();
  const applicableTalents = talents.filter((t: any) => {
    const talentName = t.name.toLowerCase();
    // Check if talent applies to this defense attribute
    // Common defense talents: Martial Arts, Dodging, Blocking, Combat Sense, etc.
    if (defenseAttributeLower === "fighting") {
      return (
        talentName.includes("martial") ||
        talentName.includes("block") ||
        talentName.includes("combat") ||
        talentName.includes("melee") ||
        talentName.includes("parry")
      );
    } else if (defenseAttributeLower === "agility") {
      return (
        talentName.includes("dodge") ||
        talentName.includes("evasion") ||
        talentName.includes("acrobat") ||
        talentName.includes("reflex")
      );
    } else if (defenseAttributeLower === "psyche") {
      return (
        talentName.includes("mental") ||
        talentName.includes("resist") ||
        talentName.includes("willpower")
      );
    }
    return false;
  });

  const talentNames = applicableTalents.map((t: any) => t.name);
  const talentCS = applicableTalents.reduce(
    (sum: number, t: any) => sum + (t.bonus || 0),
    0
  );

  // Create dialog instance BEFORE showing it so we can track and cancel it
  const dialog = new VueDialog(
    DefenseResponseModal,
    {
      targetActor,
      attackerName: data.attackerName,
      attackRoll: data.attackRoll,
      attackType: data.attackType,
      attackAttribute: data.attackAttribute,
      attackResult: data.attackResult,
      attackRank: data.attackRank,
      powerName: data.powerName,
      defenseAttribute,
      defenseRank: defenseAttr.rank,
      defenseValue: defenseAttr.value,
      talentNames: talentNames.length > 0 ? talentNames : undefined,
      talentCS: talentCS > 0 ? talentCS : undefined
    },
    {
      window: {
        title: "Incoming Attack!",
        icon: "fas fa-shield",
        modal: false
      },
      position: {
        width: 450
      }
    }
  );

  // Store prompt for cancellation BEFORE showing the dialog
  const dialogPromise = new Promise<DefenseResponse | null>(resolve => {
    activeDefensePrompts.set(promptId, { dialog, resolve });
  });

  // Render the dialog
  await dialog.render(true);

  // Wait for either the dialog result or external cancellation
  const result = await Promise.race([
    dialog.wait() as Promise<DefenseResponse | null>,
    dialogPromise
  ]);

  // Clean up the prompt from tracking
  activeDefensePrompts.delete(promptId);

  // Handle cancellation by another GM
  if (!result) {
    console.log("FASERIP Socket | Defense prompt canceled");
    return { defenseType: "takeHit" };
  }

  if (result.defenseType === "takeHit") {
    return { defenseType: "takeHit" };
  }

  // Build response with roll data
  return {
    defenseType: result.defenseType,
    defenseRoll: result.defenseRoll,
    defenseAttribute: result.defenseAttribute,
    defended: result.defended,
    _rollJSON: result._rollJSON,
    _defenseSuccess: result._defenseSuccess,
    _resultText: result._resultText,
    _resultClass: result._resultClass,
    _targetActorId: targetActor.id!,
    _respondingUserId: game.user?.id,
    _isUltimateBotch: result._isUltimateBotch,
    _isBotch: result._isBotch
  };
}

/**
 * Handle canceling a defense prompt (when another GM responds first)
 */
function handleCancelDefensePrompt(data: {
  promptId: string;
  winnerUserId?: string;
}): void {
  const prompt = activeDefensePrompts.get(data.promptId);
  if (prompt) {
    console.log("FASERIP Socket | Canceling defense prompt:", data.promptId);
    prompt.dialog?.close();
    prompt.resolve(null);
    activeDefensePrompts.delete(data.promptId);
  }
}

/**
 * Data structure for damage application
 */
interface ApplyDamageData {
  targetActorId: string;
  targetTokenId?: string;
  damage: number;
  armorUpdates?: any[];
  powerUpdates?: any[];
}

/**
 * Request damage application on the target owner's client
 * Called by the attacker's client after calculating damage
 */
export async function requestDamageApplication(
  targetActor: FaseripActor,
  damage: number
): Promise<{
  armorDamage: number;
  healthDamage: number;
  newArmorValue: number;
  newHealthValue: number;
} | null> {
  console.log("FASERIP Socket | Requesting damage application:", {
    targetActorId: targetActor.id,
    damage
  });

  if (!socket) {
    console.warn(
      "FASERIP Socket | Socket not initialized - applying damage locally"
    );
    // Fallback: apply locally if user is GM or owns the target
    if (game.user?.isGM || targetActor.isOwner) {
      return await handleApplyDamage({
        targetActorId: targetActor.id!,
        damage
      });
    }
    console.error("FASERIP Socket | Cannot apply damage locally");
    return null;
  }

  // Find the owner of the target
  const owner = findTokenControllers(targetActor)[0];
  if (!owner) {
    console.warn("FASERIP Socket | No owner found - applying damage as GM");
    return await handleApplyDamage({
      targetActorId: targetActor.id!,
      damage
    });
  }

  // Execute damage application on the owner's client
  return await socket.executeAsUser("applyDamage", owner.id, {
    targetActorId: targetActor.id!,
    damage
  });
}

/**
 * Handle applying damage to an actor on the owner's client
 * This function is called remotely via socketlib
 */
async function handleApplyDamage(data: ApplyDamageData): Promise<{
  armorDamage: number;
  healthDamage: number;
  newArmorValue: number;
  newHealthValue: number;
} | null> {
  console.log("FASERIP Socket | Handling damage application:", {
    userId: game.user?.id,
    userName: game.user?.name,
    targetActorId: data.targetActorId,
    damage: data.damage
  });

  // Get the target actor
  const targetActor = game.actors?.get(data.targetActorId) as
    | FaseripActor
    | undefined;

  if (!targetActor) {
    console.error("FASERIP Socket | Target actor not found");
    return null;
  }

  // Security check - verify this user owns the target
  if (!game.user?.isGM && !targetActor.isOwner) {
    console.warn(
      "FASERIP Socket | User doesn't own target - cannot apply damage"
    );
    return null;
  }

  const system = targetActor.system as any;
  const currentFormId = system.currentFormId;

  // Armor is derived from body armor power + equipped armor
  const activeFormId = system.currentFormId;
  const bodyArmorPower = (system.powers || []).find(
    (p: any) =>
      p.name.toLowerCase().replace(/[\s_-]+/g, "") === "bodyarmor" &&
      (!p.formIds?.length || p.formIds.includes(activeFormId))
  );
  const equippedArmor = (system.armors || []).find((a: any) => a.equipped);

  const currentArmor = system.resources?.armor?.value || 0;
  const currentHealth =
    system.healthByForm?.[currentFormId] ??
    system.resources?.health?.value ??
    0;

  let armorDamage = 0;
  let healthDamage = 0;
  let newArmorValue = currentArmor;
  let newHealthValue = currentHealth;

  const updates: Record<string, any> = {};

  if (currentArmor > 0) {
    // Apply damage to armor first
    armorDamage = Math.min(data.damage, currentArmor);
    newArmorValue = currentArmor - armorDamage;

    // Reduce armor values (EQUIPPED ARMOR FIRST, then body armor power)
    let remainingArmorDamage = armorDamage;

    // Equipped armor soaks first
    if (equippedArmor && remainingArmorDamage > 0) {
      const equippedArmorReduction = Math.min(
        remainingArmorDamage,
        equippedArmor.value
      );
      // Clone armors array and update the specific armor
      const updatedArmors = [...system.armors];
      const armorIndex = updatedArmors.findIndex(
        (a: any) => a.id === equippedArmor.id
      );
      if (armorIndex !== -1) {
        updatedArmors[armorIndex] = {
          ...updatedArmors[armorIndex],
          value: equippedArmor.value - equippedArmorReduction
        };
        updates["system.armors"] = updatedArmors;
      }
      remainingArmorDamage -= equippedArmorReduction;
    }

    // Body Armor power soaks remainder
    if (bodyArmorPower && remainingArmorDamage > 0) {
      const bodyArmorReduction = Math.min(
        remainingArmorDamage,
        bodyArmorPower.value
      );
      // Clone powers array and update the specific power
      const updatedPowers = [...system.powers];
      const powerIndex = updatedPowers.findIndex(
        (p: any) => p.id === bodyArmorPower.id
      );
      if (powerIndex !== -1) {
        updatedPowers[powerIndex] = {
          ...updatedPowers[powerIndex],
          value: bodyArmorPower.value - bodyArmorReduction
        };
        updates["system.powers"] = updatedPowers;
      }
    }

    // If damage exceeds armor, overflow to health
    const overflow = data.damage - armorDamage;
    if (overflow > 0) {
      healthDamage = overflow;
      newHealthValue = currentHealth - healthDamage;
    }
  } else {
    // No armor, all damage goes to health
    healthDamage = data.damage;
    newHealthValue = currentHealth - healthDamage;
  }

  // Update health in healthByForm for current form
  if (healthDamage > 0) {
    // Get existing healthByForm or create new one
    const existingHealthByForm = system.healthByForm || {};
    const updatedHealthByForm = {
      ...existingHealthByForm,
      [currentFormId]: newHealthValue
    };
    updates["system.healthByForm"] = updatedHealthByForm;
    // CRITICAL: Also update resources.health.value directly
    // prepareDerivedData() will recalculate from healthByForm, but we need immediate update
    updates["system.resources.health.value"] = newHealthValue;
  }

  // Update actor with new values
  try {
    await targetActor.update(updates);
    console.log("FASERIP Socket | Damage applied successfully:", {
      armorDamage,
      healthDamage,
      newArmorValue,
      newHealthValue
    });
  } catch (error) {
    console.error("FASERIP Socket | Error updating actor:", error);
    return null;
  }

  return {
    armorDamage,
    healthDamage,
    newArmorValue,
    newHealthValue
  };
}
