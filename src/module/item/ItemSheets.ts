import { FsrItemBaseSheet } from "./FsrItemBaseSheet";
import ArmorSheetComponent from "./sheets/ArmorSheet.vue";
import WeaponSheetComponent from "./sheets/WeaponSheet.vue";
import EquipmentSheetComponent from "./sheets/EquipmentSheet.vue";
import type { Component } from "vue";

/**
 * Armor Item Sheet
 */
export class ArmorSheet extends FsrItemBaseSheet {
  static DEFAULT_OPTIONS = {
    classes: ["faserip", "sheet", "item", "armor"],
    position: {
      width: 500,
      height: "auto"
    },
    window: {
      resizable: true,
      title: "Armor"
    }
  };

  override get vueComponent(): Component {
    return ArmorSheetComponent;
  }

  get title(): string {
    // @ts-expect-error - item property exists
    return this.item.name || "Armor";
  }
}

/**
 * Weapon Item Sheet
 */
export class WeaponSheet extends FsrItemBaseSheet {
  static DEFAULT_OPTIONS = {
    classes: ["faserip", "sheet", "item", "weapon"],
    position: {
      width: 500,
      height: "auto"
    },
    window: {
      resizable: true,
      title: "Weapon"
    }
  };

  override get vueComponent(): Component {
    return WeaponSheetComponent;
  }

  get title(): string {
    // @ts-expect-error - item property exists
    return this.item.name || "Weapon";
  }
}

/**
 * Equipment Item Sheet
 */
export class EquipmentSheet extends FsrItemBaseSheet {
  static DEFAULT_OPTIONS = {
    classes: ["faserip", "sheet", "item", "equipment"],
    position: {
      width: 500,
      height: "auto"
    },
    window: {
      resizable: true,
      title: "Equipment"
    }
  };

  override get vueComponent(): Component {
    return EquipmentSheetComponent;
  }

  get title(): string {
    // @ts-expect-error - item property exists
    return this.item.name || "Equipment";
  }
}

/**
 * Generic Item Sheet for other item types (fallback)
 */
// @ts-expect-error - TypeScript doesn't recognize ItemSheetV2
export class GenericItemSheet extends foundry.applications.sheets.ItemSheetV2 {
  static DEFAULT_OPTIONS = {
    classes: ["faserip", "sheet", "item"],
    position: {
      width: 500,
      height: "auto"
    }
  };

  get title(): string {
    // @ts-expect-error - item property exists
    return this.item.name || "Item";
  }
}
