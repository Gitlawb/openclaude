function truncateMiddle(value, maxLength) {
  const text = String(value || '');
  if (!text || text.length <= maxLength) {
    return text;
  }

  const basename = text.split(/[\\/]/).filter(Boolean).pop() || '';
  if (basename && basename.length + 4 <= maxLength) {
    const separator = text.includes('\\') ? '\\' : '/';
    return `...${separator}${basename}`;
  }

  if (maxLength <= 3) {
    return '.'.repeat(Math.max(maxLength, 0));
  }

  const available = maxLength - 3;
  const startLength = Math.ceil(available / 2);
  const endLength = Math.floor(available / 2);
  return `${text.slice(0, startLength)}...${text.slice(text.length - endLength)}`;
}

function getPathTail(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }

  return text.split(/[\\/]/).filter(Boolean).pop() || text;
}

function buildActionModel({ canLaunchInWorkspaceRoot, workspaceProfilePath } = {}) {
  return {
    primary: {
      id: 'launch',
      label: 'Launch OpenClaude',
      detail: 'Use the resolved project-aware launch directory',
      tone: 'accent',
      disabled: false,
    },
    launchRoot: {
      id: 'launchRoot',
      label: 'Launch in Workspace Root',
      detail: canLaunchInWorkspaceRoot
        ? 'Launch directly from the resolved workspace root'
        : 'Open a workspace folder to enable workspace-root launch',
      tone: 'neutral',
      disabled: !canLaunchInWorkspaceRoot,
    },
    openProfile: workspaceProfilePath
      ? {
          id: 'openProfile',
          label: 'Open Workspace Profile',
          detail: `Inspect ${truncateMiddle(workspaceProfilePath, 40)}`,
          tone: 'neutral',
          disabled: false,
        }
      : null,
  };
}

function getRuntimeTone(installed) {
  return installed ? 'positive' : 'critical';
}

function getProfileTone(profileStatusLabel) {
  return profileStatusLabel === 'Invalid' || profileStatusLabel === 'Unreadable'
    ? 'warning'
    : 'neutral';
}

function getProviderTone(providerState) {
  return providerState?.source === 'shim' || providerState?.source === 'unknown'
    ? 'warning'
    : 'neutral';
}

function getProviderDetail(providerState, providerSourceLabel) {
  const detail = providerState?.detail || '';
  if (!detail) {
    return providerSourceLabel || '';
  }

  switch (providerState?.source) {
    case 'profile':
      return [detail, providerSourceLabel].filter(Boolean).join(' · ');
    case 'env':
      return /^from environment$/i.test(detail)
        ? detail
        : [detail, providerSourceLabel].filter(Boolean).join(' · ');
    case 'shim':
    case 'unknown':
      return detail;
    default:
      return [detail, providerSourceLabel].filter(Boolean).join(' · ');
  }
}

function buildControlCenterViewModel(status = {}) {
  const runtimeSummary = status.installed ? 'Installed' : 'Missing';
  const runtimeDetail = status.executable || 'Unknown command';
  const providerDetail = getProviderDetail(status.providerState, status.providerSourceLabel);
  const providerTone = getProviderTone(status.providerState);
  const workspaceSummary = status.workspaceFolder ? getPathTail(status.workspaceFolder) : 'No workspace open';
  const workspaceDetail = [status.workspaceFolder, status.workspaceSourceLabel]
    .filter(Boolean)
    .join(' · ') || 'no workspace open';

  return {
    header: {
      eyebrow: 'OpenClaude Control Center',
      title: 'Project-aware OpenClaude companion',
      subtitle:
        'Useful local status, predictable launch behavior, and quick access to the workflows you actually use.',
    },
    headerBadges: [
      {
        key: 'runtime',
        label: 'Runtime',
        value: runtimeSummary,
        tone: getRuntimeTone(status.installed),
      },
      {
        key: 'provider',
        label: 'Provider',
        value: status.providerState?.label || 'Unknown',
        tone: providerTone,
      },
      {
        key: 'profileStatus',
        label: 'Profile',
        value: status.profileStatusLabel || 'Unknown',
        tone: getProfileTone(status.profileStatusLabel),
      },
    ],
    summaryCards: [
      {
        key: 'workspace',
        label: 'Workspace',
        value: status.workspaceFolder || 'No workspace open',
        detail: status.workspaceSourceLabel || 'no workspace open',
      },
      {
        key: 'launchCwd',
        label: 'Launch cwd',
        value: status.launchCwdLabel || 'VS Code default terminal cwd',
      },
      {
        key: 'launchCommand',
        label: 'Launch command',
        value: status.launchCommand || '',
        detail: status.terminalName ? `Integrated terminal: ${status.terminalName}` : '',
      },
    ],
    detailSections: [
      {
        title: 'Project',
        rows: [
          {
            key: 'workspace',
            label: 'Workspace folder',
            summary: workspaceSummary,
            detail: workspaceDetail,
          },
          {
            key: 'profileStatus',
            label: 'Workspace profile',
            summary: status.profileStatusLabel || 'Unknown',
            detail: status.profileStatusHint || '',
            tone: getProfileTone(status.profileStatusLabel),
          },
        ],
      },
      {
        title: 'Runtime',
        rows: [
          {
            key: 'runtime',
            label: 'OpenClaude executable',
            summary: runtimeSummary,
            detail: runtimeDetail,
            tone: getRuntimeTone(status.installed),
          },
          {
            key: 'provider',
            label: 'Detected provider',
            summary: status.providerState?.label || 'Unknown',
            detail: providerDetail,
            tone: providerTone,
          },
        ],
      },
    ],
    actions: buildActionModel(status),
  };
}

module.exports = {
  truncateMiddle,
  buildActionModel,
  buildControlCenterViewModel,
};
