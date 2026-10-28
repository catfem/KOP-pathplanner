import { type InspectorTab, setUi, useStore } from '../../model/store';
import type { Auto } from '../../model/types';
import type { SimResult } from '../../planner/simulate';
import type { Plan } from '../../planner/trajectory';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Tabs } from '../components/Tabs';
import { AutoPanel } from '../panels/AutoPanel';
import { FieldPanel } from '../panels/FieldPanel';
import { PointPanel } from '../panels/PointPanel';
import { RobotPanel } from '../panels/RobotPanel';
import { SimPanel } from '../panels/SimPanel';

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'point', label: 'Point' },
  { id: 'auto', label: 'Auto' },
  { id: 'robot', label: 'Robot' },
  { id: 'field', label: 'Field' },
  { id: 'sim', label: 'Simulate' },
];

export function Inspector({ auto, plan, sim }: { auto: Auto | undefined; plan: Plan | null; sim: SimResult | null }) {
  const tab = useStore((s) => s.ui.tab);
  const hasWarnings = !!plan?.warnings.some((w) => w.level !== 'info');
  return (
    <aside className="inspector" aria-label="Inspector">
      <Tabs
        label="Inspector"
        idPrefix="inspector"
        value={tab}
        onChange={(id) => setUi({ tab: id })}
        tabs={TABS.map((t) => ({ ...t, badge: t.id === 'auto' && hasWarnings }))}
      />
      <div className="tab-panel" role="tabpanel" id="inspector-panel" aria-labelledby={`inspector-tab-${tab}`}>
        <ErrorBoundary area={`the ${tab} panel`} resetKey={`${tab}:${auto?.id}`}>
          {tab === 'point' && auto && <PointPanel auto={auto} plan={plan} />}
          {tab === 'auto' && auto && <AutoPanel auto={auto} plan={plan} />}
          {tab === 'robot' && <RobotPanel />}
          {tab === 'field' && <FieldPanel />}
          {tab === 'sim' && <SimPanel sim={sim} />}
        </ErrorBoundary>
      </div>
    </aside>
  );
}
