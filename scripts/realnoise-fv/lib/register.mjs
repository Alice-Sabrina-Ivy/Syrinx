// register.mjs — `node --import ./scripts/realnoise-fv/lib/register.mjs ...`
import { register } from "node:module";
register(new URL("./hooks.mjs", import.meta.url));
