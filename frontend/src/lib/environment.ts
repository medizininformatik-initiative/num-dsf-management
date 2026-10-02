/**
 * environment.ts – The DSF environment this portal serves (build-time
 * VITE_DSF_ENVIRONMENT), shared by every environment indicator so TEST and
 * PRODUCTION are marked the same way on the login screen, top bar and sidebar.
 */
export type DsfEnvironment = 'TEST' | 'PRODUCTION';

export const DSF_ENVIRONMENT: DsfEnvironment =
  import.meta.env.VITE_DSF_ENVIRONMENT === 'PRODUCTION' ? 'PRODUCTION' : 'TEST';

export const IS_PRODUCTION = DSF_ENVIRONMENT === 'PRODUCTION';

/** Accent color of the environment indicator (AA contrast with white text). */
export const ENV_ACCENT = IS_PRODUCTION ? '#1d4ed8' : '#115e59';
