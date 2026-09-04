/**
 * Migration utility to convert the plain-data `statDebuff`/`damageBuff`/`dot`
 * singular fields on actor-level system.powers/system.weapons entries into
 * the new `statDebuffs`/`damageBuffs`/`dots` arrays.
 *
 * This runs once per world when the GM first loads the world after upgrade.
 * These entries are plain JSON data (not Foundry DataModel-backed), so the
 * ItemDataModel.migrateData() hook does not cover them - this migration is
 * required in addition to that one.
 *
 * To force re-run the migration (for testing or recovery):
 * `await game.settings.set("faserip", "powerArrayFieldsMigrationCompleted", false)`
 */

function migrateEntryBuffDebuffFields(entry: any): boolean {
  let changed = false;
  const renames: Array<[string, string]> = [
    ["statDebuff", "statDebuffs"],
    ["damageBuff", "damageBuffs"],
    ["dot", "dots"]
  ];

  for (const [oldKey, newKey] of renames) {
    if (entry[oldKey] && !Array.isArray(entry[newKey])) {
      entry[newKey] = [entry[oldKey]];
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(entry, oldKey)) {
      delete entry[oldKey];
      changed = true;
    }
  }

  return changed;
}

/**
 * Migrate a single actor's system.powers/system.weapons entries
 */
async function migrateActorPowerArrays(actor: Actor): Promise<boolean> {
  const system = actor.system as any;
  let changed = false;

  const powers = Array.isArray(system.powers) ? system.powers : [];
  for (const power of powers) {
    if (migrateEntryBuffDebuffFields(power)) changed = true;
  }

  const weapons = Array.isArray(system.weapons) ? system.weapons : [];
  for (const weapon of weapons) {
    if (migrateEntryBuffDebuffFields(weapon)) changed = true;
  }

  if (changed) {
    try {
      await actor.update({
        "system.powers": powers,
        "system.weapons": weapons
      });
    } catch (error) {
      console.error(
        `FASERIP | Failed to migrate power/weapon buff/debuff arrays for actor ${actor.name}:`,
        error
      );
      return false;
    }
  }

  return changed;
}

/**
 * Main migration function - migrates all actors in the world
 */
export async function migratePowerArrayFields(): Promise<void> {
  const migrationKey = "powerArrayFieldsMigrationCompleted";
  const hasMigrated = game.settings.get("faserip", migrationKey);

  if (hasMigrated) {
    console.log(
      "FASERIP | Power/weapon buff-debuff array migration already completed, skipping."
    );
    return;
  }

  console.log(
    "FASERIP | Starting migration of legacy statDebuff/damageBuff/dot fields to arrays..."
  );

  let migratedActors = 0;

  // @ts-expect-error - game.actors is iterable
  for (const actor of game.actors) {
    const changed = await migrateActorPowerArrays(actor);
    if (changed) {
      migratedActors++;
      console.log(`FASERIP | Migrated buff/debuff arrays for ${actor.name}`);
    }
  }

  await game.settings.set("faserip", migrationKey, true);

  if (migratedActors > 0) {
    console.log(
      `FASERIP | Buff/debuff array migration complete! Migrated ${migratedActors} actors.`
    );
  } else {
    console.log("FASERIP | No actors needed buff/debuff array migration.");
  }
}

/**
 * Force re-run migration (for development/testing)
 */
export async function forceMigratePowerArrayFields(): Promise<void> {
  await game.settings.set("faserip", "powerArrayFieldsMigrationCompleted", false);
  await migratePowerArrayFields();
}
