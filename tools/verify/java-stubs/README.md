# API stubs for compile checks

Minimal stand-ins for the WPILib, CTRE Phoenix 5 and REVLib 2026 classes that the
generated Java uses. They mirror the real signatures so `javac` can check the
generated code without the FRC Maven repositories. They are **not** a WPILib
implementation; `Timer` is driven by `Timer.now` so the harness can simulate time.
