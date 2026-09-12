import { readFileSync } from "node:fs";
import { readContainer } from "../src/lib/hwpx/container";
import { dissect } from "../src/lib/hwpx/dissect";
const { result } = dissect(readContainer(new Uint8Array(readFileSync(process.argv[2]))));
const re = new RegExp(process.argv[3]);
for (const s of result.slots) if (re.test(s.id)) console.log(`${s.id.padEnd(16)} ${s.confidence.padEnd(6)} ${s.labelPath.join(" › ")}`);
