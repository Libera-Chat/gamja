export * from "../node_modules/preact/dist/preact.module.js";

import { h } from "../node_modules/preact/dist/preact.module.js";
import htm from "../node_modules/htm/dist/htm.module.js";
export const html = htm.bind(h);

// TODO: replace with proper import once this is merged and released:
// https://github.com/Hypercontext/linkifyjs/pull/356
export const linkifyjs = window.linkify;
