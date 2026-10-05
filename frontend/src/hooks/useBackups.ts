/**
 * useBackups.ts – React Query hooks for the admin backup page: settings, run
 * history (polled while visible), saving the schedule, "back up now" and the
 * file download. Dependencies: backups.api, tanstack/react-query.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { backupsApi, type BackupSettingsInput } from '../api/backups.api';

export const BACKUP_SETTINGS_KEY = ['admin', 'backups', 'settings'] as const;
export const BACKUP_RUNS_KEY = ['admin', 'backups', 'runs'] as const;

export function useBackupSettings() {
  return useQuery({
    queryKey: BACKUP_SETTINGS_KEY,
    queryFn: () => backupsApi.getSettings().then((r) => r.data.data),
  });
}

export function useBackupRuns() {
  return useQuery({
    queryKey: BACKUP_RUNS_KEY,
    queryFn: () => backupsApi.listRuns().then((r) => r.data.data.runs),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useSaveBackupSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { input: BackupSettingsInput; totpCode?: string }) =>
      backupsApi.saveSettings(vars.input, vars.totpCode).then((r) => r.data.data.settings),
    onSuccess: () => qc.invalidateQueries({ queryKey: BACKUP_SETTINGS_KEY }),
  });
}

export function useRunBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { totpCode?: string }) =>
      backupsApi.runNow(vars.totpCode).then((r) => r.data.data.run),
    // A failed run is recorded server-side too, so refresh the list either way.
    onSettled: () => qc.invalidateQueries({ queryKey: BACKUP_RUNS_KEY }),
  });
}

export function useDownloadBackup() {
  return useMutation({
    mutationFn: async (vars: { id: string; fileName: string; totpCode?: string }) => {
      const res = await backupsApi.download(vars.id, vars.totpCode);
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = vars.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
  });
}
