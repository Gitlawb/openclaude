import { c as _c } from "react-compiler-runtime";
import { useEffect } from 'react';
import type { ScopedMcpServerConfig } from '../services/mcp/types.js';
import { getGlobalConfig } from '../utils/config.js';
import { isEnvDefinedFalsy, isEnvTruthy } from '../utils/envUtils.js';
import type { DetectedIDEInfo } from '../utils/ide.js';
import { type IDEExtensionInstallationStatus, type IdeType, initializeIdeIntegration, isSupportedTerminal } from '../utils/ide.js';
type UseIDEIntegrationProps = {
  autoConnectIdeFlag?: boolean;
  ideToInstallExtension: IdeType | null;
  setDynamicMcpConfig: React.Dispatch<React.SetStateAction<Record<string, ScopedMcpServerConfig> | undefined>>;
  setShowIdeOnboarding: React.Dispatch<React.SetStateAction<boolean>>;
  setIDEInstallationState: React.Dispatch<React.SetStateAction<IDEExtensionInstallationStatus | null>>;
};
export function useIDEIntegration(t0) {
  const $ = _c(7);
  const {
    autoConnectIdeFlag,
    ideToInstallExtension,
    setDynamicMcpConfig,
    setShowIdeOnboarding,
    setIDEInstallationState
  } = t0;
  let t1;
  let t2;
  if ($[0] !== autoConnectIdeFlag || $[1] !== ideToInstallExtension || $[2] !== setDynamicMcpConfig || $[3] !== setIDEInstallationState || $[4] !== setShowIdeOnboarding) {
    t1 = () => {
      const addIde = function addIde(ide) {
        if (!ide) {
          return;
        }
        const globalConfig = getGlobalConfig();
        const autoConnectEnabled = (globalConfig.autoConnectIde || autoConnectIdeFlag || isSupportedTerminal() || process.env.CLAUDE_CODE_SSE_PORT || ideToInstallExtension || isEnvTruthy(process.env.CLAUDE_CODE_AUTO_CONNECT_IDE)) && !isEnvDefinedFalsy(process.env.CLAUDE_CODE_AUTO_CONNECT_IDE);
        if (!autoConnectEnabled) {
          return;
        }
        setDynamicMcpConfig(prev => {
          if (prev?.ide) {
            return prev;
          }
          return {
            ...prev,
            ide: {
              type: ide.url.startsWith("ws:") ? "ws-ide" : "sse-ide",
              url: ide.url,
              ideName: ide.name,
              authToken: ide.authToken,
              ideRunningInWindows: ide.ideRunningInWindows,
              scope: "dynamic" as const
            }
          };
        });
      };
      initializeIdeIntegration(addIde, ideToInstallExtension, () => setShowIdeOnboarding(true), status => setIDEInstallationState(status));
    };
    t2 = [autoConnectIdeFlag, ideToInstallExtension, setDynamicMcpConfig, setShowIdeOnboarding, setIDEInstallationState];
    $[0] = autoConnectIdeFlag;
    $[1] = ideToInstallExtension;
    $[2] = setDynamicMcpConfig;
    $[3] = setIDEInstallationState;
    $[4] = setShowIdeOnboarding;
    $[5] = t1;
    $[6] = t2;
  } else {
    t1 = $[5];
    t2 = $[6];
  }
  useEffect(t1, t2);
}
