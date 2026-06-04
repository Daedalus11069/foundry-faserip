/**
 * Migration utility to convert embedded armors/weapons arrays to Item documents
 *
 * This migration runs automatically once per world when the GM first loads the world after upgrade.
 * It converts old embedded data in system.armors and system.weapons to proper Item documents.
 *
 * To force re-run the migration (for testing or recovery):
 * 1. Open browser console (F12)
 * 2. Run: `await game.faserip.forceMigrateItems()`
 *
 * Or to reset the migration flag without running:
 * `await game.settings.set("faserip", "itemsMigrationCompleted", false)`
 */

interface OldArmorData {
  id: string;
  name: string;
  rank: string;
  value: number;
  maxValue: number;
  equipped: boolean;
  description?: string;
}

interface OldWeaponData {
  id: string;
  name: string;
  type: "melee" | "ranged";
  damage: string;
  stat: "fighting" | "agility";
  applicableTalent?: string;
  description?: string;
  equipped: boolean;
}

/**
 * Migrate a single actor's embedded armors/weapons to Item documents
 */
async function migrateActorItems(
  actor: Actor
): Promise<{ armors: number; weapons: number }> {
  let armorCount = 0;
  let weaponCount = 0;

  const system = actor.system as any;

  // Migrate armors
  if (
    system.armors &&
    Array.isArray(system.armors) &&
    system.armors.length > 0
  ) {
    const armorItemsToCreate = system.armors.map((oldArmor: OldArmorData) => ({
      name: oldArmor.name,
      type: "armor",
      system: {
        rank: oldArmor.rank,
        value: oldArmor.value,
        maxValue: oldArmor.maxValue,
        equipped: oldArmor.equipped,
        description: oldArmor.description || ""
      }
    }));

    try {
      await actor.createEmbeddedDocuments("Item", armorItemsToCreate);
      armorCount = armorItemsToCreate.length;

      // Clear the old array (keep the field for backwards compatibility, just empty it)
      await actor.update({ "system.armors": [] });
    } catch (error) {
      console.error(
        `FASERIP | Failed to migrate armors for actor ${actor.name}:`,
        error
      );
    }
  }

  // Migrate weapons
  if (
    system.weapons &&
    Array.isArray(system.weapons) &&
    system.weapons.length > 0
  ) {
    const weaponItemsToCreate = system.weapons.map(
      (oldWeapon: OldWeaponData) => {
        // Map old weapon type to new weaponType, handle "thrown" as melee-like
        const weaponType = oldWeapon.type === "ranged" ? "ranged" : "melee";

        // For old weapons, damage was a string (rank)
        // New system: melee uses number (CS), ranged uses damageRank (string)
        const isRanged = weaponType === "ranged";

        return {
          name: oldWeapon.name,
          type: "weapon",
          system: {
            weaponType,
            damage: isRanged ? 0 : 0, // Default to 0 CS for melee, not used for ranged
            damageRank: isRanged ? oldWeapon.damage : "typical", // Use old damage rank for ranged
            equipped: oldWeapon.equipped,
            description: oldWeapon.description || ""
          }
        };
      }
    );

    try {
      await actor.createEmbeddedDocuments("Item", weaponItemsToCreate);
      weaponCount = weaponItemsToCreate.length;

      // Clear the old array
      await actor.update({ "system.weapons": [] });
    } catch (error) {
      console.error(
        `FASERIP | Failed to migrate weapons for actor ${actor.name}:`,
        error
      );
    }
  }

  return { armors: armorCount, weapons: weaponCount };
}

/**
 * Main migration function - migrates all actors in the world
 */
export async function migrateEmbeddedItemsToDocuments(): Promise<void> {
  // Check if migration has already been run
  const migrationKey = "itemsMigrationCompleted";
  const hasMigrated = game.settings.get("faserip", migrationKey);

  if (hasMigrated) {
    console.log("FASERIP | Item migration already completed, skipping.");
    return;
  }

  console.log(
    "FASERIP | Starting migration of embedded armors/weapons to Item documents..."
  );

  let totalActors = 0;
  let totalArmors = 0;
  let totalWeapons = 0;

  // Migrate all actors in the world
  for (const actor of game.actors) {
    const result = await migrateActorItems(actor);

    if (result.armors > 0 || result.weapons > 0) {
      totalActors++;
      totalArmors += result.armors;
      totalWeapons += result.weapons;
      console.log(
        `FASERIP | Migrated ${actor.name}: ${result.armors} armors, ${result.weapons} weapons`
      );
    }
  }

  // Mark migration as complete
  await game.settings.set("faserip", migrationKey, true);

  if (totalActors > 0) {
    console.log(
      `FASERIP | Migration complete! Migrated ${totalActors} actors with ${totalArmors} armors and ${totalWeapons} weapons.`
    );
    ui.notifications?.info(
      `Item Migration: Converted ${totalArmors} armors and ${totalWeapons} weapons from ${totalActors} actors to Item documents.`
    );
  } else {
    console.log("FASERIP | No actors needed migration.");
  }
}

/**
 * Force re-run migration (for development/testing)
 */
export async function forceMigrateItems(): Promise<void> {
  await game.settings.set("faserip", "itemsMigrationCompleted", false);
  await migrateEmbeddedItemsToDocuments();
}
