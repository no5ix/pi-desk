// Runs the ported TypeScript suite through jiti (see scripts/port-branchshift-tests.mjs).
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

await jiti.import("./tests/git-service-comparison.test.ts");
