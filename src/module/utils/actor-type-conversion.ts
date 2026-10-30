import { ActorType } from "../enums";

/**
 * GM-only conversion of an actor between PC and NPC. Both types share the same
 * data model apart from PC-only `popularity`, so only the type and the
 * type-dependent prototype token defaults change.
 */

const TYPE_LABEL: Record<string, string> = {
  [ActorType.Pc]: "FASERIP.ActorType.Pc",
  [ActorType.Npc]: "FASERIP.ActorType.Npc"
};

export function getConversionTarget(actor: Actor): ActorType | null {
  if (actor.type === ActorType.Pc) return ActorType.Npc;
  if (actor.type === ActorType.Npc) return ActorType.Pc;
  return null;
}

/** Prototype token defaults, matching the preCreate/preCreateToken hooks. */
function prototypeTokenUpdates(target: ActorType): Record<string, unknown> {
  if (target === ActorType.Pc) {
    return {
      "prototypeToken.actorLink": true,
      "prototypeToken.sight.enabled": true,
      "prototypeToken.displayName": CONST.TOKEN_DISPLAY_MODES.ALWAYS,
      "prototypeToken.displayBars": CONST.TOKEN_DISPLAY_MODES.ALWAYS
    };
  }
  return {
    "prototypeToken.actorLink": false,
    "prototypeToken.sight.enabled": false,
    "prototypeToken.displayBars": CONST.TOKEN_DISPLAY_MODES.OWNER
  };
}

export async function convertActorType(actor: Actor): Promise<boolean> {
  if (!(game as any).user?.isGM) {
    ui.notifications?.warn((game as any).i18n.localize("FASERIP.ActorConvert.GMOnly"));
    return false;
  }

  const target = getConversionTarget(actor);
  if (!target) return false;

  // A synthetic actor of an unlinked token has no type of its own to change
  if ((actor as any).isToken) {
    ui.notifications?.warn(
      (game as any).i18n.localize("FASERIP.ActorConvert.UnlinkedToken")
    );
    return false;
  }

  const from = (game as any).i18n.localize(TYPE_LABEL[actor.type]);
  const to = (game as any).i18n.localize(TYPE_LABEL[target]);
  const confirmed = await (globalThis as any).foundry.applications.api.DialogV2.confirm({
    window: { title: (game as any).i18n.localize("FASERIP.ActorConvert.Title") },
    content: `<p>${(game as any).i18n.format("FASERIP.ActorConvert.Confirm", {
      name: foundry.utils.escapeHTML(actor.name ?? ""),
      from,
      to
    })}</p>`,
    rejectClose: false,
    modal: true
  });
  if (!confirmed) return false;

  // Flush and tear down the sheet; it is registered per type and mounted for
  // the old one.
  const oldSheet = actor.sheet;
  await oldSheet?.close();

  await actor.update({ type: target, ...prototypeTokenUpdates(target) });

  if (actor.type !== target) {
    ui.notifications?.error(
      (game as any).i18n.localize("FASERIP.ActorConvert.Failed")
    );
    return false;
  }

  // Drop the cached sheet so the new type's sheet class is resolved
  (actor as any)._sheet = null;
  actor.sheet?.render(true);

  ui.notifications?.info(
    (game as any).i18n.format("FASERIP.ActorConvert.Done", {
      name: actor.name ?? "",
      to
    })
  );
  return true;
}
