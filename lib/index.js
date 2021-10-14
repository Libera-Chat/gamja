export * from "../node_modules/preact/dist/preact.module.js";

import { h } from "../node_modules/preact/dist/preact.module.js";
import htm from "../node_modules/htm/dist/htm.module.js";
export const html = htm.bind(h);

export * as linkifyjs from "../node_modules/linkifyjs/dist/linkify.module.js";
