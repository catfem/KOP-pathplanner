import { useMemo, useState } from 'react';
import { type GeneratedFile, generateCode } from '../../codegen/index';
import { createZip } from '../../codegen/zip';
import { setUi, showToast, updateProject, useStore } from '../../model/store';
import type { Language, Project } from '../../model/types';
import { type PlanWarning, planAuto } from '../../planner/trajectory';
import { Segmented } from '../components/controls';
import { IconCopy, IconDownload } from '../components/icons';
import { Modal } from '../components/Modal';
import { copyText, downloadBlob } from '../lib/files';
import { highlight, languageOf } from '../lib/highlight';

interface Output {
  files: GeneratedFile[];
  issues: (PlanWarning & { auto: string })[];
  error: string | null;
}

/** Plans every auto and generates the code; failures become a message, not a crash. */
function generate(project: Project): Output {
  try {
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
    return { files: generateCode(project, plans), issues, error: null };
  } catch (err) {
    console.error('KOP Path Planner: code generation failed', err);
    return { files: [], issues: [], error: err instanceof Error ? err.message : String(err) };
  }
}

const fileName = (path: string) => path.split('/').pop() ?? path;

export function CodeModal() {
  const project = useStore((s) => s.project);
  const [selected, setSelected] = useState(0);
  const { files, issues, error } = useMemo(() => generate(project), [project]);
  const file: GeneratedFile | undefined = files[Math.min(selected, files.length - 1)];
  const html = useMemo(() => (file ? highlight(file.content, languageOf(file.path)) : ''), [file]);
  const lines = useMemo(() => (file ? file.content.split('\n').length : 0), [file]);
  const zipName = project.codegen.language === 'java' ? 'kop-autos-java.zip' : 'kop-autos-python.zip';
  const close = () => setUi({ codeOpen: false });

  return (
    <Modal
      title="Generated robot code"
      onClose={close}
      size="lg"
      actions={
        <>
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
            disabled={files.length === 0}
            onClick={() => {
              downloadBlob(zipName, createZip(files), 'application/zip');
              showToast(`Downloaded ${zipName}`);
            }}
          >
            <IconDownload /> Download all (.zip)
          </button>
        </>
      }
    >
      {error && (
        <div className="code-issues" role="alert">
          <div className="warning error">
            <span className="warning-icon" aria-hidden>
              ✕
            </span>
            <span>Code generation failed: {error}. Check the Auto tab for problems with the paths.</span>
          </div>
        </div>
      )}
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
      {file && (
        <div className="code-body">
          <nav className="file-list" aria-label="Generated files">
            {files.map((f, i) => (
              <button
                key={f.path}
                type="button"
                className={i === selected ? 'active' : undefined}
                aria-current={i === selected}
                onClick={() => setSelected(i)}
                title={f.path}
              >
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
                onClick={async () => {
                  const ok = await copyText(file.content);
                  showToast(ok ? `Copied ${fileName(file.path)}` : 'Copy failed: select the code and copy it by hand.', ok ? 'info' : 'error');
                }}
              >
                <IconCopy /> Copy
              </button>
              <button type="button" className="btn small" onClick={() => downloadBlob(fileName(file.path), file.content, 'text/plain')}>
                <IconDownload /> Download
              </button>
            </div>
            <pre className="code" tabIndex={0} aria-label={`Contents of ${fileName(file.path)}`}>
              <code dangerouslySetInnerHTML={{ __html: html }} />
            </pre>
          </div>
        </div>
      )}
    </Modal>
  );
}
