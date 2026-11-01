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

// The last entry of a variant leads the first auto with the intake (the robot's front is the head).
const VARIANTS: ([ControllerType, EncoderType] | [ControllerType, EncoderType, 'intake'])[] = [
  ['can-talon-victor', 'rio'],
  ['can-talon-victor', 'integrated'],
  ['can-talonsrx', 'none'],
  ['can-victorspx', 'rio'],
  ['can-sparkmax-brushless', 'integrated'],
  ['can-sparkmax-brushed', 'rio'],
  ['can-sparkflex', 'integrated'],
  ['can-sparkmax-brushless', 'none'],
  ['pwm-sparkmax', 'rio'],
  ['pwm-sparkmax', 'rio', 'intake'],
  ['pwm-victorspx', 'none'],
  ['pwm-talonsrx', 'rio'],
  ['pwm-spark', 'none'],
  ['pwm-victorsp', 'rio'],
];

it.runIf(!!OUT)('dumps generated code for every hardware variant', () => {
  for (const language of ['java', 'python'] as Language[]) {
    for (const [controller, encoder, front] of VARIANTS) {
      const project = defaultProject();
      project.codegen.language = language;
      project.robot.controller = controller;
      project.robot.motor = controller === 'can-sparkflex' ? 'NeoVortex' : controller === 'can-sparkmax-brushless' ? 'NEO' : 'CIM';
      project.robot.encoder = encoder;
      if (encoder === 'integrated') project.robot.encoderCPR = 4096;
      if (front) project.autos[0].front = front;
      for (const file of generateCode(project)) {
        const path = join(OUT as string, language, `${controller}_${encoder}${front ? `_${front}` : ''}`, file.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, file.content);
      }
    }
  }
});
