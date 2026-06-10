/// <reference path="./optionalModules.d.ts" />

import type {
  ComputerExecutor,
  ComputerUseHostAdapter,
} from '@ant/computer-use-mcp/types'
import type {
  ComputerExecutor as ReExportedComputerExecutor,
  ComputerUseHostAdapter as ReExportedComputerUseHostAdapter,
} from '@ant/computer-use-mcp'

type Assert<T extends true> = T
type IsEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends <
  T,
>() => T extends B ? 1 : 2
  ? true
  : false

type _HostAdapterExecutorIsPublicExecutor = Assert<
  IsEqual<ComputerUseHostAdapter['executor'], ComputerExecutor>
>
type _ExecutorPlatformIsDarwin = Assert<
  IsEqual<ComputerExecutor['capabilities']['platform'], 'darwin'>
>
type _ReExportedHostAdapterExecutorIsPublicExecutor = Assert<
  IsEqual<ReExportedComputerUseHostAdapter['executor'], ReExportedComputerExecutor>
>
type _ReExportedExecutorMatchesTypesModule = Assert<
  IsEqual<ReExportedComputerExecutor, ComputerExecutor>
>
