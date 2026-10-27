import { useEffect, useMemo, useRef, useState } from 'react';
import { generateCode } from '../codegen';
import { createZip } from '../codegen/zip';
import { setUi, showToast, updateProject, useStore } from '../model/store';
import type { Language } from '../model/types';
import { planAuto } from '../planner/trajectory';
import { IconButton, Segmented } from './controls';
import { copyText, downloadBlob } from './files';
import { highlight, languageOf } from './highlight';
import { IconCopy, IconDownload, IconX } from './icons';

export function CodeModal() {
  const project = useStore((s) => s.project);
  const [selected, setSelected] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  const { files, issues } = useMemo(() => {
    const plans = new Map(
      project.autos.map((a) => [
        a.id,
        planAuto(a, project.robot, {
          sampleTime: project.codegen.sampleTime,
          commands: project.commands,
          autoPeriod: project.codegen.autoPeriod,
          field: project.field,
        }),
      ]),
    );
    const issues = project.autos.flatMap((a) =>
      (plans.get(a.id)?.warnings ?? []).filter((w) => w.level !== 'info').map((w) => ({ auto: a.name, ...w })),
    );
    return { files: generateCode(project, plans), issues };
  }, [project]);

  const file = files[Math.min(selected, files.length - 1)];
  const html = useMemo(() => highlight(file.content, languageOf(file.path)), [file]);
  const lines = useMemo(() => file.content.split('\n').length, [file]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUi({ codeOpen: false });
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fileName = (path: string) => path.split('/').pop() ?? path;
  const zipName = project.codegen.language === 'java' ? 'kop-autos-java.zip' : 'kop-autos-python.zip';

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setUi({ codeOpen: false })}>
      <div className="modal code-modal" role="dialog" aria-modal="true" aria-labelledby="code-title" tabIndex={-1} ref={dialogRef}>
        <header className="modal-head">
          <h2 id="code-title">Generated robot code</h2>
          <Segmented<Language>
            label="Language"
            value={project.codegen.language}
            onChange={(v) => {
              updateProject((p) => (p.codegen.language = v));
              setSelected(0);
            }}
            options={[
              { value: 'java', label: 'Java' },
              { value: 'python', label: 'Python' },
            ]}
          />
          <div className="spacer" />
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              downloadBlob(zipName, createZip(files), 'application/zip');
              showToast(`Downloaded ${zipName}`);
            }}
          >
            <IconDownload /> Download all (.zip)
          </button>
          <IconButton title="Close (Esc)" onClick={() => setUi({ codeOpen: false })}>
            <IconX />
          </IconButton>
        </header>
        {issues.length > 0 && (
          <div className="code-issues" role="status">
            {issues.slice(0, 4).map((w, i) => (
              <div key={i} className={`warning ${w.level}`}>
                <span className="warning-icon" aria-hidden>
                  {w.level === 'error' ? '✕' : '!'}
                </span>
                <span>
                  <strong>{w.auto}:</strong> {w.message}
                </span>
              </div>
            ))}
            {issues.length > 4 && <div className="muted small">…and {issues.length - 4} more (see the Auto tab).</div>}
          </div>
        )}
        <div className="code-body">
          <nav className="file-list" aria-label="Generated files">
            {files.map((f, i) => (
              <button key={f.path} type="button" className={i === selected ? 'active' : undefined} onClick={() => setSelected(i)} title={f.path}>
                <span className="file-name">{fileName(f.path)}</span>
                <span className="file-dir">{f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : 'project root'}</span>
              </button>
            ))}
          </nav>
          <div className="code-view">
            <div className="code-toolbar">
              <code className="code-path">{file.path}</code>
              <span className="muted small">{lines} lines</span>
              <div className="spacer" />
              <button
                type="button"
                className="btn small"
                onClick={async () => showToast((await copyText(file.content)) ? `Copied ${fileName(file.path)}` : 'Copy failed')}
              >
                <IconCopy /> Copy
              </button>
              <button type="button" className="btn small" onClick={() => downloadBlob(fileName(file.path), file.content, 'text/plain')}>
                <IconDownload /> Download
              </button>
            </div>
            <pre className="code" tabIndex={0}>
              <code dangerouslySetInnerHTML={{ __html: html }} />
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
