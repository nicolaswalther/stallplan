interface LayerGroup { name: unknown; visible: boolean }
export interface OptionalLayerConfig extends Iterable<[string, LayerGroup]> {
  setVisibility(id: string, visible: boolean): void;
}

/** Hide only explicit pattern layers in a separate semantic render. */
export function hideNamedHatching(config: OptionalLayerConfig): string[] {
  const hidden: string[] = [];
  for (const [id, group] of config) {
    if (!group.visible || typeof group.name !== "string") continue;
    const name = group.name.toLowerCase();
    if (!/(?:^|[^a-z])(?:hatch(?:ing)?|schraff(?:ur|uren|ierung|ierungen)?|kreskowanie|patt)(?:$|[^a-z])/.test(name)) continue;
    // Mixed-purpose layers stay intact: their contents cannot safely be split.
    if (/(?:^|[^a-z])(?:text|label|dimension|dim|wall|door|gate|equipment|symbol|opis)(?:$|[^a-z])/.test(name)) continue;
    config.setVisibility(id, false);
    hidden.push(group.name);
  }
  return hidden;
}
