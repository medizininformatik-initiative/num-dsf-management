/**
 * parentOrganizations.api.ts — parent organizations selectable in the membership form
 * Dependencies: axios, auth.store
 */
import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

export interface ParentOrganizationOption {
  identifier: string;
  name: string;
  known: boolean;
  usedBy: number;
}

export const parentOrganizationsApi = {
  list: () => {
    const token = useAuthStore.getState().accessToken;
    return axios.get<{ data: ParentOrganizationOption[] }>(`${BASE}/parent-organizations`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
};
