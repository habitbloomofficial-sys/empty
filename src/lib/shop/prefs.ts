export interface Prefs {
  /** Whether this buyer has already been through the introduction. */
  introSeen: boolean;
}

export const prefsKey = (id: string) => `aurea:prefs:${id}`;
