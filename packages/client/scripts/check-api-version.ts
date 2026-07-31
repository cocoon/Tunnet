import { API_VERSION } from "../src/types";

const EXPECTED_API_VERSION = 2;

if (API_VERSION !== EXPECTED_API_VERSION) {
  console.error(
    `packages/client API_VERSION is ${API_VERSION}, expected ${EXPECTED_API_VERSION}. Update types.ts to match tunnet-common local_api.rs.`,
  );
  process.exit(1);
}

console.log(`API version check passed (${API_VERSION})`);
