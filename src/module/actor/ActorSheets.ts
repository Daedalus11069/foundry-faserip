import { FsrBaseSheet } from "./FsrBaseSheet";
import ActorSheet from "./shared/ActorSheet.vue";
import type { Component } from "vue";

/**
 * PC Sheet
 */
export class PcSheet extends FsrBaseSheet {
  static DEFAULT_OPTIONS = {
    classes: ["faserip", "sheet", "actor", "fsr-sheet", "pc"],
    position: {
      width: 800,
      height: "auto"
    },
    actions: {},
    window: {
      resizable: true
    }
  };

  get vueComponent(): Component {
    return ActorSheet;
  }
}

/**
 * NPC Sheet
 */
export class NpcSheet extends FsrBaseSheet {
  static DEFAULT_OPTIONS = {
    classes: ["faserip", "sheet", "actor", "fsr-sheet", "npc"],
    position: {
      width: 800,
      height: "auto"
    },
    actions: {},
    window: {
      resizable: true
    }
  };

  get vueComponent(): Component {
    return ActorSheet;
  }
}
