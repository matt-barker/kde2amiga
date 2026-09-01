import { describe, it, expect } from 'vitest';
import { inferIconKind } from './iconKind';

describe('inferIconKind', () => {
  it('treats anything trash-like as a trashcan, even when it is also folder-like', () => {
    // "user-trash-symbolic" matches both rules; trash must win.
    expect(inferIconKind('user-trash-symbolic', 'places')).toBe('trashcan');
    expect(inferIconKind('emptytrash', 'places')).toBe('trashcan');
    expect(inferIconKind('folder-trash', 'places')).toBe('trashcan');
  });

  it('treats folders and home directories as drawers', () => {
    expect(inferIconKind('folder', 'places')).toBe('drawer');
    expect(inferIconKind('folder-desktop', 'places')).toBe('drawer');
    expect(inferIconKind('user-home', 'places')).toBe('drawer');
    expect(inferIconKind('directory', 'places')).toBe('drawer');
  });

  it('treats drive-like icons as disks', () => {
    expect(inferIconKind('drive-harddisk', 'devices')).toBe('disk');
    expect(inferIconKind('media-floppy', 'devices')).toBe('disk');
  });

  it('falls back to project for everything else', () => {
    expect(inferIconKind('network', 'places')).toBe('project');
    expect(inferIconKind('text-x-generic', 'mimetypes')).toBe('project');
  });
});
