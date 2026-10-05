// register.mjs — `node --import ./lib/register.mjs ...` installs hooks.mjs.
import { register } from "node:module";
register(new URL("./hooks.mjs", import.meta.url));
