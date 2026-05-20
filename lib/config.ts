/**
 * Beacon School Config
 * Single source of truth for school identity across the dashboard.
 * In a multi-school deployment this would be derived from the
 * authenticated user's session. For MVP it reads from env vars.
 */

export const SCHOOL_ID   = process.env.NEXT_PUBLIC_SCHOOL_ID   || "beacon-academy";
export const SCHOOL_NAME = process.env.NEXT_PUBLIC_SCHOOL_NAME || "Beacon Academy";
