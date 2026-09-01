import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import JSZip from 'jszip';
import App from './App';
import { runConversionJob } from './lib/pipeline/convertJob';

vi.mock('./lib/pipeline/convertJob', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/pipeline/convertJob')>();
  return { ...actual, runConversionJob: vi.fn(actual.runConversionJob) };
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
 * The gallery renders one selection checkbox per icon tile, and each tile's accessible
 * name depends on its thumbnail having finished loading (async) — so querying by role
 * name alone is unreliable, and querying by role alone breaks the moment a second
 * checkbox (e.g. SelectedIconList's "system default" toggle) exists anywhere on the
 * page. Scoping to the row that renders the group's name sidesteps both problems.
 */
function galleryCheckboxFor(groupName: string): HTMLElement {
  // Scoped to the `<strong>` IconGallery renders the group name in — plain
  // `getByText(groupName)` becomes ambiguous once the same icon is also selected,
  // because SelectedIconList echoes its name in a `<span>` of its own.
  const row = screen.getByText(groupName, { selector: 'strong' }).closest('div');
  if (!row) throw new Error(`No row found for group "${groupName}"`);
  return within(row).getByRole('checkbox');
}

describe('App end-to-end', () => {
  it('loads a theme, selects an icon, converts it, and enables download', async () => {
    render(<App />);

    const file = await makeThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('folder')).toBeInTheDocument());

    fireEvent.click(galleryCheckboxFor('folder'));
    fireEvent.click(screen.getByRole('button', { name: /convert/i }));

    await waitFor(() => expect(screen.getByRole('link', { name: /download/i })).toBeInTheDocument(), {
      timeout: 5000,
    });
  });

  it('shows an error and no download link when conversion fails', async () => {
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
    fireEvent.change(screen.getByLabelText(/max colors/i), { target: { value: '4' } });

    // Reselect the same icon. The old preview was built under the pre-change config, so
    // it must not reappear — not even for the width of the debounce window. Showing it
    // would be a preview the user cannot trust, not merely a delayed one.
    fireEvent.click(galleryCheckboxFor('folder'));
    expect(screen.queryByLabelText(/normal state for folder/i)).not.toBeInTheDocument();

    // It does eventually come back once the new debounced build under the new config
    // completes — the fix removes the stale flash, not the preview itself.
    await screen.findByLabelText(/normal state for folder/i, {}, { timeout: 2000 });
  });
});
