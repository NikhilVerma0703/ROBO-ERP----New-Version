// STANDALONE: Robo uses one constant from the ERP's plantSync/machine/slabs-server.ts
// (the Machine Overview's slab reader, which stays in the main ERP): the Postgres
// to_char format the plant timestamps are read back in. Copied unchanged.

export const TS_FMT = 'YYYY-MM-DD"T"HH24:MI:SS.MS';
