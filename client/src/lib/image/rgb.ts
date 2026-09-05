export type Rgb = [number, number, number];

/**
 * The standard AmigaOS Workbench grey, sampled from a 3.2.3 screenshot: colour 0 of the
 * standard palette, and `JobConfig.backgroundColor`'s default.
 *
 * It is a conversion value before it is a styling one. `flattenOntoBackground` composites
 * an icon's soft edges onto whatever colour is configured, and GlowIcons' own opaque grey
 * drop shadows only resolve on this one — which is why the picker exists, and why a
 * preview has to be shown on the colour actually in use rather than on this constant.
 * It stands in only when nothing is being baked in at all.
 */
export const WORKBENCH_GREY_RGB: Rgb = [0xab, 0xab, 0xab];

export const toHex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;

export const fromHex = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** The same grey as a CSS colour, for the DOM that has to paint it. */
export const WORKBENCH_GREY = toHex(WORKBENCH_GREY_RGB);
