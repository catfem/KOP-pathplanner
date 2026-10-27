import { FIELD_PRESETS } from '../model/defaults';
import { elementLabel, presetElements, rebuilt2026Elements } from '../model/field';
import { setFieldImage, setUi, showToast, updateProject, useStore } from '../model/store';
import type { FieldElement } from '../model/types';
import { Checkbox, NumberField, Section, SelectField } from './controls';

function ElementEditor({ element, index, showSize }: { element: FieldElement; index: number; showSize: boolean }) {
  const set = (key: 'x' | 'y' | 'sizeX' | 'sizeY', v: number) =>
    updateProject(
      (p) => {
        const e = p.field.elements[index];
        if (e) e[key] = v;
      },
      { coalesce: `element:${element.id}:${key}` },
    );
  return (
    <div className="element-row">
      <div className="element-title">
        <span className={`swatch ${element.kind} ${element.alliance}`} aria-hidden />
        {elementLabel(element)}
      </div>
      <div className="grid-2">
        <NumberField label="Center X" unit="m" value={element.x} step={0.01} onChange={(v) => set('x', v)} />
        <NumberField label="Center Y" unit="m" value={element.y} step={0.01} onChange={(v) => set('y', v)} />
        {showSize && (
          <>
            <NumberField label="Size X" unit="m" value={element.sizeX} min={0.05} step={0.01} onChange={(v) => set('sizeX', v)} />
            <NumberField label="Size Y" unit="m" value={element.sizeY} min={0.05} step={0.01} onChange={(v) => set('sizeY', v)} />
          </>
        )}
      </div>
    </div>
  );
}

export function FieldPanel() {
  const field = useStore((s) => s.project.field);
  const hasImage = useStore((s) => s.fieldImage !== null);
  const showGuides = useStore((s) => s.ui.showGuides);
  const hubs = field.elements.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === 'hub');
  const others = field.elements.map((e, i) => ({ e, i })).filter(({ e }) => e.kind !== 'hub');

  const onImage = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const ok = setFieldImage(String(reader.result));
      showToast(ok ? 'Field image set.' : 'Field image set, but it is too large to remember after reload.');
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="panel-scroll">
      <Section title="Field">
        <SelectField
          label="Field"
          value={field.preset}
          onChange={(v) =>
            updateProject((p) => {
              const preset = FIELD_PRESETS.find((f) => f.id === v);
              p.field.preset = v;
              if (preset && v !== 'custom') {
                p.field.length = preset.length;
                p.field.width = preset.width;
                p.field.elements = presetElements(v);
              }
            })
          }
          options={FIELD_PRESETS.map((f) => ({ value: f.id, label: f.label }))}
        />
        <div className="grid-2">
          <NumberField
            label="Length"
            unit="m"
            value={field.length}
            min={2}
            step={0.1}
            onChange={(v) =>
              updateProject(
                (p) => {
                  p.field.length = v;
                  p.field.preset = 'custom';
                },
                { coalesce: 'field:length' },
              )
            }
          />
          <NumberField
            label="Width"
            unit="m"
            value={field.width}
            min={2}
            step={0.1}
            onChange={(v) =>
              updateProject(
                (p) => {
                  p.field.width = v;
                  p.field.preset = 'custom';
                },
                { coalesce: 'field:width' },
              )
            }
          />
        </div>
        <div className="button-row">
          <label className="btn small file-btn">
            Field image…
            <input type="file" accept="image/*" onChange={(e) => onImage(e.target.files?.[0])} />
          </label>
          {hasImage && (
            <button type="button" className="btn small" onClick={() => setFieldImage(null)}>
              Remove image
            </button>
          )}
        </div>
        <p className="muted small">A top-down image cropped to the field edges, blue alliance wall on the left.</p>
        <Checkbox
          label="Bumper distance guides"
          checked={showGuides}
          onChange={(v) => setUi({ showGuides: v })}
          hint="On the field: start bumpers to the alliance wall and guardrail, and the front bumper to an aimed HUB."
        />
      </Section>

      <Section title="HUBs">
        <Checkbox
          label="Show HUBs, BUMPs and TRENCHes and plan around them"
          checked={field.elementsEnabled}
          onChange={(v) => updateProject((p) => (p.field.elementsEnabled = v))}
          hint="Aim stop points at a HUB, slow down on BUMPs, and get warnings for collisions."
        />
        {field.elements.length === 0 && (
          <div className="empty-elements">
            <p className="muted small">This field has no elements.</p>
            <button
              type="button"
              className="btn small"
              onClick={() =>
                updateProject((p) => {
                  p.field.elements = rebuilt2026Elements();
                  p.field.elementsEnabled = true;
                })
              }
            >
              Add the 2026 HUBs, BUMPs and TRENCHes
            </button>
          </div>
        )}
        {hubs.map(({ e, i }) => (
          <ElementEditor key={e.id} element={e} index={i} showSize={false} />
        ))}
        {hubs.length > 0 && (
          <p className="muted small">
            HUB centers come from the official 2026 AprilTag layout; HUBs are 47 in square. Adjust them if your practice field differs.
          </p>
        )}
      </Section>

      {others.length > 0 && (
        <Section title="BUMPs and TRENCHes" defaultOpen={false}>
          <p className="muted small">BUMP: 73.0 × 44.4 in, 6.5 in tall. TRENCH: 65.65 × 47 in, 22.25 in clearance (2026 Game Manual).</p>
          {others.map(({ e, i }) => (
            <ElementEditor key={e.id} element={e} index={i} showSize />
          ))}
        </Section>
      )}

      {field.elements.length > 0 && (
        <div className="section-body">
          <button
            type="button"
            className="btn small"
            onClick={() =>
              updateProject((p) => {
                p.field.elements = presetElements(p.field.preset).length ? presetElements(p.field.preset) : rebuilt2026Elements();
              })
            }
          >
            Reset element positions
          </button>
        </div>
      )}
    </div>
  );
}
