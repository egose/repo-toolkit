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

export { runComposeSandbox, type RunDeps, type RunResult, type Logger } from './run';

export { ComposeSandboxLifecycleError, type LifecyclePhase } from './lifecycle';

export { loadAndMergeComposeSandboxOptions, mergeComposeSandboxOptions } from './config';
