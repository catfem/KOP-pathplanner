// Writes generated code for every hardware variant to $KOP_DUMP_DIR so that
// tools/verify/run.sh can compile (Java) and simulate (RobotPy) it.
// Skipped in normal test runs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { it } from 'vitest';
import { generateCode } from '../src/codegen';
import { defaultProject } from '../src/model/defaults';
import type { ControllerType, EncoderType, Language } from '../src/model/types';

const OUT = process.env.KOP_DUMP_DIR;

const VARIANTS: [ControllerType, EncoderType][] = [
  ['can-talon-victor', 'rio'],
  ['can-talon-victor', 'integrated'],
  ['can-talonsrx', 'none'],
  ['can-victorspx', 'rio'],
  ['can-sparkmax-brushless', 'integrated'],
  ['can-sparkmax-brushed', 'rio'],
  ['pwm-sparkmax', 'rio'],
  ['pwm-victorspx', 'none'],
  ['pwm-talonsrx', 'rio'],
  ['pwm-spark', 'none'],
  ['pwm-victorsp', 'rio'],
];

it.runIf(!!OUT)('dumps generated code for every hardware variant', () => {
  for (const language of ['java', 'python'] as Language[]) {
    for (const [controller, encoder] of VARIANTS) {
      const project = defaultProject();
      project.codegen.language = language;
      project.robot.controller = controller;
      project.robot.encoder = encoder;
      if (encoder === 'integrated') project.robot.encoderCPR = 4096;
      for (const file of generateCode(project)) {
        const path = join(OUT as string, language, `${controller}_${encoder}`, file.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, file.content);
      }
    }
  }
});
