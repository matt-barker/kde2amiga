import type { ThemeIcon } from '../lib/theme/themeParser';

function keyOf(icon: ThemeIcon): string {
  return `${icon.category}/${icon.name}`;
}

export function IconGallery(props: {
  icons: ThemeIcon[];
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
