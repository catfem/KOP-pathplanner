// Export and import of autos from the UI (sidebar buttons and the Project menu).

import { createZip } from '../../codegen/zip';
import { allAutoFiles, autoFileName, importAutoFiles, toAutoFile } from '../../model/autoFiles';
import { getState, setUi, showToast, updateProject } from '../../model/store';
import type { Auto } from '../../model/types';
import { downloadBlob, pickFiles } from './files';

export function exportAuto(auto: Auto): void {
  const file = toAutoFile(auto, getState().project);
  downloadBlob(autoFileName(auto.name), JSON.stringify(file, null, 2), 'application/json');
}

export function exportAllAutos(): void {
  downloadBlob('kop-autos.zip', createZip(allAutoFiles(getState().project)), 'application/zip');
}

/** Asks for auto files (or project files) and adds their autos to the project. */
export async function importAutos(): Promise<void> {
  await importAutoFileList(await pickFiles('.json,.auto.json,.kop.json,application/json'));
}

/** Adds the autos in these auto files (or project files) to the project. Throws when none has any. */
export async function importAutoFileList(picked: File[]): Promise<void> {
  if (picked.length === 0) return;
  const files = await Promise.all(
    picked.map(async (f) => {
      try {
        return { name: f.name, data: JSON.parse(await f.text()) as unknown };
      } catch {
        return { name: f.name, data: null };
      }
    }),
  );
  const result = importAutoFiles(files, getState().project);
  updateProject((p) => {
    p.autos.push(...result.autos);
    p.commands.push(...result.commands);
  });
  setUi({ selectedAutoId: result.autos[0].id, selectedIndex: null, time: 0, playing: false });
  const added = result.commands.length ? ` Added the named command${result.commands.length > 1 ? 's' : ''} ${result.commands.map((c) => c.name).join(', ')}.` : '';
  const names = result.autos.map((a) => `“${a.name}”`).join(', ');
  showToast(`Imported ${names}.${added}${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`);
}
