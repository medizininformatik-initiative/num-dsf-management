/**
 * useIncidentActions.ts – write hooks of the incident register: report an
 * incident, save NIS2 report fields, request an interim report, tick a NIS2
 * stage or "DPO informed", and the admin actions
 * (confirm, suspend the site, lift the suspension, close, comment, edit).
 * Step-up writes take the TOTP code as `totpCode` (undefined in certificate
 * sessions). Every write refreshes the list and the incident's detail; a
 * suspension or its lift also refreshes the network map, whose site states
 * change with the published allow list. Toasts are left to the caller, since
 * each action words its own outcome.
 * Dependencies: incidents.api, useIncidents keys, TanStack Query.
 */
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  incidentsApi,
  type CloseOutcome,
  type LiftSuspensionBody,
  type Nis2FieldValues,
  type Nis2Stage,
  type ReportIncidentBody,
  type SuspendMeasure,
  type UpdateIncidentBody,
} from '../api/incidents.api';
import { INCIDENTS_KEY, incidentKey } from './useIncidents';

function refresh(qc: QueryClient, id?: string) {
  qc.invalidateQueries({ queryKey: INCIDENTS_KEY, exact: true });
  if (id) qc.invalidateQueries({ queryKey: incidentKey(id) });
}

export function useReportIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReportIncidentBody) => incidentsApi.report(body).then((r) => r.data.data),
    onSuccess: () => refresh(qc),
  });
}

export function useAcknowledgeNis2(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stage: Nis2Stage) =>
      incidentsApi.acknowledgeNis2(id, stage).then((r) => r.data.data),
    onSettled: () => refresh(qc, id),
  });
}

export function useSaveNis2Fields(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { stage: Nis2Stage; fields: Nis2FieldValues }) =>
      incidentsApi.saveNis2Fields(id, vars.stage, vars.fields).then((r) => r.data.data),
    onSettled: () => refresh(qc, id),
  });
}

export function useRequestNis2Interim(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestedAt: string) =>
      incidentsApi.requestNis2Interim(id, requestedAt).then((r) => r.data.data),
    onSettled: () => refresh(qc, id),
  });
}

export function useAcknowledgeDpo(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => incidentsApi.acknowledgeDpo(id).then((r) => r.data.data),
    onSettled: () => refresh(qc, id),
  });
}

export function useConfirmIncident(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (totpCode: string | undefined) =>
      incidentsApi.confirm(id, totpCode).then((r) => r.data.data),
    onSuccess: () => refresh(qc, id),
  });
}

export function useSuspendSite(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { measures: SuspendMeasure[]; confirm: boolean; totpCode?: string }) =>
      incidentsApi
        .suspend(id, { measures: vars.measures, confirm: vars.confirm }, vars.totpCode)
        .then((r) => r.data.data),
    onSettled: () => {
      refresh(qc, id);
      qc.invalidateQueries({ queryKey: ['network', 'map'] });
    },
  });
}

export function useLiftSuspension(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { body: LiftSuspensionBody; totpCode?: string }) =>
      incidentsApi.liftSuspension(id, vars.body, vars.totpCode).then((r) => r.data.data),
    onSuccess: () => {
      refresh(qc, id);
      qc.invalidateQueries({ queryKey: ['network', 'map'] });
    },
  });
}

export function useCloseIncident(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { outcome: CloseOutcome; note: string; totpCode?: string }) =>
      incidentsApi
        .close(id, { outcome: vars.outcome, note: vars.note }, vars.totpCode)
        .then((r) => r.data.data),
    onSuccess: () => refresh(qc, id),
  });
}

export function useCommentIncident(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => incidentsApi.comment(id, text).then((r) => r.data.data),
    onSuccess: () => refresh(qc, id),
  });
}

export function useUpdateIncident(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { body: UpdateIncidentBody; totpCode?: string }) =>
      incidentsApi.update(id, vars.body, vars.totpCode).then((r) => r.data.data),
    onSuccess: () => refresh(qc, id),
  });
}
