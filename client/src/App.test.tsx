import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import JSZip from 'jszip';
import App from './App';

async function makeThemeZipFile(): Promise<File> {
  const zip = new JSZip();
  zip.file(
    'scalable/places/folder.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#3355ff"/></svg>',
  );
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'theme.zip', { type: 'application/zip' });
}

describe('App end-to-end', () => {
  it('loads a theme, selects an icon, converts it, and enables download', async () => {
    render(<App />);

    const file = await makeThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByLabelText(/folder \(places\)/i)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/folder \(places\)/i));
    fireEvent.click(screen.getByRole('button', { name: /convert/i }));

    await waitFor(() => expect(screen.getByRole('link', { name: /download/i })).toBeInTheDocument(), {
      timeout: 5000,
    });
  });
});
