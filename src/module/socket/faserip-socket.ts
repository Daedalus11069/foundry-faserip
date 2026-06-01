/**
 * FASERIP Socket System
 * Handles multiplayer combat interactions - defense prompts, damage application, etc.
 */

import type { FaseripActor } from "../documents";
import DefenseResponseModal from "../applications/DefenseResponseModal.vue";
import CounterAttackModal from "../applications/CounterAttackModal.vue";
import { VueDialog } from "../applications/vue-dialog";
import { formatRankDisplay } from "../enums";
import { applyDamageToActor } from "../utils/damage-application";

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
 * Data structure for counter-attack prompt sent to defender
 */
interface CounterAttackPromptData {
  defenderActorId: string;
  defenderTokenId?: string;
  defenderName: string;
  attackerName: string;
  defenseRoll: number;
  attackRoll: number;
  counterType: "ultimate-vs-ultimate" | "ultimate-vs-normal" | "red-vs-normal";
  promptId?: string;
}

/**
 * Response from defender after choosing whether to counter
 */
interface CounterAttackResponse {
  counterAttack: boolean;
  _respondingUserId?: string;
}

/**
 * Map to track active counter-attack prompts
 */
const activeCounterPrompts = new Map<
  string,
  { dialog: any; resolve: (value: CounterAttackResponse | null) => void }
>();

/**
 * Initialize the socket system
 */
export function initializeSocket(): void {
  // @ts-expect-error - Foundry game global
  if (!game.ready) {
    console.warn("FASERIP Socket | Game not ready, deferring initialization");
    Hooks.once("ready", initializeSocket);
    return;
  }

  // @ts-expect-error - Foundry game.modules global
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
  socket.register("promptCounterAttack", handleCounterAttackPrompt);
  socket.register("cancelCounterAttackPrompt", handleCancelCounterAttackPrompt);
  socket.register("applyDamage", handleApplyDamage);
}

/**
 * Request a defense response from the target's owner
 * Called by the attacker's client
 */
