import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import JSZip from 'jszip';
import App from './App';
import { runConversionJob, DEFAULT_JOB_CONFIG } from './lib/pipeline/convertJob';
import { buildPreviews } from './lib/pipeline/preview';
import { ARCHIVE_BASE_NAME } from './lib/output/outputEntries';

vi.mock('./lib/pipeline/convertJob', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/pipeline/convertJob')>();
  return { ...actual, runConversionJob: vi.fn(actual.runConversionJob) };
});

vi.mock('./lib/pipeline/preview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/pipeline/preview')>();
  return { ...actual, buildPreviews: vi.fn(actual.buildPreviews) };
});

async function makeThemeZipFile(): Promise<File> {
  const zip = new JSZip();
  zip.file(
    'scalable/places/folder.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#3355ff"/></svg>',
  );
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'theme.zip', { type: 'application/zip' });
}

async function makeTwoIconThemeZipFile(): Promise<File> {
  const zip = new JSZip();
  zip.file(
    'scalable/places/folder.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#3355ff"/></svg>',
  );
  zip.file(
    'scalable/mimetypes/text-x-generic.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#33ff55"/></svg>',
  );
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'theme.zip', { type: 'application/zip' });
}

/**
 * Two variants of one icon *name* — the folder-wine case the gallery exists to expose.
 * Both land in the same IconGroup, so both would be written as `folder-wine.info`.
 */
async function makeTwoVariantThemeZipFile(): Promise<File> {
  const zip = new JSZip();
  zip.file(
    '48x48/apps/folder-wine.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#3355ff"/></svg>',
  );
  zip.file(
    '48x48/places/folder-wine.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#eeeeee"/></svg>',
  );
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'theme.zip', { type: 'application/zip' });
}

/** Two differently-named icons that both infer kind 'drawer' — so both can claim def_drawer. */
async function makeTwoDrawerThemeZipFile(): Promise<File> {
  const zip = new JSZip();
  zip.file(
    '48x48/places/folder.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#3355ff"/></svg>',
  );
  zip.file(
    '48x48/places/folder-open.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#33ff55"/></svg>',
  );
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'theme.zip', { type: 'application/zip' });
}

/**
 * The gallery renders one selection checkbox per icon tile, and each tile's accessible
 * name depends on its thumbnail having finished loading (async) — so querying by role
 * name alone is unreliable, and querying by role alone breaks the moment a second
 * checkbox (e.g. SelectedIconList's default-slot toggle) exists anywhere on the
 * page. Scoping to the row that renders the group's name sidesteps both problems.
 */
function galleryCard(groupName: string): HTMLElement {
  // Scoped to the name element IconTile renders inside a gallery card — plain
  // `getByText(groupName)` becomes ambiguous once the same icon is also selected,
  // because SelectedIconList echoes its name in a `<span>` of its own.
  const card = screen.getByText(groupName, { selector: '.icon-tile__name' }).closest('.gallery__card');
  if (!card) throw new Error(`No card found for group "${groupName}"`);
  return card as HTMLElement;
}

function galleryCheckboxFor(groupName: string): HTMLElement {
  return within(galleryCard(groupName)).getByRole('checkbox');
}

/**
 * Picks one specific variant of a group, by the `<small>` caption IconTile renders
 * ("<category> <size>").
 *
 * The gallery now shows one card per icon set — its best variant — so the siblings are
 * only reachable through the card's variant picker. This opens that picker (a no-op if
 * it is already open for this group) and finds the tile inside it, which is the same
 * path a user takes.
 */
function galleryVariantCheckbox(groupName: string, variantLabel: string): HTMLElement {
  const trigger = within(galleryCard(groupName)).queryByRole('button', { name: /variants$/ });
  if (trigger) fireEvent.click(trigger);

  const picker = screen.getByRole('dialog', { name: new RegExp(groupName) });
  const tile = within(picker).getByText(variantLabel, { selector: 'small' }).closest('label');
  if (!tile) throw new Error(`No tile found for variant "${variantLabel}"`);
  return within(tile).getByRole('checkbox');
}

