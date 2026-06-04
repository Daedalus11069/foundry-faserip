import type {
  ArmorDataModel,
  WeaponDataModel
} from "../data-models/ItemDataModels";

/**
 * Type for an Item document with Armor system data
 */
export interface ArmorItem extends Item {
  system: ArmorDataModel;
}

/**
 * Type for an Item document with Weapon system data
 */
export interface WeaponItem extends Item {
  system: WeaponDataModel;
}

/**
 * Type guard to check if an item is an ArmorItem
 */
export function isArmorItem(item: Item | null | undefined): item is ArmorItem {
  return item?.type === "armor";
}

/**
 * Type guard to check if an item is a WeaponItem
 */
export function isWeaponItem(
  item: Item | null | undefined
): item is WeaponItem {
  return item?.type === "weapon";
}
