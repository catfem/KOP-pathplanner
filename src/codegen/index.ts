import type { Project } from '../model/types';
import type { Plan } from '../planner/trajectory';
import { type GeneratedFile, buildIR } from './common';
import { generateJava } from './java';
import { generatePython } from './python';

export type { GeneratedFile } from './common';

/** Generates the robot code for every auto in the project. */
export function generateCode(project: Project, plans?: Map<string, Plan>): GeneratedFile[] {
  const autos = project.autos.map((a) => buildIR(a, project, plans?.get(a.id)));
  return project.codegen.language === 'python' ? generatePython(project, autos) : generateJava(project, autos);
}
