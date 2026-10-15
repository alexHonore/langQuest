/**
 * Collect files from a drop event (files and nested folders through the
 * `webkitGetAsEntry` FileSystem API) or from a `<input webkitdirectory>` selection.
 * Yields incrementally so thousands of entries never block the UI.
 */
export interface DroppedFile {
  file: File;
  relativePath: string;
}

type EntryLike = FileSystemEntry & { isFile: boolean; isDirectory: boolean; fullPath: string };

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const out: FileSystemEntry[] = [];
    const step = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(out);
        else {
          out.push(...batch);
          step();
        }
      }, reject);
    step();
  });
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function* walkEntry(entry: EntryLike, prefix: string): AsyncGenerator<DroppedFile> {
  if (entry.isFile) {
    const file = await entryFile(entry as unknown as FileSystemFileEntry);
    yield { file, relativePath: prefix ? `${prefix}/${entry.name}` : entry.name };
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as unknown as FileSystemDirectoryEntry).createReader();
    const children = await readAllEntries(reader);
    const next = prefix ? `${prefix}/${entry.name}` : entry.name;
    for (const child of children) yield* walkEntry(child as EntryLike, next);
  }
}

/** Walk a DataTransfer (drop event). Falls back to flat `files` when entries are unavailable. */
export async function* collectDropped(dataTransfer: DataTransfer): AsyncGenerator<DroppedFile> {
  const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
  const entries = items
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? (item.webkitGetAsEntry() as EntryLike | null) : null))
    .filter((e): e is EntryLike => e !== null);
  if (entries.length > 0) {
    for (const entry of entries) yield* walkEntry(entry, '');
    return;
  }
  for (const file of Array.from(dataTransfer.files)) yield { file, relativePath: file.name };
}

/** Files from an `<input type=file>` (with or without `webkitdirectory`). */
export function collectFromInput(files: FileList | File[]): DroppedFile[] {
  return Array.from(files).map((file) => ({
    file,
    relativePath: ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(/\\/g, '/'),
  }));
}
