/**
 * Linked Tokens
 *
 * Lets a group of tokens (e.g. several unlinked tokens made from one drone
 * actor) act together: when one of them attacks, every other token in its
 * group repeats the attack (see mirrorLinkedAttacks in combat-flow.ts).
 *
 * The link lives on each TokenDocument as flags.faserip.linkedTokens - the ids
 * of the *other* tokens in its group, on the same scene. It is stored on both
 * sides of every link, so either token can look up its partners directly.
 */

const FLAG_SCOPE = "faserip";
const FLAG_KEY = "linkedTokens";

/** Ids of the tokens linked to this one (excluding itself). */
export function getLinkedTokenIds(tokenDoc: any): string[] {
  const ids = tokenDoc?.getFlag?.(FLAG_SCOPE, FLAG_KEY);
  return Array.isArray(ids) ? ids : [];
}

/**
 * Live token documents linked to this one that still exist on its scene.
 * Dead links (deleted tokens) are silently skipped.
 */
export function getLinkedTokenDocuments(tokenDoc: any): any[] {
  const scene = tokenDoc?.parent;
  if (!scene) return [];
  return getLinkedTokenIds(tokenDoc)
    .map(id => scene.tokens?.get(id))
    .filter((doc: any) => !!doc && doc.id !== tokenDoc.id);
}

/** The token document an attack by `actor` is coming from, if any. */
export function getAttackerTokenDocument(
  actor: any,
  attackerToken?: any
): any | null {
  return (
    attackerToken?.document ??
    actor?.token ??
    actor?.getActiveTokens?.()[0]?.document ??
    null
  );
}

/** True when every token in the set already lists all of the others. */
export function areTokensLinked(tokenDocs: any[]): boolean {
  if (tokenDocs.length < 2) return false;
  return tokenDocs.every(doc => {
    const linked = getLinkedTokenIds(doc);
    return tokenDocs.every(other => other.id === doc.id || linked.includes(other.id));
  });
}

/** Link every given token to every other one. */
export async function linkTokens(tokenDocs: any[]): Promise<void> {
  for (const doc of tokenDocs) {
    const ids = new Set(getLinkedTokenIds(doc));
    for (const other of tokenDocs) {
      if (other.id !== doc.id) ids.add(other.id);
    }
    await doc.setFlag(FLAG_SCOPE, FLAG_KEY, [...ids]);
  }
}

/**
 * Remove the given tokens from their group entirely: each one forgets all of
 * its partners, and each former partner forgets it.
 */
export async function unlinkTokens(tokenDocs: any[]): Promise<void> {
  for (const doc of tokenDocs) {
    const partners = getLinkedTokenDocuments(doc);
    for (const partner of partners) {
      const remaining = getLinkedTokenIds(partner).filter(id => id !== doc.id);
      if (remaining.length > 0) {
        await partner.setFlag(FLAG_SCOPE, FLAG_KEY, remaining);
      } else {
        await partner.unsetFlag(FLAG_SCOPE, FLAG_KEY);
      }
    }
    await doc.unsetFlag(FLAG_SCOPE, FLAG_KEY);
  }
}
