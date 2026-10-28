import { useStore } from './model/store';
import { ConfirmHost } from './ui/components/Confirm';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { ToastHost } from './ui/components/ToastHost';
import { FieldView } from './ui/field/FieldView';
import { usePlanning } from './ui/hooks/usePlanning';
import { usePlayback } from './ui/hooks/usePlayback';
import { useShortcuts } from './ui/hooks/useShortcuts';
import { useTheme } from './ui/hooks/useTheme';
import { Header } from './ui/layout/Header';
import { Inspector } from './ui/layout/Inspector';
import { Sidebar } from './ui/layout/Sidebar';
import { CodeModal } from './ui/modals/CodeModal';
import { HelpModal } from './ui/modals/HelpModal';
import { Timeline } from './ui/timeline/Timeline';
import { VelocityChart } from './ui/timeline/VelocityChart';

export function App() {
  const project = useStore((s) => s.project);
  const selectedAutoId = useStore((s) => s.ui.selectedAutoId);
  const playing = useStore((s) => s.ui.playing);
  const showSim = useStore((s) => s.ui.showSim);
  const simSettings = useStore((s) => s.ui.sim);
  const codeOpen = useStore((s) => s.ui.codeOpen);
  const helpOpen = useStore((s) => s.ui.helpOpen);
  const sidebarOpen = useStore((s) => s.ui.sidebarOpen);
  const inspectorOpen = useStore((s) => s.ui.inspectorOpen);
  const chartOpen = useStore((s) => s.ui.chartOpen);
  const theme = useStore((s) => s.ui.theme);
  const auto = project.autos.find((a) => a.id === selectedAutoId) ?? project.autos[0];

  useTheme(theme);
  const { plan, sim, error } = usePlanning(auto, project, showSim, simSettings);
  usePlayback(playing, plan?.totalTime ?? 0);
  useShortcuts(plan?.totalTime ?? 0);

  return (
    <div className={`app${sidebarOpen ? '' : ' no-sidebar'}${inspectorOpen ? '' : ' no-inspector'}`}>
      <Header />
      <div className="workspace">
        {sidebarOpen && (
          <ErrorBoundary area="the autos list">
            <Sidebar />
          </ErrorBoundary>
        )}
        <main className="center" aria-label="Field and timeline">
          <ErrorBoundary area="the field view" resetKey={auto?.id}>
            <FieldView plan={plan} sim={sim} planError={error} />
          </ErrorBoundary>
          <ErrorBoundary area="the timeline">
            <Timeline plan={plan} />
            {chartOpen && <VelocityChart plan={plan} />}
          </ErrorBoundary>
        </main>
        {inspectorOpen && <Inspector auto={auto} plan={plan} sim={sim} />}
      </div>
      <datalist id="command-names">
        {project.commands.map((c) => (
          <option key={c.name} value={c.name} />
        ))}
      </datalist>
      {codeOpen && (
        <ErrorBoundary area="the code generator">
          <CodeModal />
        </ErrorBoundary>
      )}
      {helpOpen && <HelpModal />}
      <ConfirmHost />
      <ToastHost />
    </div>
  );
}
