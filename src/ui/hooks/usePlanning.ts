import { useMemo } from 'react';
import { effectiveEncoder } from '../../model/hardware';
import type { Auto, Project } from '../../model/types';
import { type SimResult, type SimSettings, simulatePlan } from '../../planner/simulate';
import { type Plan, planAuto } from '../../planner/trajectory';

/** The same imperfect robot run the other way: open loop if the robot has encoders, with encoders if not. */
export interface SimComparison {
  withEncoders: boolean;
  result: SimResult;
}

export interface Planning {
  plan: Plan | null;
  sim: SimResult | null;
  comparison: SimComparison | null;
  /** Set when the planner or simulator threw; the UI shows it instead of crashing. */
  error: string | null;
}

/** Plans (and optionally simulates) the selected auto, never throwing. */
export function usePlanning(auto: Auto | undefined, project: Project, showSim: boolean, simSettings: SimSettings): Planning {
  const planned = useMemo((): { plan: Plan | null; error: string | null } => {
    if (!auto || auto.waypoints.length === 0) return { plan: null, error: null };
    try {
      const plan = planAuto(auto, project.robot, {
        sampleTime: 0.02,
        commands: project.commands,
        autoPeriod: project.codegen.autoPeriod,
        field: project.field,
      });
      if (!Number.isFinite(plan.totalTime)) throw new Error('the profile has no finite duration (check speed and acceleration limits)');
      return { plan, error: null };
    } catch (err) {
      console.error('KOP Path Planner: planning failed', err);
      return { plan: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [auto, project.robot, project.commands, project.codegen.autoPeriod, project.field]);

  const sim = useMemo(() => {
    if (!planned.plan || !showSim) return null;
    try {
      return simulatePlan(planned.plan, project.robot, simSettings);
    } catch (err) {
      console.error('KOP Path Planner: simulation failed', err);
      return null;
    }
  }, [planned.plan, showSim, project.robot, simSettings]);

  const comparison = useMemo((): SimComparison | null => {
    if (!planned.plan || !showSim) return null;
    const withEncoders = effectiveEncoder(project.robot) === 'none';
    try {
      const robot = { ...project.robot, encoder: withEncoders ? ('rio' as const) : ('none' as const) };
      return { withEncoders, result: simulatePlan(planned.plan, robot, simSettings) };
    } catch {
      return null;
    }
  }, [planned.plan, showSim, project.robot, simSettings]);

  return { plan: planned.plan, sim, comparison, error: planned.error };
}
