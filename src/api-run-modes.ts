/**
 * The one list of API runner modes. The runner's argument schema, the app's spawn validation and the controller's
 * command type all derive from it, so a mode the runner supports can never be refused by the app before it starts.
 */
export const API_RUN_MODES = ['prepare', 'dry', 'audit', 'security-check', 'live', 'live-now'] as const;
export type ApiRunMode = typeof API_RUN_MODES[number];
