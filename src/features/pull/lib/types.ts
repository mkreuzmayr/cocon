export type StatusType =
  | 'pending'
  | 'fetching'
  | 'finding-tag'
  | 'downloading'
  | 'complete'
  | 'error';

export interface PackageState {
  name: string;
  version?: string;
  status: StatusType;
  error?: string;
  fromCache?: boolean;
}
