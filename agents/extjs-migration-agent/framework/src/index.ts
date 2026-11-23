/**
 * @extreact/framework — the reusable part of every migrated application.
 *
 * Installed as a package (packages/extreact-framework-<version>.tgz), never copied into an app. The app supplies its
 * configuration, its approved display registry and, for Ext-style screens, a bridge (classicBridge). Menus come from
 * the display registry service; nothing about the business menu is written here or in the app shell.
 */
export { FrameworkApp, type AppConfig, type ExtBridge } from './shell/AppShell';
export { useShell, useFrame, ShellContext, FrameContext, type ShellApi, type DisplayFrame, type ToastKind } from './shell/context';
export { createApiClient, ApiError, joinUrl, type ApiClient, type ApiClientOptions, type RequestOptions } from './api/client';
export { AuthProvider, useAuth, passwordAuth, type AuthAdapter } from './auth/AuthProvider';
export { SessionStore, expired, refreshDelay } from './auth/session';
export { LoginPage } from './auth/LoginPage';
export { MenuBar } from './navigation/MenuBar';
export { DisplayHost, Loading, Problem } from './display/DisplayHost';
export { defineDisplays, mergeDisplays, resolveDisplay } from './display/registry';
export { parseHash, buildHash, navigate, useHashLocation } from './routing/hash';
export { createExtScreen, type ExtScreenOptions } from './compat/ExtScreen';
export { classicDisplays, classicBridge, type ClassicBridgeOptions } from './compat/classic';
export { SummaryDisplay, createSummaryDisplay, registerRenderer, toGridColumns, fillEndpoint, searchParams, type SummaryHooks, type SummaryContext, type SummaryEmbedding } from './templates/SummaryDisplay';
export { EntryFormDisplay, createEntryDisplay, type EntryHooks, type EntryContext, type EntryEmbedding } from './templates/EntryForm';
export { MasterSlaveDisplay, createMasterSlaveDisplay, type MasterSlaveHooks } from './templates/MasterSlave';
export { validate, coerce, coerceAll, defaults, changedValues, isVisible, isNumeric, type Validator, type Values, type Errors } from './templates/fields';
export { loadLookup, useLookup, clearLookupCache } from './templates/lookups';
export { builtinDisplays } from './templates/builtin';
export { DataGrid, defineGrid, XGrid, registeredXtypes, PRESETS, fmtDate, fmtNumber } from './grid';
export type {
  ColumnConfig, DataGridProps, DataGridHandle, DataGridModel, GridFeatures, Preset, SummaryType, BadgeTone, FilterKind,
  EditorKind, Changes, Sorter, SortDir, GridStore, FieldType as GridFieldType, MenuItem as GridMenuItem,
} from './grid';
export type * from './types';
