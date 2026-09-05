import type {
  ArmorDataModel,
  WeaponDataModel,
  EquipmentDataModel
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
 * Type for an Item document with Equipment system data
 */
export interface EquipmentItem extends Item {
  system: EquipmentDataModel;
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

/**
 * Type guard to check if an item is an EquipmentItem
 */
export function isEquipmentItem(
  item: Item | null | undefined
): item is EquipmentItem {
  return item?.type === "equipment";
}
