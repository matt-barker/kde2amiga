import type { IconVariant } from '../lib/theme/themeParser';

// Keyed by zipPath, not category/name: a group can now hold several variants
// that share a name and category (different sizes), so only the zip path is
// guaranteed unique per variant.
function keyOf(icon: IconVariant): string {
  return icon.zipPath;
}

export function IconGallery(props: {
  icons: IconVariant[];
  selected: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
}) {
  function toggle(key: string) {
    const next = new Set(props.selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    props.onSelectionChange(next);
  }

  return (
    <ul>
      {props.icons.map((icon) => {
        const key = keyOf(icon);
        const inputId = `icon-${key}`;
        return (
          <li key={key}>
            <input
              id={inputId}
              type="checkbox"
              checked={props.selected.has(key)}
              onChange={() => toggle(key)}
            />
            <label htmlFor={inputId}>{`${icon.name} (${icon.category})`}</label>
          </li>
        );
      })}
    </ul>
  );
}
