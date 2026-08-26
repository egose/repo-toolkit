export {
  resolveComposeSandboxPlan,
  type ComposeSandboxOptions,
  type ComposeSandboxPlan,
  type ComposeSandboxComposeOptions,
  type ComposeSandboxComposePlan,
  type PrepareOptions,
  type PreparePlan,
  type ReadinessProbeOptions,
  type ReadinessProbe,
  type TcpProbeOptions,
  type HttpProbeOptions,
  type ServiceRunningProbeOptions,
  type ServiceCompletedProbeOptions,
  type CommandProbeOptions,
  type TcpProbe,
  type HttpProbe,
  type ServiceRunningProbe,
  type ServiceCompletedProbe,
  type CommandProbe,
  type StructuredCommandOptions,
  type StructuredCommand,
  type EvidenceOptions,
  type EvidencePlan,
  type EvidenceCapture,
  type CleanupOptions,
  type CleanupPlan,
  type TimeoutOptions,
  type TimeoutPlan,
} from './plan';

export {
  runProcess,
  type ProcessOptions,
  type ProcessResult,
  type ProcessDeps,
  type Clock as ProcessClock,
} from './process';

export {
  runLifecycle,
  ComposeSandboxLifecycleError,
  type LifecyclePhase,
  type LifecycleHandlers,
  type LifecycleDeps,
  type LifecycleResult,
  type Clock as LifecycleClock,
  type SignalTarget,
} from './lifecycle';

export {
  buildComposeArgs,
  runCompose,
  preflightCompose,
  prepareSandbox,
  parseComposePsOutput,
  getServiceState,
  startSandbox,
  type ComposeArgs,
  type ComposeDeps,
  type Clock as ComposeClock,
} from './compose';

export {
  waitForReadiness,
  describeProbe,
  ServiceProbeError,
  ReadinessTimeoutError,
  ReadinessProbeError,
  type Clock as ReadinessClock,
  type TcpConnect,
  type HttpFetch,
  type GetServiceState,
  type RunCommandProbe,
  type ReadinessDeps,
} from './readiness';

export { runComposeSandbox, type RunDeps, type RunResult } from './run';