export async function requestDefenseResponse(
  data: DefensePromptData
): Promise<DefenseResponse | null> {
  // Get the target actor
  let targetActor: FaseripActor | undefined;
  if (data.targetTokenId) {
    const token = canvas?.tokens?.get(data.targetTokenId);
    targetActor = token?.actor as FaseripActor | undefined;
  } else {
    // @ts-expect-error - Foundry game.actors collection
    targetActor = game.actors?.find(
      (a: FaseripActor) => a.id === data.targetActorId
    ) as FaseripActor | undefined;
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
    // @ts-expect-error - Foundry game.user global
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

  if (potentialControllers.length === 0) {
    console.warn("FASERIP Socket | No controllers found - taking hit");
    return { defenseType: "takeHit" };
  }

  // If only one user, just send to them
  if (potentialControllers.length === 1) {
    const user = potentialControllers[0];
    return await socket.executeAsUser("promptDefense", user.id, data);
  }

  // Multiple GMs - race condition handling (first to respond wins)

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
    (
      response as DefenseResponse & { _targetActor?: FaseripActor }
    )._targetActor = game.actors?.find(
      (a: FaseripActor) => a.id === response._targetActorId
    ) as FaseripActor | undefined;
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
function findTokenControllers(actor: FaseripActor): User[] {
  // First, find all non-GM users who own the actor
  const playerOwners: User[] =
    // @ts-expect-error - Foundry game.users collection
    game.users?.filter(
      (user: User) =>
        user.active && !user.isGM && actor.testUserPermission(user, "OWNER")
    ) || [];

  // If there are player owners, only return them (exclude GMs)
  if (playerOwners.length > 0) {
    return playerOwners;
  }

  // If no players own the actor, return GMs (for unowned NPCs)
  const gmOwners: User[] =
    // @ts-expect-error - Foundry game.users collection
    game.users?.filter(
      (user: User) =>
        user.active && user.isGM && actor.testUserPermission(user, "OWNER")
    ) || [];

  return gmOwners;
}

/**
 * Handle a defense prompt on the defender's client
 * Shows the defense modal and waits for user response
 * This function is called remotely via socketlib
 */
async function handleDefensePrompt(
  data: DefensePromptData
): Promise<DefenseResponse | null> {
  // Get the target actor
  let targetActor: FaseripActor | undefined;
  if (data.targetTokenId) {
    const token = canvas?.tokens?.get(data.targetTokenId);
    targetActor = token?.actor as FaseripActor | undefined;
  } else {
    // @ts-expect-error - Foundry game.actors collection
    targetActor = game.actors?.find(
      (a: FaseripActor) => a.id === data.targetActorId
    ) as FaseripActor | undefined;
  }

  if (!targetActor) {
    console.error("FASERIP Socket | Target actor not found");
    return { defenseType: "takeHit" };
  }

  // Security check - verify this user owns the target
  // @ts-expect-error - Foundry game.user global
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
    // @ts-expect-error - Foundry game.user global
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
    prompt.dialog?.close();
    prompt.resolve(null);
    activeDefensePrompts.delete(data.promptId);
  }
}

/**
 * Request a counter-attack response from the defender's owner
 * Called after a successful defense that allows counter-attack
 */
export async function requestCounterAttackResponse(
  data: CounterAttackPromptData
): Promise<CounterAttackResponse | null> {
  // Get the defender actor
  let defenderActor: FaseripActor | undefined;
  if (data.defenderTokenId) {
    const token = canvas?.tokens?.get(data.defenderTokenId);
    defenderActor = token?.actor as FaseripActor | undefined;
  } else {
    // @ts-expect-error - Foundry game.actors collection
    defenderActor = game.actors?.find(
      (a: FaseripActor) => a.id === data.defenderActorId
    ) as FaseripActor | undefined;
  }

  if (!defenderActor) {
    console.error("FASERIP Socket | Defender actor not found");
    return { counterAttack: false };
  }

  if (!socket) {
    console.warn(
      "FASERIP Socket | Socket not initialized - falling back to local"
    );
    // Fallback: handle locally if user is GM or owns the defender
    // @ts-expect-error - Foundry game.user global
    if (game.user?.isGM || defenderActor.isOwner) {
      return await handleCounterAttackPrompt(data);
    }
    console.error("FASERIP Socket | Cannot handle counter-attack locally");
    return { counterAttack: false };
  }

  // Generate unique prompt ID for tracking
  const promptId = foundry.utils.randomID();
  data.promptId = promptId;

  // Find users who could handle this counter-attack
  const potentialControllers = findTokenControllers(defenderActor);

  if (potentialControllers.length === 0) {
    console.warn("FASERIP Socket | No controllers found - no counter-attack");
    return { counterAttack: false };
  }

  // If only one user, just send to them
  if (potentialControllers.length === 1) {
    const user = potentialControllers[0];
    return await socket.executeAsUser("promptCounterAttack", user.id, data);
  }

  // Multiple GMs - race condition handling (first to respond wins)

  const promises = potentialControllers.map((user: any) =>
    socket
      .executeAsUser("promptCounterAttack", user.id, data)
      .then((response: CounterAttackResponse | null) => ({
        response,
        userId: user.id
      }))
  );

  const firstResult = await Promise.race(promises);

  if (!firstResult || !firstResult.response) {
    return { counterAttack: false };
  }

  // Cancel other prompts
  for (const user of potentialControllers) {
    if (user.id !== firstResult.userId) {
      socket
        .executeAsUser("cancelCounterAttackPrompt", user.id, {
          promptId,
          winnerUserId: firstResult.userId
        })
        .catch((err: any) => {
          console.warn(
            "FASERIP Socket | Failed to cancel counter prompt for user:",
            user.id,
            err
          );
        });
    }
  }

  return firstResult.response;
}

/**
 * Handle counter-attack prompt on the defender's client
 * Shows VueDialog for choosing whether to counter-attack
 */
async function handleCounterAttackPrompt(
  data: CounterAttackPromptData
): Promise<CounterAttackResponse | null> {
  const promptId = data.promptId || foundry.utils.randomID();

  try {
    // Create cancellation promise (for multi-GM race conditions)
    let externalResolve:
      | ((value: CounterAttackResponse | null) => void)
      | null = null;
    const cancellationPromise = new Promise<CounterAttackResponse | null>(
      resolve => {
        externalResolve = resolve;
      }
    );

    // Create the dialog (but don't await show() - we need to track it first)
    const dialog = new VueDialog(
      CounterAttackModal,
      {
        defenderName: data.defenderName,
        attackerName: data.attackerName,
        defenseRoll: data.defenseRoll,
        attackRoll: data.attackRoll,
        counterType: data.counterType
      },
      {
        window: { title: "Counter-Attack?" },
        position: { width: 500 }
      }
    );

    // Store dialog reference BEFORE showing it (for cancellation)
    if (externalResolve) {
      activeCounterPrompts.set(promptId, {
        dialog: dialog,
        resolve: externalResolve
      });
    }

    // Render the dialog
    await dialog.render(true);

    // Race between user response and external cancellation
    const result = (await Promise.race([
      dialog.wait(),
      cancellationPromise
    ])) as CounterAttackResponse | null;

    // Clean up
    activeCounterPrompts.delete(promptId);

    if (result) {
      // @ts-expect-error - Foundry game.user global
      result._respondingUserId = game.user?.id;
    }

    return result;
  } catch (error) {
    console.error("FASERIP Socket | Error in counter-attack prompt:", error);
    activeCounterPrompts.delete(promptId);
    return { counterAttack: false };
  }
}

/**
 * Cancel a counter-attack prompt (called when another user responds first)
 */
function handleCancelCounterAttackPrompt(data: {
  promptId: string;
  winnerUserId?: string;
}): void {
  const prompt = activeCounterPrompts.get(data.promptId);
  if (prompt) {
    prompt.dialog?.close();
    prompt.resolve({ counterAttack: false });
    activeCounterPrompts.delete(data.promptId);
  }
}

/**
 * Data structure for damage application
 */
interface ApplyDamageData {
  targetActorId: string;
  targetTokenId?: string;
  damage: number;
  damageType?: string; // Type of damage (fire, cold, etc.) for resistance checking
  powerName?: string; // Name of attacking power for resistance messages
  armorUpdates?: any[];
  powerUpdates?: any[];
}

/**
 * Request damage application on the target owner's client
 * Called by the attacker's client after calculating damage
 */
export async function requestDamageApplication(
  targetActor: FaseripActor,
  damage: number,
  damageType?: string,
  powerName?: string,
  targetTokenId?: string
): Promise<{
  armorDamage: number;
  healthDamage: number;
  newArmorValue: number;
  newHealthValue: number;
} | null> {
  if (!socket) {
    console.warn(
      "FASERIP Socket | Socket not initialized - applying damage locally"
    );
    // Fallback: apply locally if user is GM or owns the target
    // @ts-expect-error - Foundry game.user global
    if (game.user?.isGM || targetActor.isOwner) {
      return await handleApplyDamage({
        targetActorId: targetActor.id!,
        damage,
        damageType,
        powerName
      });
    }
    console.error("FASERIP Socket | Cannot apply damage locally");
    return null;
  }

  // Find the owner of the target
  const owner = findTokenControllers(targetActor)[0];
  if (!owner) {
    return await handleApplyDamage({
      targetActorId: targetActor.id!,
      targetTokenId,
      damage,
      damageType,
      powerName
    });
  }

  // Execute damage application on the owner's client
  const result = await socket.executeAsUser("applyDamage", owner.id, {
    targetActorId: targetActor.id!,
    targetTokenId,
    damage,
    damageType,
    powerName
  });

  return result;
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
  // Get the target actor
  // @ts-expect-error - Foundry game.actors collection
  const targetActor = game.actors?.find(
    (a: FaseripActor) => a.id === data.targetActorId
  ) as FaseripActor | undefined;

  if (!targetActor) {
    console.error("FASERIP Socket | Target actor not found");
    return null;
  }

  // Security check - verify this user owns the target
  // @ts-expect-error - Foundry game.user global
  if (!game.user?.isGM && !targetActor.isOwner) {
    console.warn(
      "FASERIP Socket | User doesn't own target - cannot apply damage"
    );
    return null;
  }

  // Get degrading armor setting
  const degradingEnabled =
    game.settings.get("faserip", "degradingArmor") ?? false;

  // Use centralized damage application
  const result = applyDamageToActor({
    actor: targetActor,
    damage: data.damage,
    damageType: data.damageType,
    degradingArmorEnabled: degradingEnabled
  });

  // Show resistance chat messages if applicable
  if (result.resistancePower && result.resistanceReduction) {
    if (result.armorDamage > 0) {
      // Resistance applied to overflow
      if (
        result.resistanceReduction >=
        result.originalDamage! - result.armorDamage
      ) {
        // Complete resistance to overflow
        await ChatMessage.create({
          content: `<div class="fsr-chat-card fsr-success">
            <h3>Resistance: Complete Protection</h3>
            <p><strong>${targetActor.name}</strong>'s armor absorbed ${result.armorDamage} damage</p>
            <p><strong>${result.resistancePower.name}</strong> (${formatRankDisplay(result.resistancePower.rank)}: ${result.resistancePower.value}) completely resists ${result.resistanceReduction} overflow ${data.damageType} damage${data.powerName ? ` from <strong>${data.powerName}</strong>` : ""}!</p>
          </div>`,
          speaker: ChatMessage.getSpeaker({ actor: targetActor })
        });
      } else {
        // Partial resistance to overflow
        await ChatMessage.create({
          content: `<div class="fsr-chat-card">
            <h3>Resistance: Partial Protection</h3>
            <p><strong>${targetActor.name}</strong>'s armor absorbed ${result.armorDamage} damage</p>
            <p><strong>${result.resistancePower.name}</strong> (${formatRankDisplay(result.resistancePower.rank)}: ${result.resistancePower.value}) reduces overflow ${data.damageType} damage by ${result.resistanceReduction}</p>
            <p class="fsr-rank-change">${result.originalDamage! - result.armorDamage} → ${result.healthDamage} overflow damage</p>
          </div>`,
          speaker: ChatMessage.getSpeaker({ actor: targetActor })
        });
      }
    } else {
      // Resistance applied to all damage (no armor)
      if (result.resistanceReduction >= result.originalDamage!) {
        // Complete resistance
        await ChatMessage.create({
          content: `<div class="fsr-chat-card fsr-success">
            <h3>Resistance: Complete Immunity</h3>
            <p><strong>${targetActor.name}</strong>'s ${result.resistancePower.name} (${formatRankDisplay(result.resistancePower.rank)}: ${result.resistancePower.value}) completely resists ${result.originalDamage} ${data.damageType} damage${data.powerName ? ` from <strong>${data.powerName}</strong>` : ""}!</p>
          </div>`,
          speaker: ChatMessage.getSpeaker({ actor: targetActor })
        });
      } else {
        // Partial resistance
        await ChatMessage.create({
          content: `<div class="fsr-chat-card">
            <h3>Resistance: Partial Protection</h3>
            <p><strong>${targetActor.name}</strong>'s ${result.resistancePower.name} (${formatRankDisplay(result.resistancePower.rank)}: ${result.resistancePower.value}) reduces ${data.damageType} damage by ${result.resistanceReduction}</p>
            <p class="fsr-rank-change">${result.originalDamage} → ${result.healthDamage} damage</p>
          </div>`,
          speaker: ChatMessage.getSpeaker({ actor: targetActor })
        });
      }
    }
  }

  const system = targetActor.system as any;
  const currentFormId = system.currentFormId || "";

  // Build updates object
  const updates: Record<string, any> = {};

  // Add armor updates if armors were damaged
  if (system.armors) {
    updates["system.armors"] = system.armors;
  }

  // Add power updates if powers were damaged
  if (system.powers) {
    updates["system.powers"] = system.powers;
  }

  // Add health updates
  if (system.healthByForm) {
    updates["system.healthByForm"] = system.healthByForm;
  }

  // Update actor with new values
  try {
    // CRITICAL: Get the specific token if token ID provided (for unlinked multi-target attacks)
    // Otherwise fall back to first active token
    const targetToken = data.targetTokenId
      ? canvas?.tokens?.get(data.targetTokenId)?.document
      : targetActor.getActiveTokens()[0]?.document || null;

    // Update the token document if it exists and is unlinked, otherwise update the actor
    if (targetToken && !targetToken.actorLink) {
      // Unlinked token - update token's delta (actor overrides)
      // CRITICAL: Need to prepend "delta." to all update keys
      const tokenUpdates: Record<string, any> = {};
      for (const [key, value] of Object.entries(updates)) {
        tokenUpdates[`delta.${key}`] = value;
      }

      // CRITICAL: Ensure currentFormId is set in token delta so prepareDerivedData can load correct health
      if (currentFormId && !tokenUpdates["delta.system.currentFormId"]) {
        tokenUpdates["delta.system.currentFormId"] = currentFormId;
      }

      await targetToken.update(tokenUpdates);

      // Get fresh reference to the token's synthetic actor after delta update
      const updatedTokenActor = targetToken.actor;
      if (updatedTokenActor) {
        // CRITICAL: After delta update, explicitly refresh bar values AND max
        // The token bars cache values and need to be told to recalculate from actor resources
        if (targetToken.object) {
          const healthResource = (updatedTokenActor.system as any).resources
            ?.health;
          const armorResource = (updatedTokenActor.system as any).resources
            ?.armor;

          // Update bar value and max cache directly
          if (healthResource !== undefined && targetToken.bar1) {
            // @ts-expect-error - Token bar property assignment
            targetToken.bar1.value = healthResource.value;
            // @ts-expect-error - Token bar property assignment
            targetToken.bar1.max = healthResource.max;
          }
          if (armorResource !== undefined && targetToken.bar2) {
            // @ts-expect-error - Token bar property assignment
            targetToken.bar2.value = armorResource.value;
            // @ts-expect-error - Token bar property assignment
            targetToken.bar2.max = armorResource.max;
          }

          // Trigger visual refresh
          targetToken.object.drawBars();
        }

        // Force sheet refresh if open
        if (updatedTokenActor.sheet && updatedTokenActor.sheet.rendered) {
          updatedTokenActor.sheet.render(false);
        }
      }
    } else {
      // Linked actor or no token - update the base actor
      await targetActor.update(updates);

      // Force sheet refresh if open
      if (targetActor.sheet && targetActor.sheet.rendered) {
        targetActor.sheet.render(false);
      }

      // Force token bars to refresh
      const activeTokens = targetActor.getActiveTokens();
      for (const token of activeTokens) {
        await token.drawBars();
      }
    }
  } catch (error) {
    console.error("FASERIP Socket | Error updating actor:", error);
    return null;
  }

  const returnResult = {
    armorDamage: result.armorDamage,
    healthDamage: result.healthDamage,
    newArmorValue: result.newArmorValue,
    newHealthValue: result.newHealthValue
  };

  return returnResult;
}
