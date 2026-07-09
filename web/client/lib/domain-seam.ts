// ISSUE-088/078/089 — the surface render layer's seeded honest read. The implementation now lives in the
// shared design system (@harness/web-shared/seeded-read) so both apps reuse ONE honest-by-construction seam;
// this file re-exports it so the client surfaces' existing imports keep resolving.
export { readSeeded, simFrom, type Sim } from '@harness/web-shared';