describe('App end-to-end', () => {
  it('loads a theme, selects an icon, converts it, and offers both archive formats', async () => {
    render(<App />);

    const file = await makeThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('folder')).toBeInTheDocument());

    fireEvent.click(galleryCheckboxFor('folder'));
    fireEvent.click(screen.getByRole('button', { name: /convert/i }));

    await waitFor(() => expect(screen.getByRole('link', { name: /download zip/i })).toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(screen.getByRole('link', { name: /download lha/i })).toBeInTheDocument();
  });

  it('offers the LHA download under a .lha filename', async () => {
    render(<App />);
    const file = await makeThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('folder', { selector: '.icon-tile__name' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: /folder/i }));
    fireEvent.click(screen.getByRole('button', { name: /convert/i }));

    const lha = await screen.findByRole('link', { name: /download lha/i }, { timeout: 5000 });
    // Against the constant, not a literal: renaming the download is meant to rename the
    // drawer inside both archives with it, and this is what notices if it stops doing so.
    expect(lha).toHaveAttribute('download', `${ARCHIVE_BASE_NAME}.lha`);
    expect(screen.getByRole('link', { name: /download zip/i })).toHaveAttribute(
      'download',
      `${ARCHIVE_BASE_NAME}.zip`,
    );
  });

  it('shows an error and no download links when conversion fails', async () => {
    vi.mocked(runConversionJob).mockRejectedValueOnce(new Error('boom'));

    render(<App />);

    const file = await makeThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('folder')).toBeInTheDocument());

    fireEvent.click(galleryCheckboxFor('folder'));
    fireEvent.click(screen.getByRole('button', { name: /convert/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
  });

  it('does not resurrect a stale kind override when a new theme reuses the same zipPath', async () => {
    render(<App />);

    // Theme A: select folder, override its inferred kind ('drawer') to something else.
    const themeA = await makeThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [themeA] } });
    await waitFor(() => expect(screen.getByText('folder')).toBeInTheDocument());

    fireEvent.click(galleryCheckboxFor('folder'));
    const kindSelectA = await screen.findByLabelText(/type for folder/i);
    expect(kindSelectA).toHaveValue('drawer');
    fireEvent.change(kindSelectA, { target: { value: 'tool' } });
    expect(kindSelectA).toHaveValue('tool');

    // Theme B reuses the exact same zipPath ("scalable/places/folder.svg") for an
    // unrelated icon. Loading it must not carry theme A's override forward.
    const themeB = await makeThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [themeB] } });
    await waitFor(() => expect(screen.getByText('folder')).toBeInTheDocument());

    fireEvent.click(galleryCheckboxFor('folder'));
    const kindSelectB = await screen.findByLabelText(/type for folder/i);
    expect(kindSelectB).toHaveValue('drawer');
  });

  it('keeps a user override on one icon when another icon is selected afterwards', async () => {
    render(<App />);

    const file = await makeTwoIconThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('folder')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('text-x-generic')).toBeInTheDocument());

    fireEvent.click(galleryCheckboxFor('folder'));
    const folderKind = await screen.findByLabelText(/type for folder/i);
    expect(folderKind).toHaveValue('drawer');
    fireEvent.change(folderKind, { target: { value: 'trashcan' } });
    expect(folderKind).toHaveValue('trashcan');

    fireEvent.click(galleryCheckboxFor('text-x-generic'));
    await screen.findByLabelText(/type for text-x-generic/i);

    // Selecting the second icon must not reseed or clobber the first icon's override.
    expect(screen.getByLabelText(/type for folder/i)).toHaveValue('trashcan');
  });

  it('does not show a stale preview after deselect, config change, and reselect', async () => {
    render(<App />);

    const file = await makeThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('folder')).toBeInTheDocument());

    // Select, and wait for the debounced build to actually land — this is the "good"
    // preview that must never be shown again once it's stale.
    fireEvent.click(galleryCheckboxFor('folder'));
    await screen.findByLabelText(/normal state for folder/i, {}, { timeout: 2000 });

    // Deselect everything. The preview must disappear immediately — nothing to show.
    fireEvent.click(galleryCheckboxFor('folder'));
    expect(screen.queryByLabelText(/normal state for folder/i)).not.toBeInTheDocument();

    // Change the job config while nothing is selected — reachable because JobConfigForm
    // is always rendered regardless of selection.
    fireEvent.change(screen.getByLabelText(/max colours/i), { target: { value: '4' } });

    // Reselect the same icon. The old preview was built under the pre-change config, so
    // it must not reappear — not even for the width of the debounce window. Showing it
    // would be a preview the user cannot trust, not merely a delayed one.
    fireEvent.click(galleryCheckboxFor('folder'));
    expect(screen.queryByLabelText(/normal state for folder/i)).not.toBeInTheDocument();

    // It does eventually come back once the new debounced build under the new config
    // completes — the fix removes the stale flash, not the preview itself.
    await screen.findByLabelText(/normal state for folder/i, {}, { timeout: 2000 });
  });

  it('replaces a previously selected sibling when another variant of the same icon is ticked', async () => {
    render(<App />);

    const file = await makeTwoVariantThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('folder-wine', { selector: '.icon-tile__name' })).toBeInTheDocument());

    const appsVariant = galleryVariantCheckbox('folder-wine', 'apps 48');
    const placesVariant = galleryVariantCheckbox('folder-wine', 'places 48');

    fireEvent.click(appsVariant);
    expect(appsVariant).toBeChecked();

    // Both variants share the name "folder-wine", so both would be written as
    // folder-wine.info and the second would silently overwrite the first. Ticking the
    // second must therefore replace the first rather than join it.
    fireEvent.click(placesVariant);
    expect(placesVariant).toBeChecked();
    expect(appsVariant).not.toBeChecked();
  });

  it('writes exactly one .info per selected icon name', async () => {
    vi.mocked(runConversionJob).mockClear();
    render(<App />);

    const file = await makeTwoVariantThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('folder-wine', { selector: '.icon-tile__name' })).toBeInTheDocument());

    fireEvent.click(galleryVariantCheckbox('folder-wine', 'apps 48'));
    fireEvent.click(galleryVariantCheckbox('folder-wine', 'places 48'));
    fireEvent.click(screen.getByRole('button', { name: /convert/i }));

    await waitFor(() => expect(screen.getByRole('link', { name: /download zip/i })).toBeInTheDocument(), {
      timeout: 5000,
    });

    // The job is handed one input per surviving selection — the sibling that was
    // replaced must never reach it. (Asserting only the archive's contents would pass
    // vacuously: outputEntries writes `${name}.info`, so a second sibling would simply
    // overwrite the first and the count would still be one. That silent overwrite is
    // exactly the bug.)
    const [, inputs] = vi.mocked(runConversionJob).mock.calls.at(-1)!;
    expect(inputs.map((input) => input.icon.zipPath)).toEqual(['48x48/places/folder-wine.svg']);

    const converted = (await vi.mocked(runConversionJob).mock.results.at(-1)!.value) as Array<{
      name: string;
    }>;
    expect(converted.map((icon) => icon.name)).toEqual(['folder-wine']);
  });

  it('refuses to convert when two icons claim the same system default role', async () => {
    vi.mocked(runConversionJob).mockClear();
    render(<App />);

    const file = await makeTwoDrawerThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('folder', { selector: '.icon-tile__name' })).toBeInTheDocument());

    fireEvent.click(galleryCheckboxFor('folder'));
    fireEvent.click(galleryCheckboxFor('folder-open'));
    fireEvent.click(await screen.findByLabelText(/use folder as the system default/i));
    fireEvent.click(await screen.findByLabelText(/use folder-open as the system default/i));

    fireEvent.click(screen.getByRole('button', { name: /convert/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/drawer/i);
    expect(alert).toHaveTextContent(/folder/);
    expect(alert).toHaveTextContent(/folder-open/);
    expect(runConversionJob).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
  });

  it('drops the existing previews the instant the selection grows', async () => {
    render(<App />);

    const file = await makeTwoIconThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('folder', { selector: '.icon-tile__name' })).toBeInTheDocument());

    fireEvent.click(galleryCheckboxFor('folder'));
    await screen.findByLabelText(/normal state for folder/i, {}, { timeout: 2000 });

    // The palette is built across the whole selection, so *adding* an icon invalidates
    // every preview already on screen just as thoroughly as a config change does. Showing
    // folder's old preview through the debounce window is showing a picture computed under
    // a palette the output will not use.
    fireEvent.click(galleryCheckboxFor('text-x-generic'));
    expect(screen.queryByLabelText(/normal state for folder/i)).not.toBeInTheDocument();

    // Both come back once the rebuild under the new palette lands.
    await screen.findByLabelText(/normal state for folder/i, {}, { timeout: 2000 });
    await screen.findByLabelText(/normal state for text-x-generic/i, {}, { timeout: 2000 });
  });

  it('shows no previews at all when the build fails, rather than the previous ones', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      render(<App />);

      const file = await makeTwoIconThemeZipFile();
      fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });
      await waitFor(() => expect(screen.getByText('folder', { selector: '.icon-tile__name' })).toBeInTheDocument());

      fireEvent.click(galleryCheckboxFor('folder'));
      await screen.findByLabelText(/normal state for folder/i, {}, { timeout: 2000 });

      vi.mocked(buildPreviews).mockRejectedValueOnce(new Error('decode exploded'));
      fireEvent.click(galleryCheckboxFor('text-x-generic'));

      await waitFor(() => expect(warn).toHaveBeenCalled(), { timeout: 2000 });
      // Well past the 250ms debounce and the failed build: a rejected build must leave the
      // screen empty, not silently keep rendering previews from a superseded selection.
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(screen.queryByLabelText(/normal state for folder/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/normal state for text-x-generic/i)).not.toBeInTheDocument();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('removing a selected icon', () => {
  it('drops the row and unticks it back in the gallery', async () => {
    render(<App />);

    const file = await makeTwoIconThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('folder', { selector: '.icon-tile__name' })).toBeInTheDocument());

    fireEvent.click(galleryCheckboxFor('folder'));
    fireEvent.click(galleryCheckboxFor('text-x-generic'));
    expect(screen.getByText(/selected icons \(2\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /remove folder/i }));

    expect(screen.getByText(/selected icons \(1\)/i)).toBeInTheDocument();
    // The gallery is the other view of the same selection: leaving its tick behind would
    // make the icon look selected while the conversion no longer includes it.
    expect(galleryCheckboxFor('folder')).not.toBeChecked();
    expect(galleryCheckboxFor('text-x-generic')).toBeChecked();
  });

  it('leaves nothing to convert once the last row is removed', async () => {
    render(<App />);

    const file = await makeThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('folder')).toBeInTheDocument());

    fireEvent.click(galleryCheckboxFor('folder'));
    fireEvent.click(screen.getByRole('button', { name: /remove folder/i }));

    expect(screen.getByRole('button', { name: /convert/i })).toBeDisabled();
  });
});

describe('preview invalidation', () => {
  it('drops the existing previews the instant the background colour changes', async () => {
    // Soft edges are baked against this colour, so changing it changes every pixel of
    // every preview — showing the old ones through the debounce window is showing
    // pictures the conversion will not produce.
    render(<App />);

    const file = await makeThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('folder')).toBeInTheDocument());

    fireEvent.click(galleryCheckboxFor('folder'));
    await screen.findByLabelText(/normal state for folder/i, {}, { timeout: 2000 });

    fireEvent.change(screen.getByLabelText(/background colour/i), { target: { value: '#ff0000' } });
    expect(screen.queryByLabelText(/normal state for folder/i)).not.toBeInTheDocument();

    await screen.findByLabelText(/normal state for folder/i, {}, { timeout: 2000 });
  });
});

describe('default configuration', () => {
  it('defaults to the size GlowIcons was measured at', () => {
    // glowRadiusFor(48) is 4 — the halo thickness decoded from Workbench 3.2.3 — so 48
    // is the size at which the default Glow Surround output matches GlowIcons ring for
    // ring. Below it the ramp starts truncating.
    expect(DEFAULT_JOB_CONFIG.outputSizePx).toBe(48);
  });
});
