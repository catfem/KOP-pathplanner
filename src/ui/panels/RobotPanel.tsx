import { useState } from 'react';
import { INCH, MOTORS, estimateFeedforward, freeSpeed } from '../../model/defaults';
import { CONTROLLERS, DRIVETRAIN_PRESETS, ENCODER_LABELS, effectiveEncoder, motorControllerIssue } from '../../model/hardware';
import { showToast, updateProject, useStore } from '../../model/store';
import type { ControllerType, EncoderType, Language, MotorType, RobotConfig } from '../../model/types';
import { Checkbox, IntListField, NumberField, Section, SelectField, TextField } from '../components/controls';
import { RobotConfigs } from './RobotConfigs';

export function RobotPanel() {
  const robot = useStore((s) => s.project.robot);
  const codegen = useStore((s) => s.project.codegen);
  const [mass, setMass] = useState(55);
  const set = <K extends keyof RobotConfig>(k: K, v: RobotConfig[K]) =>
    updateProject((p) => {
      p.robot[k] = v;
    }, { coalesce: `robot:${k}` });
  const info = CONTROLLERS[robot.controller];
  const enc = effectiveEncoder(robot);
  const free = freeSpeed(robot);

  const issue = motorControllerIssue(robot);
  const applyPreset = (id: string) => {
    const preset = DRIVETRAIN_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    updateProject((p) => {
      Object.assign(p.robot, preset.apply);
      const est = estimateFeedforward(p.robot, mass);
      p.robot.kV = Number(est.kV.toFixed(3));
      p.robot.kA = Number(est.kA.toFixed(3));
    });
    showToast(`${preset.label}: applied, with kV/kA estimated for a ${mass} kg robot.`);
  };

  return (
    <div className="panel-scroll">
      <RobotConfigs />

      <Section title="Drivetrain preset">
        <SelectField<string>
          label="Quick setup"
          value=""
          onChange={applyPreset}
          options={[{ value: '', label: 'Choose a KOP drivetrain…' }, ...DRIVETRAIN_PRESETS.map((p) => ({ value: p.id, label: p.label }))]}
          hint="Sets motors, controllers, encoders and gains. Gearbox, wheels and size stay as they are."
        />
        {issue && <p className="warning-inline">{issue}</p>}
      </Section>

      <Section title="Chassis">
        <div className="grid-2">
          <NumberField label="Length (bumpers)" unit="m" value={robot.length} min={0.3} step={0.01} onChange={(v) => set('length', v)} />
          <NumberField label="Width (bumpers)" unit="m" value={robot.width} min={0.3} step={0.01} onChange={(v) => set('width', v)} />
        </div>
        <NumberField
          label="Track width (effective)"
          unit="m"
          value={robot.trackWidth}
          min={0.2}
          step={0.01}
          onChange={(v) => set('trackWidth', v)}
          hint="Used for all turning math. Calibrate it with the generated “Test: turn 360°” auto: if the robot turns θ degrees instead of 360, multiply this by 360 / θ. Usually 5–20% more than the measured width on 6WD."
        />
        <div className="grid-2">
          <NumberField label="Wheel diameter" unit="in" value={robot.wheelDiameter / INCH} min={1} step={0.25} decimals={2} onChange={(v) => set('wheelDiameter', v * INCH)} />
          <NumberField label="Gear ratio" unit=": 1" value={robot.gearRatio} min={1} step={0.01} decimals={2} onChange={(v) => set('gearRatio', v)} />
        </div>
        <div className="grid-2">
          <SelectField<MotorType>
            label="Motor"
            value={robot.motor}
            onChange={(v) => set('motor', v)}
            options={(Object.keys(MOTORS) as MotorType[]).map((m) => ({ value: m, label: MOTORS[m].label }))}
          />
          <NumberField label="Motors per side" value={robot.motorsPerSide} min={1} max={3} step={1} decimals={0} onChange={(v) => set('motorsPerSide', Math.round(v))} />
        </div>
        <p className="muted small">Theoretical free speed: {free.toFixed(2)} m/s.</p>
        {issue && <p className="warning-inline">{issue}</p>}
      </Section>

      <Section title="Speed limits">
        <div className="grid-2">
          <NumberField label="Max speed" unit="m/s" value={robot.maxVelocity} min={0.1} step={0.1} onChange={(v) => set('maxVelocity', v)} />
          <NumberField label="Max accel" unit="m/s²" value={robot.maxAcceleration} min={0.1} step={0.1} onChange={(v) => set('maxAcceleration', v)} />
          <NumberField label="Max centripetal" unit="m/s²" value={robot.maxCentripetal} min={0.1} step={0.1} onChange={(v) => set('maxCentripetal', v)} />
          <NumberField label="Max voltage" unit="V" value={robot.maxVoltage} min={1} max={12} step={0.5} onChange={(v) => set('maxVoltage', v)} />
          <NumberField label="Turn rate" unit="°/s" value={robot.maxTurnRate} min={10} step={10} decimals={0} onChange={(v) => set('maxTurnRate', v)} />
          <NumberField label="Turn accel" unit="°/s²" value={robot.maxTurnAccel} min={10} step={10} decimals={0} onChange={(v) => set('maxTurnAccel', v)} />
        </div>
        <NumberField
          label="Max speed on a BUMP"
          unit="m/s"
          value={robot.bumpMaxVelocity}
          min={0.1}
          step={0.1}
          onChange={(v) => set('bumpMaxVelocity', v)}
          hint="The planner slows down wherever the bumpers overlap a BUMP (2026)."
        />
        <Checkbox
          label="Robot fits under the TRENCH (22.25 in)"
          checked={robot.fitsUnderTrench}
          onChange={(v) => set('fitsUnderTrench', v)}
          hint="When off, paths under a TRENCH are reported as collisions."
        />
        {robot.maxVelocity > free * 0.9 && <p className="warning-inline">Max speed is above 90% of free speed; the robot cannot keep up open loop.</p>}
      </Section>

      <Section title="Feedforward (per side)">
        <div className="grid-3">
          <NumberField label="kS" unit="V" value={robot.kS} min={0} step={0.05} onChange={(v) => set('kS', v)} />
          <NumberField label="kV" unit="V·s/m" value={robot.kV} min={0} step={0.05} onChange={(v) => set('kV', v)} />
          <NumberField label="kA" unit="V·s²/m" value={robot.kA} min={0} step={0.05} onChange={(v) => set('kA', v)} />
        </div>
        <div className="estimate-row">
          <NumberField label="Robot mass" unit="kg" value={mass} min={10} step={1} decimals={1} onChange={setMass} />
          <button
            type="button"
            className="btn small"
            onClick={() => {
              const est = estimateFeedforward(robot, mass);
              updateProject((p) => {
                p.robot.kV = Number(est.kV.toFixed(3));
                p.robot.kA = Number(est.kA.toFixed(3));
              });
              showToast(`Estimated kV ${est.kV.toFixed(2)}, kA ${est.kA.toFixed(2)} from the motor model. Measure with SysId when you can.`);
            }}
          >
            Estimate kV/kA
          </button>
        </div>
        <p className="muted small">Best measured with WPILib SysId. Good feedforward is what makes the robot hit its marks, with or without encoders.</p>
      </Section>

      <Section title="Motor controllers">
        <SelectField<ControllerType>
          label="Controllers"
          value={robot.controller}
          onChange={(v) =>
            updateProject((p) => {
              p.robot.controller = v;
              if (v === 'can-sparkmax-brushless') p.robot.motor = 'NEO';
              if (v === 'can-sparkflex') p.robot.motor = 'NeoVortex';
              if ((v.startsWith('pwm') || v.startsWith('can-talon') || v === 'can-victorspx' || v === 'can-sparkmax-brushed') && ['NEO', 'NeoVortex'].includes(p.robot.motor)) {
                p.robot.motor = 'CIM';
              }
              if (p.robot.encoder === 'integrated' && !CONTROLLERS[v].integratedEncoder) p.robot.encoder = 'rio';
              if (p.robot.encoder === 'rio' && p.robot.encoderCPR === 4096) p.robot.encoderCPR = 360;
            })
          }
          options={(Object.keys(CONTROLLERS) as ControllerType[]).map((c) => ({ value: c, label: CONTROLLERS[c].label }))}
        />
        <div className="grid-2">
          <IntListField label={`Left ${info.idLabel}`} value={robot.leftIds} onChange={(v) => set('leftIds', v)} />
          <IntListField label={`Right ${info.idLabel}`} value={robot.rightIds} onChange={(v) => set('rightIds', v)} />
        </div>
        <div className="grid-2">
          <Checkbox label="Invert left motors" checked={robot.invertLeft} onChange={(v) => set('invertLeft', v)} />
          <Checkbox label="Invert right motors" checked={robot.invertRight} onChange={(v) => set('invertRight', v)} />
        </div>
        {info.family !== 'pwm' && (
          <div className="grid-2">
            <Checkbox label="Brake mode" checked={robot.brakeMode} onChange={(v) => set('brakeMode', v)} />
            <NumberField label="Current limit" unit="A" value={robot.currentLimit} min={10} max={80} step={5} decimals={0} onChange={(v) => set('currentLimit', Math.round(v))} />
          </div>
        )}
        {(robot.leftIds.length !== robot.motorsPerSide || robot.rightIds.length !== robot.motorsPerSide) && (
          <p className="warning-inline">List one {info.family === 'pwm' ? 'port' : 'ID'} per motor ({robot.motorsPerSide} per side).</p>
        )}
      </Section>

      <Section title="Encoders and feedback">
        <SelectField<EncoderType>
          label="Encoders"
          value={enc}
          onChange={(v) =>
            updateProject((p) => {
              p.robot.encoder = v;
              if (v === 'integrated') {
                p.robot.encoderCPR = 4096;
                p.robot.invertRightEncoder = false;
                p.robot.invertLeftEncoder = false;
              } else if (v === 'rio' && p.robot.encoderCPR === 4096) {
                p.robot.encoderCPR = 360;
                p.robot.invertRightEncoder = true;
              }
            })
          }
          options={(Object.keys(ENCODER_LABELS) as EncoderType[])
            .filter((e) => e !== 'integrated' || info.integratedEncoder)
            .map((e) => ({ value: e, label: ENCODER_LABELS[e] }))}
          hint={
            enc === 'none'
              ? 'Open loop: the robot replays the planned voltages by time. Works without any sensors, but drifts.'
              : enc === 'integrated' && info.family === 'rev'
                ? 'NEO / NEO Vortex built-in encoder (motor rotations, gear ratio applied). The generated code shortens its velocity filter for responsive feedback.'
                : 'Closed loop on wheel distance. Heading is held by the encoders, no gyro needed.'
          }
        />
        {enc === 'rio' && (
          <>
            <div className="grid-2">
              <IntListField label="Left DIO (A, B)" value={robot.leftEncoderPorts} onChange={(v) => v.length === 2 && set('leftEncoderPorts', [v[0], v[1]])} />
              <IntListField label="Right DIO (A, B)" value={robot.rightEncoderPorts} onChange={(v) => v.length === 2 && set('rightEncoderPorts', [v[0], v[1]])} />
            </div>
            <NumberField label="Cycles per revolution" value={robot.encoderCPR} min={1} step={1} decimals={0} onChange={(v) => set('encoderCPR', Math.round(v))} hint="AM E4T: 360 · CIMcoder: 20 · AMT103 (default): 2048." />
          </>
        )}
        {enc === 'integrated' && info.family === 'ctre' && (
          <NumberField label="Sensor units per revolution" value={robot.encoderCPR} min={1} step={1} decimals={0} onChange={(v) => set('encoderCPR', Math.round(v))} hint="CTRE Mag Encoder on the Talon SRX: 4096." />
        )}
        {enc !== 'none' && !(enc === 'integrated' && info.family === 'rev') && (
          <Checkbox label="Encoder is on the motor shaft (before the gearbox)" checked={robot.encoderOnMotorShaft} onChange={(v) => set('encoderOnMotorShaft', v)} />
        )}
        {enc !== 'none' && (
          <>
            <div className="grid-2">
              <Checkbox label="Invert left encoder" checked={robot.invertLeftEncoder} onChange={(v) => set('invertLeftEncoder', v)} />
              <Checkbox label="Invert right encoder" checked={robot.invertRightEncoder} onChange={(v) => set('invertRightEncoder', v)} />
            </div>
            <div className="grid-2">
              <NumberField label="kP" unit="V/m" value={robot.kP} min={0} step={0.5} onChange={(v) => set('kP', v)} />
              <NumberField label="kD (velocity)" unit="V·s/m" value={robot.kD} min={0} step={0.1} onChange={(v) => set('kD', v)} />
              <NumberField label="kP turn (heading hold)" unit="V/m" value={robot.kPTurn} min={0} step={1} onChange={(v) => set('kPTurn', v)} />
              <NumberField label="Path correction" unit="1/m" value={robot.kLateral} min={0} step={0.5} onChange={(v) => set('kLateral', v)} />
              <NumberField label="Distance tolerance" unit="m" value={robot.positionTolerance} min={0.005} step={0.005} onChange={(v) => set('positionTolerance', v)} />
              <NumberField label="Max settle time" unit="s" value={robot.maxSettleTime} min={0} step={0.05} onChange={(v) => set('maxSettleTime', v)} />
            </div>
            <p className="muted small">
              The follower waits for the robot when it falls behind, pushes harder on a wheel stuck short of its target, and stops using
              encoders that read backwards or not at all (the auto then finishes open loop and the Driver Station shows the fix).
            </p>
          </>
        )}
      </Section>

      <Section title="Code generation">
        <SelectField<Language>
          label="Language"
          value={codegen.language}
          onChange={(v) => updateProject((p) => (p.codegen.language = v))}
          options={[
            { value: 'java', label: 'Java (WPILib command-based)' },
            { value: 'python', label: 'Python (RobotPy commands2)' },
          ]}
        />
        {codegen.language === 'java' && (
          <TextField label="Java package" value={codegen.javaPackage} onChange={(v) => updateProject((p) => (p.codegen.javaPackage = v), { coalesce: 'codegen:pkg' })} />
        )}
        <div className="grid-2">
          <NumberField label="Sample time" unit="s" value={codegen.sampleTime} min={0.005} max={0.1} step={0.005} onChange={(v) => updateProject((p) => (p.codegen.sampleTime = v), { coalesce: 'codegen:dt' })} />
          <NumberField label="Auto period" unit="s" value={codegen.autoPeriod} min={1} step={1} decimals={1} onChange={(v) => updateProject((p) => (p.codegen.autoPeriod = v), { coalesce: 'codegen:period' })} />
        </div>
      </Section>
    </div>
  );
}
