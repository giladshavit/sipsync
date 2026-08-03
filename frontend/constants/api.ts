const PRODUCTION_API_URL = 'https://backend-production-f4b22.up.railway.app';

export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? 'http://localhost:8000' : PRODUCTION_API_URL);
