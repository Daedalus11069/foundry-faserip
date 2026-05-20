import type { PcDataModel } from "./module/data-models/ActorDataModels";
import type { NpcDataModel } from "./module/data-models/ActorDataModels";

declare global {
  interface FaseripSettingConfig {
    charmanApiUrl: string;
    charmanApiKey: string;
  }

  interface DataModelConfig {
    Actor: {
      pc: typeof PcDataModel;
      npc: typeof NpcDataModel;
    };
  }

  // Augment TokenDocument to accept texture.src in updates
  namespace foundry {
    namespace documents {
      interface BaseToken {
        update(data: {
          _id?: string;
          actorLink?: boolean;
          "texture.src"?: string;
          name?: string;
          [key: string]: any;
        }): Promise<this>;
      }
    }

    // Add v13 renderTemplate to foundry.applications.handlebars namespace
    namespace applications {
      namespace handlebars {
        function renderTemplate(
          path: string,
          data?: Record<string, any>
        ): Promise<string>;
      }
    }
  }

  interface FlagConfig {
    Actor: {
      faserip: {
        [key: string]: any;
      };
    };
    Item: {
      faserip: {
        [key: string]: any;
      };
    };
    ChatMessage: {
      faserip: {
        isLogEntry?: boolean;
        logType?: "info" | "warn" | "error" | "success";
        category?: string;
        actorId?: string;
        itemId?: string;
        metadata?: Record<string, any>;
        timestamp?: number;
        userId?: string;
        userName?: string;
      };
    };
    ActiveEffect: {
      faserip: {
        type?: string;
        sourceItem?: string;
        bonusNotes?: string;
        [key: string]: any;
      };
    };
  }

  interface SettingConfig {
    "faserip.charmanApiUrl": string;
    "faserip.charmanApiKey": string;
  }

  interface Game {
    faserip: {
      [key: string]: any;
    };
    itempiles: any;
    actors: Iterable<Actor> | null | undefined;
    packs: Map<string, any>;
    settings: {
      get(namespace: "faserip", key: keyof FaseripSettingConfig): any;
      get(namespace: string, key: string): any;
      set(
        namespace: "faserip",
        key: keyof FaseripSettingConfig,
        value: any
      ): Promise<any>;
      set(namespace: string, key: string, value: any): Promise<any>;
      register(namespace: string, key: string, data: any): void;
      registerMenu(namespace: string, key: string, data: any): void;
      storage: Map<string, any>;
    };
  }

  const game: Game;
  const ui: {
    notifications: {
      info: (message: string) => void;
      warn: (message: string) => void;
      error: (message: string) => void;
    };
  };
}
